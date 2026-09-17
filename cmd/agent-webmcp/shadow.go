package main

// Closed-shadow-DOM access via the CDP DOM domain.
//
// Page JS cannot see inside closed shadow roots, but DOM.getDocument with
// pierce:true exposes them (backendNodeIds). We resolve each closed root to
// a JS object and run the same grounding/action snippets inside it via
// Runtime.callFunctionOn. Open trees keep the fast Runtime.evaluate path.

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// domRootIDs returns backendNodeIds of closed shadow roots in document order.
func domClosedRoots(ctx context.Context, c *CDP) ([]int64, error) {
	callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	raw, err := c.Call(callCtx, "DOM.getDocument", map[string]any{
		"depth": -1, "pierce": true,
	})
	if err != nil {
		return nil, err
	}
	var doc struct {
		Root json.RawMessage `json:"root"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	var ids []int64
	var walk func(m map[string]any)
	walk = func(m map[string]any) {
		if srs, _ := m["shadowRoots"].([]any); srs != nil {
			for _, s := range srs {
				if sm, ok := s.(map[string]any); ok {
					if t, _ := sm["shadowRootType"].(string); t == "closed" {
						if bid, _ := sm["backendNodeId"].(float64); bid != 0 {
							ids = append(ids, int64(bid))
						}
					}
					walk(sm)
				}
			}
		}
		if kids, _ := m["children"].([]any); kids != nil {
			for _, k := range kids {
				if km, ok := k.(map[string]any); ok {
					walk(km)
				}
			}
		}
		if cd, ok := m["contentDocument"].(map[string]any); ok {
			walk(cd)
		}
		// contentDocuments list form (pierced frames)
		if cds, _ := m["contentDocuments"].([]any); cds != nil {
			for _, d := range cds {
				if dm, ok := d.(map[string]any); ok {
					walk(dm)
				}
			}
		}
	}
	var root map[string]any
	if err := json.Unmarshal(doc.Root, &root); err != nil {
		return nil, err
	}
	walk(root)
	if ids == nil {
		ids = []int64{}
	}
	return ids, nil
}

// domResolve maps a backendNodeId to a runtime objectId usable with
// Runtime.callFunctionOn.
func domResolve(ctx context.Context, c *CDP, backendNodeID int64) (string, error) {
	callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	raw, err := c.Call(callCtx, "DOM.resolveNode", map[string]any{
		"backendNodeId": backendNodeID,
	})
	if err != nil {
		return "", err
	}
	var res struct {
		Object struct {
			ObjectID string `json:"objectId"`
		} `json:"object"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return "", err
	}
	if res.Object.ObjectID == "" {
		return "", fmt.Errorf("resolveNode returned no objectId")
	}
	return res.Object.ObjectID, nil
}

// callOn runs fn (a function declaration using `this` as its root) on the
// object and returns the by-value result, mirroring evalScript semantics.
func callOn(ctx context.Context, c *CDP, objectID, fn string, timeout time.Duration) (string, error) {
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	raw, err := c.Call(callCtx, "Runtime.callFunctionOn", map[string]any{
		"objectId": objectID, "functionDeclaration": fn,
		"returnByValue": true, "awaitPromise": true,
	})
	if err != nil {
		return "", err
	}
	var ev struct {
		Result struct {
			Type  string `json:"type"`
			Value any    `json:"value"`
		} `json:"result"`
		ExceptionDetails any `json:"exceptionDetails,omitempty"`
	}
	if err := json.Unmarshal(raw, &ev); err != nil {
		return "", err
	}
	if ev.ExceptionDetails != nil {
		b, _ := json.Marshal(ev.ExceptionDetails)
		return "", fmt.Errorf("js exception: %s", string(b))
	}
	switch v := ev.Result.Value.(type) {
	case string:
		return v, nil
	case nil:
		return "", nil
	default:
		b, _ := json.Marshal(v)
		return string(b), nil
	}
}
