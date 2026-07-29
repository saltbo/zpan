package restishzpan

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/rest-sh/restish/v2/plugin"
)

type host interface {
	FetchAPISpecContext(ctx context.Context, api, profile string) (*plugin.APISpecResponseMsg, error)
	Do(req *plugin.HTTPRequestMsg) (*plugin.HTTPResponseMsg, error)
	Response(status int, headers map[string][]string, body any) error
	Progress(text string) error
	Warn(text string) error
}

type PluginHost struct {
	client *plugin.CommandClient
}

func NewPluginHost(client *plugin.CommandClient) *PluginHost {
	return &PluginHost{client: client}
}

func (h *PluginHost) FetchAPISpecContext(ctx context.Context, api, profile string) (*plugin.APISpecResponseMsg, error) {
	return h.client.FetchAPISpecContext(ctx, api, profile)
}

func (h *PluginHost) Do(req *plugin.HTTPRequestMsg) (*plugin.HTTPResponseMsg, error) {
	return h.client.Do(req)
}

func (h *PluginHost) Response(status int, headers map[string][]string, body any) error {
	return h.client.Response(status, headers, body)
}

func (h *PluginHost) Progress(text string) error {
	return h.client.Progress(text)
}

func (h *PluginHost) Warn(text string) error {
	return h.client.Warn(text)
}

func decodeBody[T any](resp *plugin.HTTPResponseMsg) (T, error) {
	var out T
	if resp == nil {
		return out, fmt.Errorf("missing HTTP response")
	}
	if resp.Error != "" {
		return out, fmt.Errorf("%s", resp.Error)
	}
	if resp.Status < 200 || resp.Status >= 300 {
		return out, httpStatusError{status: resp.Status, body: resp.Body}
	}
	data, err := json.Marshal(resp.Body)
	if err != nil {
		return out, fmt.Errorf("encode delegated response body: %w", err)
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return out, fmt.Errorf("decode delegated response body: %w", err)
	}
	return out, nil
}

type httpStatusError struct {
	status int
	body   any
}

func (e httpStatusError) Error() string {
	if e.body == nil {
		return fmt.Sprintf("delegated request failed with HTTP %d", e.status)
	}
	data, err := json.Marshal(e.body)
	if err != nil {
		return fmt.Sprintf("delegated request failed with HTTP %d", e.status)
	}
	return fmt.Sprintf("delegated request failed with HTTP %d: %s", e.status, string(data))
}
