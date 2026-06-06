package engine

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/saltbo/zpan/downloader/internal/client"
)

type Result struct {
	Path  string
	Name  string
	Size  int64
	IsDir bool
	Seed  *Seed
}

type Seed struct {
	Engine   string
	ID       string
	InfoHash string
	Path     string
	Snapshot func(context.Context) (SeedSnapshot, error)
	Cleanup  func(context.Context) error
}

type SeedRef struct {
	TaskID   string
	Engine   string
	ID       string
	InfoHash string
	Path     string
}

type SeedSnapshot struct {
	Downloaded int64
	Total      *int64
	Bps        int64
	Runtime    *client.DownloadTaskRuntime
}

type Progress func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskRuntime) error

type TaskState string

const (
	TaskStateDownloading TaskState = "downloading"
	TaskStateCompleted   TaskState = "completed"
	TaskStateFailed      TaskState = "failed"
)

type TaskSnapshot struct {
	State      TaskState
	Downloaded int64
	Total      *int64
	Bps        int64
	Runtime    *client.DownloadTaskRuntime
	Result     *Result
	Error      string
}

type Engine interface {
	Name() string
	Capabilities() []string
	Check(ctx context.Context) error
	InspectTask(ctx context.Context, task client.DownloadTask) (TaskSnapshot, bool, error)
	Download(ctx context.Context, task client.DownloadTask, progress Progress) (Result, error)
}

type TaskResetter interface {
	ResetTask(ctx context.Context, task client.DownloadTask) error
}

type SeedRestorer interface {
	RestoreSeed(ctx context.Context, ref SeedRef) (*Seed, error)
}

type SessionSaver interface {
	SaveSession(ctx context.Context) error
}

type progressWriter struct {
	progress   Progress
	total      *int64
	downloaded int64
	lastBytes  int64
	lastAt     time.Time
}

func (p *progressWriter) Write(data []byte) (int, error) {
	n := len(data)
	p.downloaded += int64(n)
	now := time.Now()
	if now.Sub(p.lastAt) >= time.Second {
		bps := int64(float64(p.downloaded-p.lastBytes) / now.Sub(p.lastAt).Seconds())
		if err := p.progress(p.downloaded, p.total, bps, &client.DownloadTaskRuntime{Engine: "builtin", Phase: "downloading"}); err != nil {
			return n, err
		}
		p.lastBytes = p.downloaded
		p.lastAt = now
	}
	return n, nil
}

func resultFromPath(task client.DownloadTask, path string, fallbackName string) (Result, error) {
	info, err := os.Stat(path)
	if err != nil {
		candidate := filepath.Join(path, fallbackName)
		if fallbackName != "" {
			if _, statErr := os.Stat(candidate); statErr == nil {
				return resultFromPath(task, candidate, fallbackName)
			}
		}
		return Result{}, err
	}
	if !info.IsDir() {
		return resultFromFile(task, path)
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return Result{}, err
	}
	visible := make([]os.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if !entry.IsDir() && isDownloadSidecarPath(entry.Name()) {
			continue
		}
		visible = append(visible, entry)
	}
	if len(visible) == 1 && !visible[0].IsDir() {
		return resultFromFile(task, filepath.Join(path, visible[0].Name()))
	}
	if len(visible) == 1 && visible[0].IsDir() {
		return resultFromPath(task, filepath.Join(path, visible[0].Name()), visible[0].Name())
	}
	size, err := directorySize(path)
	if err != nil {
		return Result{}, err
	}
	return Result{Path: path, Name: outputName(task, fallbackName), Size: size, IsDir: true}, nil
}

type downloadedFile struct {
	path         string
	relativePath string
}

func resultFromDownloadedFiles(task client.DownloadTask, taskDir string, fallbackName string, files []downloadedFile) (Result, error) {
	if len(files) == 1 && !hasPathSeparator(files[0].relativePath) {
		if task.SourceType() != "http" {
			size, err := directorySize(taskDir)
			if err != nil {
				return Result{}, err
			}
			return Result{Path: taskDir, Name: singleFileTorrentFolderName(task, files[0].relativePath, fallbackName), Size: size, IsDir: true}, nil
		}
		return resultFromFile(task, files[0].path)
	}
	root, ok := singleTopLevelDirectory(files)
	if ok {
		path := filepath.Join(taskDir, root)
		size, err := directorySize(path)
		if err != nil {
			return Result{}, err
		}
		return Result{Path: path, Name: outputName(task, root), Size: size, IsDir: true}, nil
	}
	size, err := directorySize(taskDir)
	if err != nil {
		return Result{}, err
	}
	return Result{Path: taskDir, Name: outputName(task, fallbackName), Size: size, IsDir: true}, nil
}

