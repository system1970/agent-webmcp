#!/usr/bin/env bash
# install-local: safe local reinstall of agent-webmcp-rs.
#
# The fragility it replaces: hand-copying the binary over live
# `agent-webmcp-rs mcp` servers. Linux keeps the overwritten inode
# alive, so running servers stay on old code while fresh CLI calls run
# new code — version skew inside one system.
#
# This flow: build -> quiesce exact live servers -> atomic replace ->
# verify. PID discovery matches /proc EXE identity, never argv
# patterns (a pattern pkill once matched its own shell). The harness
# respawns MCP servers on demand; verification proves none of the old
# ones remain and the fresh binary reports the built rev.
#
# Usage: scripts/install-local.sh [--release]
set -euo pipefail

RELEASE=0
if [ "${1:-}" = "--release" ]; then RELEASE=1; fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$HOME/.local/bin/agent-webmcp-rs"
CARGO="${CARGO:-$HOME/.cargo/bin/cargo}"
command -v "$CARGO" >/dev/null || CARGO="cargo"
TARGET_DIR="$REPO/rust/target/$([ $RELEASE = 1 ] && echo release || echo debug)"

echo "== build ($([ $RELEASE = 1 ] && echo release || echo debug))" >&2
if [ $RELEASE = 1 ]; then
    (cd "$REPO/rust" && "$CARGO" build --release 2>&1 | tail -1 >&2)
else
    (cd "$REPO/rust" && "$CARGO" build 2>&1 | tail -1 >&2)
fi
ART="$TARGET_DIR/agent-webmcp"
[ -x "$ART" ] || { echo "no artifact: $ART" >&2; exit 1; }

echo "== quiesce live mcp servers (exe-identity match)" >&2
PIDS=""
for d in /proc/[0-9]*; do
    pid="${d#/proc/}"
    exe="$(readlink "$d/exe" 2>/dev/null)" || continue
    exe="${exe% (deleted)}"
    [ "$exe" = "$BIN" ] || continue
    cmd="$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)" || continue
    case "$cmd" in
        *"agent-webmcp-rs mcp"*) PIDS="$PIDS $pid" ;;
    esac
done
# shellcheck disable=SC2086
if [ -n "$PIDS" ]; then
    echo "stopping:$PIDS" >&2
    # shellcheck disable=SC2086
    kill $PIDS 2>/dev/null || true
    for _ in $(seq 1 50); do
        LEFT=""
        # shellcheck disable=SC2086
        for p in $PIDS; do kill -0 "$p" 2>/dev/null && LEFT="$LEFT $p"; done
        [ -z "$LEFT" ] && break
        sleep 0.1
    done
    # shellcheck disable=SC2086
    [ -n "$LEFT" ] && kill -9 $LEFT 2>/dev/null || true
    echo "stopped" >&2
else
    echo "none live" >&2
fi

echo "== atomic install -> $BIN" >&2
install -m 755 "$ART" "$BIN.new"
mv "$BIN.new" "$BIN"

echo "== verify" >&2
WANT="$(cd "$REPO" && git rev-parse --short HEAD)"
GOT="$("$BIN" version | python3 -c 'import json,sys; print(json.load(sys.stdin)["rev"])')"
echo "built=$WANT installed_rev=$GOT" >&2
case "$GOT" in
    "$WANT"*) echo OK ;;
    *) echo "MISMATCH (dirty tree? got $GOT)" >&2; exit 1 ;;
esac
