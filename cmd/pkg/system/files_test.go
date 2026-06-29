package system

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDirectorySizeSkipsHiddenAndSidecarFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "movie.mkv"), []byte("movie"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "movie.mkv.aria2"), []byte("sidecar"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "payload.torrent"), []byte("torrent"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".hidden"), []byte("hidden"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".hidden-dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".hidden-dir", "ignored.bin"), []byte("ignored"), 0o644); err != nil {
		t.Fatal(err)
	}

	size, err := DirectorySize(root)
	if err != nil {
		t.Fatal(err)
	}
	if size != int64(len("movie")) {
		t.Fatalf("expected visible payload size, got %d", size)
	}
}

func TestDownloadSidecarDetection(t *testing.T) {
	cases := map[string]bool{
		"payload.torrent":      true,
		"payload.TORRENT":      true,
		"payload.aria2":        true,
		"[MEMORY]abc":          true,
		"dir/[METADATA]abc":    true,
		"payload.mkv":          false,
		"payload.torrent/file": false,
	}
	for path, want := range cases {
		if got := IsDownloadSidecarPath(path); got != want {
			t.Fatalf("IsDownloadSidecarPath(%q)=%v, want %v", path, got, want)
		}
	}
	if !IsAria2MetadataPath("[METADATA]abc") || IsAria2MetadataPath("abc[METADATA]") {
		t.Fatal("unexpected aria2 metadata detection")
	}
}
