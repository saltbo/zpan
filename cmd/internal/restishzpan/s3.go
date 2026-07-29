package restishzpan

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type storageClient interface {
	PutPart(ctx context.Context, part uploadPart, body io.Reader, size int64) (string, error)
}

type httpStorageClient struct {
	client *http.Client
}

func newHTTPStorageClient() httpStorageClient {
	return httpStorageClient{client: &http.Client{Timeout: 0}}
}

func (c httpStorageClient) PutPart(ctx context.Context, part uploadPart, body io.Reader, size int64) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, part.URL, body)
	if err != nil {
		return "", err
	}
	req.ContentLength = size
	for name, value := range part.Headers {
		req.Header.Set(name, value)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", storageStatusError{status: resp.StatusCode}
	}
	etag := normalizeETag(resp.Header.Get("ETag"))
	if etag == "" {
		return "", fmt.Errorf("storage PUT for part %d did not return an ETag", part.PartNumber)
	}
	return etag, nil
}

type storageStatusError struct {
	status int
}

func (e storageStatusError) Error() string {
	return fmt.Sprintf("storage PUT failed with HTTP %d", e.status)
}

func normalizeETag(value string) string {
	return strings.Trim(strings.TrimSpace(value), `"`)
}

func shouldResignAfterStorageError(err error) bool {
	var statusErr storageStatusError
	if !errors.As(err, &statusErr) {
		return false
	}
	return statusErr.status == http.StatusForbidden || statusErr.status == http.StatusUnauthorized || statusErr.status == http.StatusBadRequest
}

func expiresSoon(raw string, now time.Time) bool {
	if raw == "" {
		return false
	}
	expires, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return false
	}
	return !expires.After(now.Add(30 * time.Second))
}
