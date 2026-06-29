//go:build !windows

package system

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestFreeDiskBytesReportsPathFreeDiskExactly(t *testing.T) {
	downloadDir := t.TempDir()
	var stat unix.Statfs_t
	if err := unix.Statfs(downloadDir, &stat); err != nil {
		t.Fatalf("statfs %s: %v", downloadDir, err)
	}
	want := int64(stat.Bavail) * int64(stat.Bsize)

	got, err := FreeDiskBytes(downloadDir)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("expected free disk %d, got %d", want, got)
	}
}

func TestExistingStatPathFallsBackToExistingParent(t *testing.T) {
	root := t.TempDir()
	missing := filepath.Join(root, "missing", "child")
	got, err := existingStatPath(missing)
	if err != nil {
		t.Fatal(err)
	}
	if got != root {
		t.Fatalf("expected root fallback %s, got %s", root, got)
	}
	got, err = existingStatPath("")
	if err != nil {
		t.Fatal(err)
	}
	if got != "." {
		t.Fatalf("expected current directory fallback, got %s", got)
	}
}

func TestExistingStatPathReturnsStatErrors(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can stat unreadable directories")
	}
	root := t.TempDir()
	locked := filepath.Join(root, "locked")
	if err := os.Mkdir(locked, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o700) })
	if _, err := existingStatPath(filepath.Join(locked, "child")); err == nil {
		t.Fatal("expected stat permission error")
	}
}
