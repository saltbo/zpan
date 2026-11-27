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

// Keeps is a set of local files a walk of a download lists whatever their
// names: the files of a torrent, which may be dot-files or .torrent files.
// Every other file is filtered as a download's (dot-files and the engine's
// control files are left out).
type Keeps map[string]bool

// NewKeeps is the set of the given local paths.
func NewKeeps(paths []string) Keeps {
	if len(paths) == 0 {
		return nil
	}
	keeps := make(Keeps, len(paths))
	for _, p := range paths {
		keeps[filepath.Clean(p)] = true
	}
	return keeps
}

// File is whether a walk lists the file at path, rel being its path relative
// to the walk's root.
func (k Keeps) File(path, rel string) bool {
	if k[filepath.Clean(path)] {
		return true
	}
	return !strings.HasPrefix(filepath.Base(path), ".") && !IsDownloadSidecarPath(filepath.ToSlash(rel))
}

// Dir is whether a walk enters the folder at path: any folder but a dot-folder,
// and a dot-folder holding a kept file.
func (k Keeps) Dir(path string) bool {
	if !strings.HasPrefix(filepath.Base(path), ".") {
		return true
	}
	prefix := filepath.Clean(path) + string(filepath.Separator)
	for kept := range k {
		if strings.HasPrefix(kept, prefix) {
			return true
		}
	}
	return false
}
