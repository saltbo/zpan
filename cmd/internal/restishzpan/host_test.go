package restishzpan

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"

	"github.com/rest-sh/restish/v2/plugin"
)

func TestPluginHostFetchAPISpecContextDelegates(t *testing.T) {
	hostToPluginR, hostToPluginW := newPipePair(t)
	pluginToHostR, pluginToHostW := newPipePair(t)
	client := plugin.NewCommandClient(hostToPluginR, pluginToHostW)
	h := NewPluginHost(client)

	requests := make(chan plugin.APISpecMsg, 1)
	go func() {
		defer close(requests)
		var req plugin.APISpecMsg
		if err := plugin.NewDecoder(pluginToHostR).ReadMessage(&req); err != nil {
			t.Errorf("read request: %v", err)
			return
		}
		requests <- req
		if err := plugin.WriteMessage(hostToPluginW, plugin.APISpecResponseMsg{
			Type:      plugin.MsgTypeAPISpecResponse,
			RequestID: req.RequestID,
			Name:      req.Name,
			Profile:   req.Profile,
			Operations: []plugin.APIOperation{
				{ID: opCreate, Method: "POST"},
			},
		}); err != nil {
			t.Errorf("write response: %v", err)
		}
	}()

	resp, err := h.FetchAPISpecContext(context.Background(), "zpan", "ci")
	if err != nil {
		t.Fatal(err)
	}
	req := <-requests
	if req.Name != "zpan" || req.Profile != "ci" {
		t.Fatalf("unexpected request: %#v", req)
	}
	if resp.Name != "zpan" || resp.Profile != "ci" || len(resp.Operations) != 1 || resp.Operations[0].ID != opCreate {
		t.Fatalf("unexpected response: %#v", resp)
	}
}

func TestPluginHostDoDelegates(t *testing.T) {
	hostToPluginR, hostToPluginW := newPipePair(t)
	pluginToHostR, pluginToHostW := newPipePair(t)
	client := plugin.NewCommandClient(hostToPluginR, pluginToHostW)
	h := NewPluginHost(client)

	requests := make(chan plugin.HTTPRequestMsg, 1)
	go func() {
		defer close(requests)
		var req plugin.HTTPRequestMsg
		if err := plugin.NewDecoder(pluginToHostR).ReadMessage(&req); err != nil {
			t.Errorf("read request: %v", err)
			return
		}
		requests <- req
		if err := plugin.WriteMessage(hostToPluginW, plugin.HTTPResponseMsg{
			Type:      plugin.MsgTypeHTTPResponse,
			RequestID: req.RequestID,
			Status:    200,
			Body:      map[string]any{"ok": true},
		}); err != nil {
			t.Errorf("write response: %v", err)
		}
	}()

	resp, err := h.Do(&plugin.HTTPRequestMsg{Method: "POST", URI: "zpan/api/objects", Timeout: 1})
	if err != nil {
		t.Fatal(err)
	}
	req := <-requests
	if req.Method != "POST" || req.URI != "zpan/api/objects" {
		t.Fatalf("unexpected request: %#v", req)
	}
	if resp.Status != 200 {
		t.Fatalf("status = %d, want 200", resp.Status)
	}
}

func TestPluginHostWritesMessages(t *testing.T) {
	var out bytes.Buffer
	h := NewPluginHost(plugin.NewCommandClient(bytes.NewReader(nil), &out))

	if err := h.Response(201, map[string][]string{"X-Test": {"1"}}, map[string]any{"id": "obj"}); err != nil {
		t.Fatal(err)
	}
	if err := h.Progress("working"); err != nil {
		t.Fatal(err)
	}
	if err := h.Warn("careful"); err != nil {
		t.Fatal(err)
	}

	dec := plugin.NewDecoder(&out)
	var resp plugin.ResponseMsg
	if err := dec.ReadMessage(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Type != plugin.MsgTypeResponse || resp.Status != 201 {
		t.Fatalf("unexpected response message: %#v", resp)
	}
	var progress plugin.ProgressMsg
	if err := dec.ReadMessage(&progress); err != nil {
		t.Fatal(err)
	}
	if progress.Text != "working" {
		t.Fatalf("unexpected progress: %#v", progress)
	}
	var warn plugin.WarnMsg
	if err := dec.ReadMessage(&warn); err != nil {
		t.Fatal(err)
	}
	if warn.Text != "careful" {
		t.Fatalf("unexpected warn: %#v", warn)
	}
}

func TestDecodeBody(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		resp, err := decodeBody[map[string]string](&plugin.HTTPResponseMsg{Status: 200, Body: map[string]any{"id": "obj"}})
		if err != nil {
			t.Fatal(err)
		}
		if resp["id"] != "obj" {
			t.Fatalf("unexpected body: %#v", resp)
		}
	})

	t.Run("nil response", func(t *testing.T) {
		_, err := decodeBody[map[string]any](nil)
		if err == nil || !strings.Contains(err.Error(), "missing HTTP response") {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("delegated error", func(t *testing.T) {
		_, err := decodeBody[map[string]any](&plugin.HTTPResponseMsg{Status: 200, Error: "boom"})
		if err == nil || !strings.Contains(err.Error(), "boom") {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("status error", func(t *testing.T) {
		_, err := decodeBody[map[string]any](&plugin.HTTPResponseMsg{Status: 400, Body: map[string]any{"error": "bad"}})
		if err == nil || !strings.Contains(err.Error(), "HTTP 400") {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("decode error", func(t *testing.T) {
		_, err := decodeBody[struct {
			ID string `json:"id"`
		}](&plugin.HTTPResponseMsg{Status: 200, Body: map[string]any{"id": []string{"bad"}}})
		if err == nil || !strings.Contains(err.Error(), "decode delegated response body") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func TestHTTPStatusErrorFormatting(t *testing.T) {
	if msg := (httpStatusError{status: 500}).Error(); !strings.Contains(msg, "HTTP 500") {
		t.Fatalf("unexpected error: %s", msg)
	}
	if msg := (httpStatusError{status: 400, body: map[string]any{"error": "bad"}}).Error(); !strings.Contains(msg, `"error":"bad"`) {
		t.Fatalf("unexpected error: %s", msg)
	}
	errBody := map[string]any{"bad": func() {}}
	if msg := (httpStatusError{status: 502, body: errBody}).Error(); !strings.Contains(msg, "HTTP 502") {
		t.Fatalf("unexpected error: %s", msg)
	}
}

func newPipePair(t *testing.T) (*io.PipeReader, *io.PipeWriter) {
	t.Helper()
	return io.Pipe()
}
