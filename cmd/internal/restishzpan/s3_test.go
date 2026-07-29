package restishzpan

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHTTPStorageClientPutPart(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		var gotType string
		var gotBody []byte
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotType = r.Header.Get("Content-Type")
			var err error
			gotBody, err = ioReadAll(r.Body)
			if err != nil {
				t.Errorf("read body: %v", err)
			}
			w.Header().Set("ETag", ` "etag-1" `)
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()

		client := newHTTPStorageClient()
		etag, err := client.PutPart(context.Background(), uploadPart{
			PartNumber: 1,
			URL:        srv.URL,
			Headers:    map[string]string{"Content-Type": "text/plain"},
		}, bytes.NewReader([]byte("abc")), 3)
		if err != nil {
			t.Fatal(err)
		}
		if etag != "etag-1" {
			t.Fatalf("etag = %q, want %q", etag, "etag-1")
		}
		if gotType != "text/plain" || string(gotBody) != "abc" {
			t.Fatalf("unexpected request: content-type=%q body=%q", gotType, gotBody)
		}
	})

	t.Run("status error", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "denied", http.StatusForbidden)
		}))
		defer srv.Close()

		_, err := newHTTPStorageClient().PutPart(context.Background(), uploadPart{PartNumber: 2, URL: srv.URL}, bytes.NewReader([]byte("x")), 1)
		var statusErr storageStatusError
		if !errors.As(err, &statusErr) || statusErr.status != http.StatusForbidden {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("missing etag", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()

		_, err := newHTTPStorageClient().PutPart(context.Background(), uploadPart{PartNumber: 3, URL: srv.URL}, bytes.NewReader([]byte("x")), 1)
		if err == nil || !strings.Contains(err.Error(), "did not return an ETag") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func TestStorageHelpers(t *testing.T) {
	if got := normalizeETag(` "abc" `); got != "abc" {
		t.Fatalf("normalizeETag = %q", got)
	}

	if !shouldResignAfterStorageError(storageStatusError{status: http.StatusForbidden}) {
		t.Fatal("expected forbidden to require re-sign")
	}
	if !shouldResignAfterStorageError(storageStatusError{status: http.StatusUnauthorized}) {
		t.Fatal("expected unauthorized to require re-sign")
	}
	if !shouldResignAfterStorageError(storageStatusError{status: http.StatusBadRequest}) {
		t.Fatal("expected bad request to require re-sign")
	}
	if shouldResignAfterStorageError(storageStatusError{status: http.StatusInternalServerError}) {
		t.Fatal("expected internal server error not to require re-sign")
	}
	if shouldResignAfterStorageError(errors.New("plain")) {
		t.Fatal("expected plain error not to require re-sign")
	}

	now := time.Now()
	if expiresSoon("", now) {
		t.Fatal("empty expiry should not expire soon")
	}
	if expiresSoon("not-a-time", now) {
		t.Fatal("invalid expiry should not expire soon")
	}
	if !expiresSoon(now.Add(20*time.Second).Format(time.RFC3339), now) {
		t.Fatal("expected near expiry to be true")
	}
	if expiresSoon(now.Add(2*time.Minute).Format(time.RFC3339), now) {
		t.Fatal("expected distant expiry to be false")
	}
}

func ioReadAll(body io.ReadCloser) ([]byte, error) {
	defer body.Close()
	return io.ReadAll(body)
}
