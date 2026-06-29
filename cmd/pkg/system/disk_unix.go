//go:build !windows

package system

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func FreeDiskBytes(path string) (int64, error) {
	statPath, err := existingStatPath(path)
	if err != nil {
		return 0, err
	}
	var stat unix.Statfs_t
	if err := unix.Statfs(statPath, &stat); err != nil {
		return 0, err
	}
	return int64(stat.Bavail) * int64(stat.Bsize), nil
}

func existingStatPath(path string) (string, error) {
	if path == "" {
		return ".", nil
	}
	path = filepath.Clean(path)
	for {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		} else if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(path)
		if parent == path {
			return "", os.ErrNotExist
		}
		path = parent
	}
}
