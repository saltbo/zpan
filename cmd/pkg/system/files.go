package system

import (
	"os"
	"path/filepath"
	"strings"
)

func DirectorySize(path string) (int64, error) {
	var total int64
	err := filepath.WalkDir(path, func(entryPath string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entryPath == path {
			return nil
		}
		if strings.HasPrefix(entry.Name(), ".") {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if IsDownloadSidecarPath(entry.Name()) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		return nil
	})
	return total, err
}

func IsDownloadSidecarPath(path string) bool {
	base := filepath.Base(path)
	ext := filepath.Ext(base)
	return IsAria2MetadataPath(path) ||
		IsAria2MetadataPath(base) ||
		strings.EqualFold(ext, ".torrent") ||
		strings.EqualFold(ext, ".aria2")
}

func IsAria2MetadataPath(path string) bool {
	return strings.HasPrefix(path, "[MEMORY]") || strings.HasPrefix(path, "[METADATA]")
}
