package core

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/saltbo/zpan/internal/downloader"
	"github.com/saltbo/zpan/pkg/torrentmeta"
)

func torrentWithInfo(name string) ([]byte, string) {
	info := []byte("d4:name" + string(rune('0'+len(name))) + ":" + name + "e")
	return append(append([]byte("d4:info"), info...), 'e'), torrentmeta.InfoHash(info)
}

func TestReadMetadataPrefersTheKeptCopyThenTheEnginesFile(t *testing.T) {
	dir := t.TempDir()
	data, hash := torrentWithInfo("a")
	if _, err := ReadMetadata(dir, hash); !errors.Is(err, downloader.ErrTorrentMetadataPending) {
		t.Fatalf("err = %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, hash+".torrent"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	if got, err := ReadMetadata(dir, hash); err != nil || string(got) != string(data) {
		t.Fatalf("data = %q, %v", got, err)
	}
	kept, _ := torrentWithInfo("b")
	if err := SaveMetadata(dir, kept); err != nil {
		t.Fatal(err)
	}
	if got, err := ReadMetadata(dir, ""); err != nil || string(got) != string(kept) {
		t.Fatalf("data = %q, %v", got, err)
	}
	if entries, _ := filepath.Glob(filepath.Join(dir, "*.tmp")); len(entries) != 0 {
		t.Fatalf("temporary files left: %v", entries)
	}
}

func TestReadMetadataTreatsOtherAndPartialFilesAsPending(t *testing.T) {
	dir := t.TempDir()
	data, hash := torrentWithInfo("a")
	other, otherHash := torrentWithInfo("b")
	// Another torrent's file is never read, whatever its name.
	if err := os.WriteFile(filepath.Join(dir, otherHash+".torrent"), other, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadMetadata(dir, hash); !errors.Is(err, downloader.ErrTorrentMetadataPending) {
		t.Fatalf("err = %v", err)
	}
	// A file still being written is pending, and so is one of another torrent
	// under this torrent's name.
	if err := os.WriteFile(filepath.Join(dir, hash+".torrent"), data[:len(data)-3], 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadMetadata(dir, hash); !errors.Is(err, downloader.ErrTorrentMetadataPending) {
		t.Fatalf("partial err = %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, hash+".torrent"), other, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadMetadata(dir, hash); !errors.Is(err, downloader.ErrTorrentMetadataPending) {
		t.Fatalf("mismatch err = %v", err)
	}
	// Without an infoHash only the kept copy counts.
	if _, err := ReadMetadata(dir, ""); !errors.Is(err, downloader.ErrTorrentMetadataPending) {
		t.Fatalf("no hash err = %v", err)
	}
}
