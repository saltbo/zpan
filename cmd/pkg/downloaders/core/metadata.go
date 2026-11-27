package core

import (
	"errors"
	"os"
	"path/filepath"
	"sort"

	"github.com/saltbo/zpan/internal/downloader"
)

// MetadataFileName is where an engine keeps a task's .torrent file in the
// task's download folder. The leading dot and the .torrent extension keep it
// out of every upload.
const MetadataFileName = ".zpan-metadata.torrent"

// SaveMetadata keeps a task's .torrent file beside its download, so the
// metadata outlives the engine's own copy.
func SaveMetadata(taskDir string, data []byte) error {
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(taskDir, MetadataFileName), data, 0o644)
}

// ReadMetadata returns the .torrent file kept in a task's download folder: the
// one SaveMetadata wrote, or else one the engine saved there itself.
func ReadMetadata(taskDir string) ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(taskDir, MetadataFileName))
	if err == nil {
		return data, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	matches, err := filepath.Glob(filepath.Join(taskDir, "*.torrent"))
	if err != nil {
		return nil, err
	}
	sort.Strings(matches)
	for _, match := range matches {
		if data, err := os.ReadFile(match); err == nil {
			return data, nil
		}
	}
	return nil, downloader.ErrTorrentMetadataPending
}
