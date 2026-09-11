package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// Target is one entry of /json/list.
type Target struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	URL                  string `json:"url"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

func cdpGet(port int, path string, out any) error {
	u := fmt.Sprintf("http://127.0.0.1:%d%s", port, path)
	req, _ := http.NewRequest("GET", u, nil)
	resp, err := sharedHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("cdp %s: %s: %s", path, resp.Status, strings.TrimSpace(string(b)))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func cdpPut(port int, path string) error {
	u := fmt.Sprintf("http://127.0.0.1:%d%s", port, path)
	req, _ := http.NewRequest("PUT", u, nil)
	resp, err := sharedHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("cdp %s: %s", path, resp.Status)
	}
	return nil
}

func listTargets(port int) ([]Target, error) {
	var t []Target
	if err := cdpGet(port, "/json/list", &t); err != nil {
		return nil, err
	}
	return t, nil
}

func waitCDP(port int, timeout time.Duration) error {
	dead := time.Now().Add(timeout)
	for {
		var v map[string]any
		if err := cdpGet(port, "/json/version", &v); err == nil {
			return nil
		}
		if time.Now().After(dead) {
			return errors.New("timed out waiting for chrome CDP on port " + itoa(port))
		}
		time.Sleep(80 * time.Millisecond)
	}
}

func pickPageTarget(port int) (Target, error) {
	ts, err := listTargets(port)
	if err != nil {
		return Target{}, err
	}
	for _, t := range ts {
		if t.Type == "page" && t.WebSocketDebuggerURL != "" {
			return t, nil
		}
	}
	return Target{}, errors.New("no page target (open a page first)")
}

func newPageTarget(port int, urlStr string) (Target, error) {
	path := "/json/new"
	if urlStr != "" {
		path += "?about:blank"
		// Use query-escaped URL via manual construction to avoid double encoding issues.
		path = "/json/new?" + url.QueryEscape(urlStr)
		_ = urlStr
	}
	// Chrome's /json/new returns the created target as JSON.
	u := fmt.Sprintf("http://127.0.0.1:%d%s", port, path)
	req, _ := http.NewRequest("PUT", u, nil)
	resp, err := sharedHTTP.Do(req)
	if err != nil {
		return Target{}, err
	}
	defer resp.Body.Close()
	var t Target
	if err := json.NewDecoder(resp.Body).Decode(&t); err != nil {
		return Target{}, err
	}
	if t.WebSocketDebuggerURL == "" {
		// Fall back to listing.
		time.Sleep(150 * time.Millisecond)
		return pickPageTarget(port)
	}
	return t, nil
}

// ---- minimal WS JSON-RPC client ----

type rpcRequest struct {
	ID     int64  `json:"id"`
	Method string `json:"method"`
	Params any    `json:"params,omitempty"`
}

type rpcResponse struct {
	ID     int64           `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *rpcError       `json:"error,omitempty"`
	Method string          `json:"method,omitempty"` // events carry method, no id
	Params json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *rpcError) Error() string { return fmt.Sprintf("cdp %d: %s", e.Code, e.Message) }

type CDP struct {
	conn    *websocket.Conn
	next    atomic.Int64
	wmu     sync.Mutex
	pending sync.Map // int64 -> chan rpcResponse
	events  chan rpcResponse
	closed  atomic.Bool
	done    chan struct{} // closed when the connection dies (fail-fast for waiters)
}

func dialCDP(ctx context.Context, wsURL string) (*CDP, error) {
	// coder/websocket dial with compression disabled for localhost speed.
	opts := &websocket.DialOptions{
		CompressionMode: websocket.CompressionDisabled,
		HTTPClient:      sharedHTTP,
	}
	c, _, err := websocket.Dial(ctx, wsURL, opts)
	if err != nil {
		return nil, err
	}
	c.SetReadLimit(64 << 20) // 64MB: tool schemas/results can be large
	cl := &CDP{conn: c, events: make(chan rpcResponse, 256), done: make(chan struct{})}
	cl.next.Store(1)
	go cl.readLoop()
	return cl, nil
}

func (c *CDP) readLoop() {
	for {
		_, data, err := c.conn.Read(context.Background())
		if err != nil {
			close(c.done)
			return
		}
		var m rpcResponse
		if err := json.Unmarshal(data, &m); err != nil {
			continue
		}
		if m.ID != 0 {
			if ch, ok := c.pending.Load(m.ID); ok {
				ch.(chan rpcResponse) <- m
			}
			continue
		}
		// event
		select {
		case c.events <- m:
		default:
		}
	}
}

func (c *CDP) Call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := c.next.Add(1)
	ch := make(chan rpcResponse, 1)
	c.pending.Store(id, ch)
	defer c.pending.Delete(id)
	req := rpcRequest{ID: id, Method: method, Params: params}
	data, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	c.wmu.Lock()
	werr := c.conn.Write(ctx, websocket.MessageText, data)
	c.wmu.Unlock()
	if werr != nil {
		return nil, werr
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case m := <-ch:
		if m.Error != nil {
			return nil, m.Error
		}
		return m.Result, nil
	}
}

func (c *CDP) Close() {
	if c.closed.Swap(true) {
		return
	}
	_ = c.conn.Close(websocket.StatusNormalClosure, "")
}

func cdpCall(ctx context.Context, wsURL, method string, params any) (json.RawMessage, error) {
	c, err := dialCDP(ctx, wsURL)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	return c.Call(ctx, method, params)
}
