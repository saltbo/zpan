//go:build !windows

package worker

import (
	"testing"

	"github.com/saltbo/zpan/internal/config"
	"golang.org/x/sys/unix"
)

func TestHeartbeatReportsDownloadDirFreeDiskExactly(t *testing.T) {
	downloadDir := t.TempDir()
	var stat unix.Statfs_t
	if err := unix.Statfs(downloadDir, &stat); err != nil {
		t.Fatalf("statfs %s: %v", downloadDir, err)
	}
	want := int64(stat.Bavail) * int64(stat.Bsize)

	w := NewWithAPI(config.Config{DownloadDir: downloadDir}, &recordingAPI{})

	if got := w.heartbeat().FreeDiskBytes; got != want {
		t.Fatalf("expected heartbeat free disk %d, got %d", want, got)
	}
}
