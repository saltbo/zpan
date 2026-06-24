//go:build windows

package worker

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

func freeDiskBytes(path string) (int64, error) {
	statPath, err := existingStatPath(path)
	if err != nil {
		return 0, err
	}
	ptr, err := windows.UTF16PtrFromString(statPath)
	if err != nil {
		return 0, err
	}
	var freeBytes uint64
	if err := windows.GetDiskFreeSpaceEx(ptr, &freeBytes, nil, nil); err != nil {
		return 0, err
	}
	return int64(freeBytes), nil
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
