package system

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHostnameFromFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hostname")
	if err := os.WriteFile(path, []byte("host-from-file\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := hostnameFromFile(path); got != "host-from-file" {
		t.Fatalf("expected host-from-file, got %q", got)
	}
}

func TestDownloaderHostnameFallsBackToOSHostname(t *testing.T) {
	got := DownloaderHostname()
	if got == "" {
		t.Fatal("expected non-empty hostname")
	}
}
