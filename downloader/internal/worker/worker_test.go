package worker

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/saltbo/zpan/downloader/internal/config"
)

func TestResolveEngineRejectsUnknownConfiguredEngine(t *testing.T) {
	w := New(config.Config{Engine: "bad-engine"})

	err := w.resolveEngine(context.Background())
	if err == nil {
		t.Fatal("expected unsupported engine error")
	}
	if !strings.Contains(err.Error(), "bad-engine") {
		t.Fatalf("expected error to mention configured engine, got %v", err)
	}
}

func TestUploadFileSendsContentLength(t *testing.T) {
	path := writeTempFile(t, "hello world")
	var contentLength string
	var contentDisposition string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentLength = r.Header.Get("Content-Length")
		contentDisposition = r.Header.Get("Content-Disposition")
		if r.TransferEncoding != nil {
			t.Fatalf("expected fixed-length upload, got transfer encoding %v", r.TransferEncoding)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	if err := uploadFile(context.Background(), server.URL, path, `attachment; filename="hello.txt"`); err != nil {
		t.Fatalf("uploadFile returned error: %v", err)
	}
	if contentLength != "11" {
		t.Fatalf("expected Content-Length 11, got %q", contentLength)
	}
	if contentDisposition != `attachment; filename="hello.txt"` {
		t.Fatalf("expected Content-Disposition header, got %q", contentDisposition)
	}
}

func TestUploadFileIncludesErrorBody(t *testing.T) {
	path := writeTempFile(t, "hello")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "signature mismatch", http.StatusForbidden)
	}))
	defer server.Close()

	err := uploadFile(context.Background(), server.URL, path, "")
	if err == nil {
		t.Fatal("expected uploadFile error")
	}
	if !strings.Contains(err.Error(), "403 Forbidden") || !strings.Contains(err.Error(), "signature mismatch") {
		t.Fatalf("expected status and response body in error, got %v", err)
	}
}

func TestTaskErrorMessageTruncatesToSchemaLimit(t *testing.T) {
	err := errors.New(strings.Repeat("x", maxTaskErrorMessageLength+100))

	msg := taskErrorMessage(err)
	if len(msg) != maxTaskErrorMessageLength {
		t.Fatalf("expected message length %d, got %d", maxTaskErrorMessageLength, len(msg))
	}
	if !strings.HasSuffix(msg, "...") {
		t.Fatalf("expected truncated message to end with ellipsis, got %q", msg[len(msg)-10:])
	}
}

func writeTempFile(t *testing.T, content string) string {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "upload-*")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(content); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return file.Name()
}
