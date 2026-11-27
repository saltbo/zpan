package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/saltbo/zpan/internal/downloader"
	"github.com/saltbo/zpan/pkg/torrentmeta"
)

// MetadataFileName is where an engine keeps a task's .torrent file in the
// task's download folder. The leading dot and the .torrent extension keep it
// out of every upload.
const MetadataFileName = ".zpan-metadata.torrent"

// SaveMetadata keeps a task's .torrent file beside its download, so the
// metadata outlives the engine's own copy. It is written to a temporary file
// and renamed, so a reader never sees half of it.
func SaveMetadata(taskDir string, data []byte) error {
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(taskDir, MetadataFileName+".*.tmp")
	if err != nil {
		return err
	}
	_, writeErr := tmp.Write(data)
	closeErr := tmp.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	if err := os.Rename(tmp.Name(), filepath.Join(taskDir, MetadataFileName)); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	return nil
}

// ReadMetadata returns the .torrent file kept in a task's download folder: the
// one SaveMetadata wrote, or else the one the engine saved there itself as
// exactly <infoHash>.torrent (aria2's bt-save-metadata). A file that is absent,
// not yet a whole torrent, or of another torrent is pending: aria2 may still be
// writing it.
func ReadMetadata(taskDir string, infoHash string) ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(taskDir, MetadataFileName))
	if err == nil {
		return checkedMetadata(data, infoHash)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	infoHash = strings.ToLower(infoHash)
	if len(infoHash) != 40 {
		return nil, downloader.ErrTorrentMetadataPending
	}
	data, err = os.ReadFile(filepath.Join(taskDir, infoHash+".torrent"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, downloader.ErrTorrentMetadataPending
	}
	if err != nil {
		return nil, err
	}
	return checkedMetadata(data, infoHash)
}

func checkedMetadata(data []byte, infoHash string) ([]byte, error) {
	info, err := torrentmeta.InfoDict(data)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", downloader.ErrTorrentMetadataPending, err)
	}
	if infoHash != "" && torrentmeta.InfoHash(info) != strings.ToLower(infoHash) {
		return nil, fmt.Errorf("%w: the metadata file is of another torrent", downloader.ErrTorrentMetadataPending)
	}
	return data, nil
}
