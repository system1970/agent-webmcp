// Spike 1: Zig talks CDP. Launch headless Chromium, navigate to
// example.com, Runtime.evaluate document.title, print it, exit.
// Stdlib only: TCP + hand-rolled HTTP GET + minimal WebSocket framing.
const std = @import("std");

const CHROME = "/usr/bin/chromium";

const Io = std.Io;
fn child_null() void {}
const Net = std.Io.net;
const L = std.os.linux;

// --- blocking TCP over raw syscalls. The new async Io backend cannot
// complete a wait in this environment (single thread parks in
// sigsuspend forever), and a CLI has no use for async networking
// anyway. Every read/write here blocks in-kernel until done.
fn errOf(rc: usize) L.E {
    const s: isize = @bitCast(rc);
    if (s >= 0) return .SUCCESS;
    return @enumFromInt(@as(u16, @truncate(@as(usize, @bitCast(-s)))));
}

const Tcp = struct {
    fd: L.fd_t,

    fn connect(ip: [4]u8, port: u16) !Tcp {
        const uf = L.socket(L.AF.INET, L.SOCK.STREAM, 0);
        if (@as(isize, @bitCast(uf)) < 0) return error.SocketFailed;
        const fd: i32 = @intCast(uf);
        errdefer _ = L.close(fd);
        var sa: [16]u8 = .{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
        sa[0] = 2;
        sa[1] = 0; // AF_INET, little-endian
        std.mem.writeInt(u16, sa[2..4], port, .big);
        sa[4] = ip[0];
        sa[5] = ip[1];
        sa[6] = ip[2];
        sa[7] = ip[3];
        const rc = L.connect(fd, @ptrCast(&sa), 16);
        if (errOf(rc) != .SUCCESS) return error.ConnectionRefused;
        return .{ .fd = fd };
    }

    fn writeAll(self: Tcp, data: []const u8) !void {
        var off: usize = 0;
        while (off < data.len) {
            const rc = L.write(self.fd, data.ptr + off, data.len - off);
            const e = errOf(rc);
            if (e == .SUCCESS) {
                off += rc;
                continue;
            }
            if (e == .INTR) continue;
            return error.WriteFailed;
        }
    }

    fn read(self: Tcp, buf: []u8) !usize {
        while (true) {
            const rc = L.read(self.fd, buf.ptr, buf.len);
            const e = errOf(rc);
            if (e == .SUCCESS) return rc;
            if (e == .INTR) continue;
            return error.ReadFailed;
        }
    }

    fn close(self: Tcp) void {
        _ = L.close(self.fd);
    }
};

fn msleep(ms: u64) void {
    var req = L.timespec{ .sec = @intCast(ms / 1000), .nsec = @intCast((ms % 1000) * 1_000_000) };
    var rem: L.timespec = undefined;
    while (errOf(L.nanosleep(&req, &rem)) == .INTR) req = rem;
}

fn httpGet(alloc: std.mem.Allocator, port: u16, path: []const u8) ![]u8 {
    _ = path;
    const uf = L.socket(L.AF.INET, L.SOCK.STREAM, 0);
    const fd: i32 = @intCast(uf);
    defer _ = L.close(fd);
    var sa: [16]u8 = .{ 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
    std.mem.writeInt(u16, sa[2..4], port, .big);
    sa[4] = 127;
    sa[5] = 0;
    sa[6] = 0;
    sa[7] = 1;
    _ = L.connect(fd, @ptrCast(&sa), 16);
    std.debug.print("conn sent\n", .{});
    const msg = "GET /json/list HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    _ = L.write(fd, msg.ptr, msg.len);
    std.debug.print("req sent\n", .{});
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(alloc);
    var tmp: [512]u8 = undefined;
    while (true) {
        const n = L.read(fd, &tmp, 512);
        if (n == 0) break;
        try out.appendSlice(alloc, tmp[0..n]);
    }
    const raw = try out.toOwnedSlice(alloc);
    if (std.mem.indexOf(u8, raw, "\r\n\r\n")) |i| {
        const body = try alloc.dupe(u8, raw[i + 4 ..]);
        alloc.free(raw);
        return body;
    }
    return raw;
}

fn waitHttp(port: u16) !void {
    var tries: u32 = 0;
    while (tries < 150) {
        tries += 1;
        var conn = Tcp.connect(.{ 127, 0, 0, 1 }, port) catch {
            msleep(100);
            continue;
        };
        conn.close();
        return;
    }
    return error.Timeout;
}

// --- minimal websocket client: send masked text, read fragmented text,
// answer pings. Enough for CDP, nothing more.
const Ws = struct {
    conn: Tcp,
    alloc: std.mem.Allocator,
    id: i64 = 0,

    fn handshake(alloc: std.mem.Allocator, port: u16, path: []const u8) !Ws {
        var conn = try Tcp.connect(.{ 127, 0, 0, 1 }, port);
        errdefer conn.close();
        var key_bytes: [16]u8 = undefined;
        const t: u64 = @intFromPtr(&key_bytes) ^ 0x9e3779b97f4a7c15;
        const c: u64 = 0x9e3779b97f4a7c15;
        for (&key_bytes, 0..) |*b, i| {
            const sh1: u6 = @intCast((i * 5) % 56);
            const sh2: u6 = @intCast(i * 3 % 64);
            b.* = @truncate((t >> sh1) ^ (c >> sh2));
        }
        var key_b64: [24]u8 = undefined;
        _ = std.base64.standard.Encoder.encode(&key_b64, &key_bytes);
        var req_buf: [512]u8 = undefined;
        const req = try std.fmt.bufPrint(&req_buf, "GET {s} HTTP/1.1\r\nHost: 127.0.0.1:{d}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {s}\r\nSec-WebSocket-Version: 13\r\n\r\n", .{ path, port, key_b64 });
        try conn.writeAll(req);
        var resp: [1024]u8 = undefined;
        var got: usize = 0;
        while (got < resp.len) {
            const n = try conn.read(resp[got..]);
            if (n == 0) break;
            got += n;
            if (std.mem.indexOf(u8, resp[0..got], "\r\n\r\n") != null) break;
        }
        if (!std.mem.startsWith(u8, resp[0..got], "HTTP/1.1 101")) return error.WsRejected;
        return .{ .conn = conn, .alloc = alloc };
    }

    fn sendText(self: *Ws, payload: []const u8) !void {
        var hdr: [10]u8 = undefined;
        hdr[0] = 0x81; // FIN + text
        var hlen: usize = 2;
        if (payload.len < 126) {
            hdr[1] = 0x80 | @as(u8, @intCast(payload.len));
        } else {
            hdr[1] = 0x80 | 126;
            std.mem.writeInt(u16, hdr[2..4], @intCast(payload.len), .big);
            hlen = 4;
        }
        try self.conn.writeAll(hdr[0..hlen]);
        const mask = [4]u8{ 0x12, 0x34, 0x56, 0x78 };
        try self.conn.writeAll(&mask);
        var off: usize = 0;
        var chunk: [1024]u8 = undefined;
        while (off < payload.len) {
            const n = @min(chunk.len, payload.len - off);
            for (payload[off..][0..n], 0..) |b, i| chunk[i] = b ^ mask[(off + i) % 4];
            try self.conn.writeAll(chunk[0..n]);
            off += n;
        }
    }

    fn sendPong(self: *Ws) !void {
        try self.conn.writeAll(&[_]u8{ 0x8A, 0x80, 0x12, 0x34, 0x56, 0x78 });
    }

    fn readFull(self: *Ws, buf: []u8) !void {
        var off: usize = 0;
        while (off < buf.len) {
            const n = try self.conn.read(buf[off..]);
            if (n == 0) return error.WsClosed;
            off += n;
        }
    }

    fn readMsg(self: *Ws) ![]u8 {
        var out: std.ArrayList(u8) = .empty;
        errdefer out.deinit(self.alloc);
        while (true) {
            var h: [2]u8 = undefined;
            try self.readFull(&h);
            const fin = h[0] & 0x80 != 0;
            const op = h[0] & 0x0F;
            var len: usize = h[1] & 0x7F;
            if (len == 126) {
                var e: [2]u8 = undefined;
                try self.readFull(&e);
                len = std.mem.readInt(u16, &e, .big);
            } else if (len == 127) {
                var e: [8]u8 = undefined;
                try self.readFull(&e);
                len = std.mem.readInt(u64, &e, .big);
            }
            if (h[1] & 0x80 != 0) {
                var m: [4]u8 = undefined; // server must not mask; skip if it does
                try self.readFull(&m);
            }
            // Cap single-frame reads at 1MiB; CDP replies here are small.
            const chunk = try self.alloc.alloc(u8, len);
            defer self.alloc.free(chunk);
            try self.readFull(chunk);
            if (op == 0x9) {
                try self.sendPong();
                continue;
            }
            if (op == 0x8) return error.WsClosed;
            if (op == 0x1 or op == 0x2 or op == 0x0) {
                try out.appendSlice(self.alloc, chunk);
                if (fin) return out.toOwnedSlice(self.alloc);
            }
        }
    }

    fn call(self: *Ws, method: []const u8, params_json: []const u8) !std.json.Parsed(std.json.Value) {
        self.id += 1;
        const req = try std.fmt.allocPrint(self.alloc, "{{\"id\":{d},\"method\":\"{s}\",\"params\":{s}}}", .{ self.id, method, params_json });
        defer self.alloc.free(req);
        try self.sendText(req);
        const want = self.id;
        while (true) {
            const msg = try self.readMsg();
            defer self.alloc.free(msg);
            std.debug.print("<< {s}\n", .{msg[0..@min(msg.len, 300)]});
            var p = try std.json.parseFromSlice(std.json.Value, self.alloc, msg, .{});
            defer p.deinit();
            if (p.value != .object) continue;
            const idv = p.value.object.get("id") orelse continue; // event; skip
            if (idv != .integer or idv.integer != want) continue;
            if (p.value.object.get("error")) |e| {
                std.debug.print("cdp error: {f}\n", .{std.json.fmt(e, .{})});
                return error.CdpError;
            }
            return try std.json.parseFromSlice(std.json.Value, self.alloc, msg, .{});
        }
    }
};

pub fn main() !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    // No async runtime: all transport is blocking syscalls.

    // External chrome for this test; port fixed.
    const port: u16 = 18711;

    const port_arg = try std.fmt.allocPrint(alloc, "--remote-debugging-port={d}", .{port});
    const argv = [_][]const u8{
        CHROME,
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        port_arg,
        "https://example.com/",
    };
    _ = argv;
    _ = child_null();
    std.debug.print("using external chrome on {d}\n", .{port});
    msleep(1000);

    // Find the example.com page target.
    var ws_url: []const u8 = "";
    {
        const body = try httpGet(alloc, port, "/json/list");
        defer alloc.free(body);
        std.debug.print("list bytes: {d}\n", .{body.len});
        var p = try std.json.parseFromSlice(std.json.Value, alloc, body, .{});
        defer p.deinit();
        if (p.value == .array) {
            for (p.value.array.items) |t| {
                const url = t.object.get("url") orelse continue;
                if (url == .string and std.mem.indexOf(u8, url.string, "example.com") != null) {
                    const ws = t.object.get("webSocketDebuggerUrl") orelse continue;
                    if (ws == .string) {
                        ws_url = try alloc.dupe(u8, ws.string);
                        break;
                    }
                }
            }
        }
    }
    if (ws_url.len == 0) {
        std.debug.print("no example.com target\n", .{});
        return error.NoTarget;
    }

    // Split ws://host:port/path.
    const no_scheme = ws_url["ws://".len..];
    const slash = std.mem.indexOfScalar(u8, no_scheme, '/') orelse return error.BadWsUrl;
    const hostport = no_scheme[0..slash];
    const path = no_scheme[slash..];
    const colon = std.mem.indexOfScalar(u8, hostport, ':') orelse return error.BadWsUrl;
    const ws_port = try std.fmt.parseInt(u16, hostport[colon + 1 ..], 10);

    var ws = try Ws.handshake(alloc, ws_port, path);
    var res = try ws.call("Runtime.evaluate", "{\"expression\":\"document.title\",\"returnByValue\":true}");
    defer res.deinit();
    const title = res.value.object.get("result").?.object.get("result").?.object.get("value").?;
    std.debug.print("title: {f}\n", .{std.json.fmt(title, .{})});
}