func singleFileTorrentFolderName(task client.DownloadTask, filePath string, fallbackName string) string {
	if name := requestedOutputName(task); name != "" {
		return name
	}
	if name := payloadFallbackName(fallbackName); name != "" {
		return name
	}
	base := filepath.Base(filePath)
	if base != "" && base != "." && base != string(filepath.Separator) {
		ext := filepath.Ext(base)
		if ext != "" {
			base = strings.TrimSuffix(base, ext)
		}
		if base != "" {
			return base
		}
	}
	return outputName(task, fallbackName)
}

func payloadFallbackName(fallbackName string) string {
	name := strings.TrimSpace(fallbackName)
	if name == "" || isDownloadSidecarPath(name) {
		return ""
	}
	name = filepath.Base(name)
	if name == "." || name == string(filepath.Separator) {
		return ""
	}
	return name
}

func singleTopLevelDirectory(files []downloadedFile) (string, bool) {
	var root string
	for _, file := range files {
		segments := splitRelativePath(file.relativePath)
		if len(segments) < 2 {
			return "", false
		}
		if root == "" {
			root = segments[0]
			continue
		}
		if segments[0] != root {
			return "", false
		}
	}
	return root, root != ""
}

func splitRelativePath(path string) []string {
	normalized := filepath.ToSlash(filepath.Clean(path))
	if normalized == "." || normalized == "/" {
		return nil
	}
	parts := strings.Split(strings.Trim(normalized, "/"), "/")
	out := parts[:0]
	for _, part := range parts {
		if part != "" && part != "." {
			out = append(out, part)
		}
	}
	return out
}

func stripTorrentRoot(path string, torrentName string) string {
	parts := splitRelativePath(path)
	if len(parts) < 2 {
		return filepath.ToSlash(filepath.Clean(path))
	}
	if torrentName == "" || parts[0] != torrentName {
		return filepath.ToSlash(filepath.Clean(path))
	}
	return strings.Join(parts[1:], "/")
}

func hasPathSeparator(path string) bool {
	return len(splitRelativePath(path)) > 1
}

func isAria2MetadataPath(path string) bool {
	return strings.HasPrefix(path, "[MEMORY]") || strings.HasPrefix(path, "[METADATA]")
}

func isDownloadSidecarPath(path string) bool {
	base := filepath.Base(path)
	ext := filepath.Ext(base)
	return isAria2MetadataPath(path) ||
		isAria2MetadataPath(base) ||
		strings.EqualFold(ext, ".torrent") ||
		strings.EqualFold(ext, ".aria2")
}

func resultFromFile(task client.DownloadTask, path string) (Result, error) {
	info, err := os.Stat(path)
	if err != nil {
		return Result{}, err
	}
	return Result{Path: path, Name: outputName(task, filepath.Base(path)), Size: info.Size()}, nil
}

func directorySize(path string) (int64, error) {
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
		if isDownloadSidecarPath(entry.Name()) {
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

func downloadedPath(baseDir string, path string) (string, string) {
	if filepath.IsAbs(path) {
		abs := filepath.Clean(path)
		rel, err := filepath.Rel(baseDir, abs)
		if err != nil || isUnsafeRelativePath(rel) {
			return abs, filepath.Base(abs)
		}
		return abs, rel
	}
	rel := filepath.Clean(path)
	if isUnsafeRelativePath(rel) {
		return filepath.Join(baseDir, filepath.Base(rel)), filepath.Base(rel)
	}
	return filepath.Join(baseDir, rel), rel
}

func isUnsafeRelativePath(path string) bool {
	return path == ".." || strings.HasPrefix(path, ".."+string(filepath.Separator)) || filepath.IsAbs(path)
}

func outputName(task client.DownloadTask, fallback string) string {
	name := requestedOutputName(task)
	if name == "" {
		name = strings.TrimSpace(fallback)
	}
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = task.ID
	}
	return filepath.Base(name)
}

func requestedOutputName(task client.DownloadTask) string {
	name := strings.TrimSpace(task.Name())
	if name == "" {
		return ""
	}
	if task.SourceType() != "http" && isDownloadSidecarPath(name) {
		return ""
	}
	return filepath.Base(name)
}

func filenameFromURL(parsed *url.URL) string {
	name := filepath.Base(parsed.Path)
	if name == "." || name == "/" {
		return ""
	}
	return name
}
