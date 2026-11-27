package core

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/saltbo/zpan/internal/downloader"
)

func TestReadMetadataPrefersTheKeptCopyThenTheEnginesFile(t *testing.T) {
	dir := t.TempDir()
	if _, err := ReadMetadata(dir); !errors.Is(err, downloader.ErrTorrentMetadataPending) {
		t.Fatalf("err = %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "abcdef.torrent"), []byte("aria2"), 0o644); err != nil {
		t.Fatal(err)
	}
	if data, err := ReadMetadata(dir); err != nil || string(data) != "aria2" {
		t.Fatalf("data = %q, %v", data, err)
	}
	if err := SaveMetadata(dir, []byte("kept")); err != nil {
		t.Fatal(err)
	}
	if data, err := ReadMetadata(dir); err != nil || string(data) != "kept" {
		t.Fatalf("data = %q, %v", data, err)
	}
}
