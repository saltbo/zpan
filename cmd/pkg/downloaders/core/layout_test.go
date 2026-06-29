package core

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/saltbo/zpan/internal/downloader"
)

func downloadTask(id, sourceType, sourceURI string) downloader.DownloadTask {
	return downloader.DownloadTask{
		ID:     id,
		Source: downloader.Source{Type: sourceType, URI: sourceURI},
	}
}

func downloadTaskWithName(id, sourceType, sourceURI, name string) downloader.DownloadTask {
	task := downloadTask(id, sourceType, sourceURI)
	task.Destination.Name = name
	return task
}

func TestStripTorrentRoot(t *testing.T) {
	cases := []struct {
		name        string
		path        string
		torrentName string
		want        string
	}{
		{name: "nested torrent root", path: "Album/Disc 1/track.flac", torrentName: "Album", want: "Disc 1/track.flac"},
		{name: "single file named like torrent", path: "Album", torrentName: "Album", want: "Album"},
		{name: "different root", path: "Other/track.flac", torrentName: "Album", want: "Other/track.flac"},
		{name: "empty torrent name", path: "Album/track.flac", torrentName: "", want: "Album/track.flac"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StripTorrentRoot(tc.path, tc.torrentName); got != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, got)
			}
		})
	}
}

func TestResultFromPathReturnsDirectory(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(filepath.Join(taskDir, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "folder", "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "folder", "b.txt"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "fixture.torrent"), []byte("torrent"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "folder.aria2"), []byte("control"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := ResultFromPath(downloadTaskWithName("task-1", "http", "https://example.com/bundle", "bundle"), taskDir, "bundle")
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsDir {
		t.Fatal("expected directory result")
	}
	if result.Name != "bundle" {
		t.Fatalf("expected bundle, got %s", result.Name)
	}
	if result.Size != 2 {
		t.Fatalf("expected directory size 2, got %d", result.Size)
	}
	if result.Path != filepath.Join(taskDir, "folder") {
		t.Fatalf("expected content dir path, got %s", result.Path)
	}
}

func TestResultFromDownloadedFilesWrapsMultipleTopLevelEntries(t *testing.T) {
	dir := t.TempDir()
	taskDir := filepath.Join(dir, "task-1")
	if err := os.MkdirAll(filepath.Join(taskDir, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "folder", "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "root.txt"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := ResultFromDownloadedFiles(downloadTaskWithName("task-1", "http", "https://example.com/bundle", "bundle"), taskDir, "fallback", []DownloadedFile{
		{Path: filepath.Join(taskDir, "folder", "a.txt"), RelativePath: filepath.Join("folder", "a.txt")},
		{Path: filepath.Join(taskDir, "root.txt"), RelativePath: "root.txt"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != taskDir {
		t.Fatalf("expected task dir wrapper path, got %s", result.Path)
	}
	if result.Name != "bundle" {
		t.Fatalf("expected bundle wrapper name, got %s", result.Name)
	}
}

func TestOutputNameIgnoresTorrentTaskNameForBT(t *testing.T) {
	name := OutputName(
		downloadTaskWithName("task-1", "magnet", "magnet:?xt=urn:btih:abc", "movie.torrent"),
		"movie.mkv",
	)

	if name != "movie.mkv" {
		t.Fatalf("expected payload fallback name, got %s", name)
	}
}

func TestOutputNameAllowsHTTPDownloadName(t *testing.T) {
	name := OutputName(
		downloadTaskWithName("task-1", "http", "https://example.com/movie.torrent", "movie.torrent"),
		"download",
	)

	if name != "movie.torrent" {
		t.Fatalf("expected HTTP task name to be preserved, got %s", name)
	}
}

func TestResultFromPathSingleFileAndFallbackCandidate(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "payload.bin")
	if err := os.WriteFile(file, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := ResultFromPath(downloadTaskWithName("task-1", "http", "", ""), file, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != file || result.Name != "payload.bin" || result.Size != int64(len("payload")) || result.IsDir {
		t.Fatalf("unexpected single file result: %#v", result)
	}

	if _, err := ResultFromPath(downloadTask("task-1", "http", ""), filepath.Join(dir, "missing"), "absent.bin"); err == nil {
		t.Fatal("expected missing path error")
	}
}

func TestResultFromDownloadedFilesSingleFileVariants(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "movie.mkv")
	if err := os.WriteFile(file, []byte("movie"), 0o644); err != nil {
		t.Fatal(err)
	}
	httpResult, err := ResultFromDownloadedFiles(downloadTask("task-1", "http", ""), dir, "", []DownloadedFile{{Path: file, RelativePath: "movie.mkv"}})
	if err != nil {
		t.Fatal(err)
	}
	if httpResult.Path != file || httpResult.IsDir {
		t.Fatalf("expected HTTP single file result, got %#v", httpResult)
	}
	btResult, err := ResultFromDownloadedFiles(downloadTask("task-1", "magnet", ""), dir, "Movie", []DownloadedFile{{Path: file, RelativePath: "movie.mkv"}})
	if err != nil {
		t.Fatal(err)
	}
	if btResult.Path != dir || !btResult.IsDir || btResult.Name != "Movie" {
		t.Fatalf("expected BT folder wrapper, got %#v", btResult)
	}
}

func TestResultFromDownloadedFilesSingleTopLevelDirectory(t *testing.T) {
	dir := t.TempDir()
	album := filepath.Join(dir, "Album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(album, "track.flac"), []byte("track"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := ResultFromDownloadedFiles(downloadTask("task-1", "magnet", ""), dir, "", []DownloadedFile{{Path: filepath.Join(album, "track.flac"), RelativePath: filepath.Join("Album", "track.flac")}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != album || result.Name != "Album" || !result.IsDir {
		t.Fatalf("expected album directory result, got %#v", result)
	}
}

func TestDownloadedPathAndURLHelpers(t *testing.T) {
	base := t.TempDir()
	absInside := filepath.Join(base, "dir", "file.txt")
	path, rel := DownloadedPath(base, absInside)
	if path != absInside || rel != filepath.Join("dir", "file.txt") {
		t.Fatalf("unexpected inside path: %q %q", path, rel)
	}
	absOutside := filepath.Join(filepath.Dir(base), "outside.txt")
	path, rel = DownloadedPath(base, absOutside)
	if path != absOutside || rel != filepath.Base(absOutside) {
		t.Fatalf("unexpected outside path: %q %q", path, rel)
	}
	path, rel = DownloadedPath(base, "../escape.txt")
	if path != filepath.Join(base, "escape.txt") || rel != "escape.txt" {
		t.Fatalf("unexpected unsafe path handling: %q %q", path, rel)
	}
	parsed, err := url.Parse("https://example.com/files/movie.mkv?token=1")
	if err != nil {
		t.Fatal(err)
	}
	if FilenameFromURL(parsed) != "movie.mkv" {
		t.Fatalf("unexpected URL filename: %q", FilenameFromURL(parsed))
	}
	parsed, _ = url.Parse("https://example.com/")
	if FilenameFromURL(parsed) != "" {
		t.Fatalf("expected empty URL filename, got %q", FilenameFromURL(parsed))
	}
}

func TestRequestedOutputNameAndFallbacks(t *testing.T) {
	if RequestedOutputName(downloadTaskWithName("task-1", "http", "", " dir/file.bin ")) != "file.bin" {
		t.Fatal("expected requested HTTP output basename")
	}
	if RequestedOutputName(downloadTaskWithName("task-1", "magnet", "", "payload.torrent")) != "" {
		t.Fatal("expected BT sidecar output name to be ignored")
	}
	if OutputName(downloadTask("task-1", "http", ""), "") != "task-1" {
		t.Fatal("expected task id output fallback")
	}
}

func TestLayoutPrivateFallbackBranches(t *testing.T) {
	task := downloadTask("task-1", "magnet", "")
	if got := singleFileTorrentFolderName(task, "movie.mkv", ""); got != "movie" {
		t.Fatalf("expected basename without extension, got %q", got)
	}
	if got := singleFileTorrentFolderName(task, ".", ""); got != "task-1" {
		t.Fatalf("expected task id fallback, got %q", got)
	}
	if got := payloadFallbackName("payload.torrent"); got != "" {
		t.Fatalf("expected sidecar fallback to be ignored, got %q", got)
	}
	if got := payloadFallbackName("/"); got != "" {
		t.Fatalf("expected root fallback to be ignored, got %q", got)
	}
	if root, ok := singleTopLevelDirectory([]DownloadedFile{{RelativePath: "Album/one.flac"}, {RelativePath: "Other/two.flac"}}); ok || root != "" {
		t.Fatalf("expected mixed roots to be rejected, got %q %v", root, ok)
	}
	if parts := splitRelativePath("."); parts != nil {
		t.Fatalf("expected empty path parts, got %#v", parts)
	}
	if _, err := resultFromFile(task, filepath.Join(t.TempDir(), "missing.bin")); err == nil {
		t.Fatal("expected missing file error")
	}
}
