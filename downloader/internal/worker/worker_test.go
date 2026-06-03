package worker

import (
	"context"
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
