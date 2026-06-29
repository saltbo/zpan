package core

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/saltbo/zpan/internal/downloader"
	"github.com/saltbo/zpan/pkg/system"
)

type DownloadedFile struct {
	Path         string
	RelativePath string
}

func ResultFromPath(task downloader.DownloadTask, path string, fallbackName string) (downloader.Result, error) {
	info, err := os.Stat(path)
	if err != nil {
		candidate := filepath.Join(path, fallbackName)
		if fallbackName != "" {
			if _, statErr := os.Stat(candidate); statErr == nil {
				return ResultFromPath(task, candidate, fallbackName)
			}
		}
		return downloader.Result{}, err
	}
	if !info.IsDir() {
		return resultFromFile(task, path)
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return downloader.Result{}, err
	}
	visible := make([]os.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if !entry.IsDir() && system.IsDownloadSidecarPath(entry.Name()) {
			continue
		}
		visible = append(visible, entry)
	}
	if len(visible) == 1 && !visible[0].IsDir() {
		return resultFromFile(task, filepath.Join(path, visible[0].Name()))
	}
	if len(visible) == 1 && visible[0].IsDir() {
		return ResultFromPath(task, filepath.Join(path, visible[0].Name()), visible[0].Name())
	}
	size, err := system.DirectorySize(path)
	if err != nil {
		return downloader.Result{}, err
	}
	return downloader.Result{Path: path, Name: outputName(task, fallbackName), Size: size, IsDir: true}, nil
}

func ResultFromDownloadedFiles(task downloader.DownloadTask, taskDir string, fallbackName string, files []DownloadedFile) (downloader.Result, error) {
	if len(files) == 1 && !hasPathSeparator(files[0].RelativePath) {
		if task.SourceType() != "http" {
			size, err := system.DirectorySize(taskDir)
			if err != nil {
				return downloader.Result{}, err
			}
			return downloader.Result{Path: taskDir, Name: singleFileTorrentFolderName(task, files[0].RelativePath, fallbackName), Size: size, IsDir: true}, nil
		}
		return resultFromFile(task, files[0].Path)
	}
	root, ok := singleTopLevelDirectory(files)
	if ok {
		path := filepath.Join(taskDir, root)
		size, err := system.DirectorySize(path)
		if err != nil {
			return downloader.Result{}, err
		}
		return downloader.Result{Path: path, Name: outputName(task, root), Size: size, IsDir: true}, nil
	}
	size, err := system.DirectorySize(taskDir)
	if err != nil {
		return downloader.Result{}, err
	}
	return downloader.Result{Path: taskDir, Name: outputName(task, fallbackName), Size: size, IsDir: true}, nil
}

func singleFileTorrentFolderName(task downloader.DownloadTask, filePath string, fallbackName string) string {
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
	if name == "" || system.IsDownloadSidecarPath(name) {
		return ""
	}
	name = filepath.Base(name)
	if name == "." || name == string(filepath.Separator) {
		return ""
	}
	return name
}

func singleTopLevelDirectory(files []DownloadedFile) (string, bool) {
	var root string
	for _, file := range files {
		segments := splitRelativePath(file.RelativePath)
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

func StripTorrentRoot(path string, torrentName string) string {
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

func OutputName(task downloader.DownloadTask, fallback string) string {
	return outputName(task, fallback)
}

func RequestedOutputName(task downloader.DownloadTask) string {
	return requestedOutputName(task)
}

func FilenameFromURL(parsed *url.URL) string {
	return filenameFromURL(parsed)
}

func resultFromFile(task downloader.DownloadTask, path string) (downloader.Result, error) {
	info, err := os.Stat(path)
	if err != nil {
		return downloader.Result{}, err
	}
	return downloader.Result{Path: path, Name: outputName(task, filepath.Base(path)), Size: info.Size()}, nil
}

func DownloadedPath(baseDir string, path string) (string, string) {
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

func outputName(task downloader.DownloadTask, fallback string) string {
	name := requestedOutputName(task)
	if name == "" {
		name = strings.TrimSpace(fallback)
	}
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = task.ID
	}
	return filepath.Base(name)
}

func requestedOutputName(task downloader.DownloadTask) string {
	name := strings.TrimSpace(task.Name())
	if name == "" {
		return ""
	}
	if task.SourceType() != "http" && system.IsDownloadSidecarPath(name) {
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
