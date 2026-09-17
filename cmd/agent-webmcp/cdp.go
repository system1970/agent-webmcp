package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

type Target struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	URL                  string `json:"url"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

var httpClient = &http.Client{Timeout: 8 * time.Second}

func cdpGet(port int, path string, out any) error {
	resp, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d%s", port, path))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(out)
}

func cdpPut(port int, path string, out any) error {
	req, err := http.NewRequest(http.MethodPut, fmt.Sprintf("http://127.0.0.1:%d%s", port, path), nil)
	if err != nil {
		return err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func listTargets(port int) ([]Target, error) {
	var targets []Target
	if err := cdpGet(port, "/json/list", &targets); err != nil {
		return nil, err
	}
	return targets, nil
}

// waitCDP polls /json/version until Chrome answers or timeout hits.
func waitCDP(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		var v map[string]any
		if err := cdpGet(port, "/json/version", &v); err == nil {
			return nil
		}
		time.Sleep(80 * time.Millisecond)
	}
	return fmt.Errorf("timed out waiting for chrome CDP on port %d", port)
}

func pickPageTarget(port int) (Target, error) {
	targets, err := listTargets(port)
	if err != nil {
		return Target{}, err
	}
	for _, t := range targets {
		if t.Type == "page" && t.WebSocketDebuggerURL != "" {
			return t, nil
		}
	}
	return Target{}, fmt.Errorf("no_page: no open page target (run: open <url>)")
}

func newPageTarget(port int, rawURL string) (Target, error) {
	var t Target
	if err := cdpPut(port, "/json/new?"+url.QueryEscape(rawURL), &t); err == nil && t.WebSocketDebuggerURL != "" {
		return t, nil
	}
	time.Sleep(150 * time.Millisecond)
	return pickPageTarget(port)
}

// CDP is one WebSocket connection: Call sends, readLoop routes replies.
type CDP struct {
	conn    *websocket.Conn
	next    atomic.Int64
	pending sync.Map // id -> chan rpcReply
	events  chan rpcEvent
}

type rpcReply struct {
	Result json.RawMessage `json:"result"`
	Error  *rpcError       `json:"error"`
}

type rpcError struct {
	Message string `json:"message"`
}

type rpcEvent struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

func dialCDP(ctx context.Context, wsURL string) (*CDP, error) {
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return nil, err
	}
	conn.SetReadLimit(64 << 20)
	c := &CDP{conn: conn, events: make(chan rpcEvent, 256)}
	c.next.Store(1)
	go c.readLoop()
	return c, nil
}

func (c *CDP) readLoop() {
	for {
		_, data, err := c.conn.Read(context.Background())
		if err != nil {
			return
		}
		var msg struct {
			ID     *int64          `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Result json.RawMessage `json:"result"`
			Error  *rpcError       `json:"error"`
		}
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.ID != nil {
			if ch, ok := c.pending.LoadAndDelete(*msg.ID); ok {
				ch.(chan rpcReply) <- rpcReply{Result: msg.Result, Error: msg.Error}
			}
			continue
		}
		select {
		case c.events <- rpcEvent{Method: msg.Method, Params: msg.Params}:
		default:
		}
	}
}

func (c *CDP) Call(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	id := c.next.Add(1)
	ch := make(chan rpcReply, 1)
	c.pending.Store(id, ch)
	defer c.pending.Delete(id)
	body, _ := json.Marshal(map[string]any{"id": id, "method": method, "params": params})
	if err := c.conn.Write(ctx, websocket.MessageText, body); err != nil {
		return nil, err
	}
	select {
	case reply := <-ch:
		if reply.Error != nil {
			return nil, fmt.Errorf("cdp %s: %s", method, reply.Error.Message)
		}
		return reply.Result, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c *CDP) Close() { _ = c.conn.Close(websocket.StatusNormalClosure, "") }

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}
