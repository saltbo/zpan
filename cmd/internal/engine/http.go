package engine

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/saltbo/zpan/cmd/internal/client"
)

type HTTP struct {
	Dir string
}

func (h HTTP) Name() string {
	return "builtin"
}

func (h HTTP) Capabilities() []string {
	return []string{"http"}
}

func (h HTTP) Check(ctx context.Context) error {
	if err := os.MkdirAll(h.Dir, 0o755); err != nil {
		return err
	}
	file, err := os.CreateTemp(h.Dir, ".zpan-check-*")
	if err != nil {
		return err
	}
	path := file.Name()
	if err := file.Close(); err != nil {
		return err
	}
	return os.Remove(path)
}

func (h HTTP) ResetTask(ctx context.Context, task client.DownloadTask) error {
	if task.SourceType() != "http" {
		return nil
	}
	return os.RemoveAll(filepath.Join(h.Dir, task.ID))
}

func (h HTTP) InspectTask(ctx context.Context, task client.DownloadTask) (TaskSnapshot, bool, error) {
	if task.SourceType() != "http" {
		return TaskSnapshot{}, false, nil
	}
	size, ok := completedHTTPCheckpoint(task)
	if !ok {
		return TaskSnapshot{}, false, nil
	}
	path, name, err := h.outputPath(task)
	if err != nil {
		return TaskSnapshot{}, false, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return TaskSnapshot{}, false, fmt.Errorf("inspect http completed file: %w", err)
	}
	if info.IsDir() {
		return TaskSnapshot{}, false, fmt.Errorf("inspect http completed file: %s is a directory", path)
	}
	if info.Size() != size {
		return TaskSnapshot{}, false, fmt.Errorf("inspect http completed file: size mismatch path=%s expected=%d actual=%d", path, size, info.Size())
	}
	result := Result{Path: path, Name: name, Size: size}
	return TaskSnapshot{
		State:      TaskStateCompleted,
		Downloaded: size,
		Total:      &size,
		Runtime:    &client.DownloadTaskRuntime{Engine: "builtin", Phase: "completed"},
		Result:     &result,
	}, true, nil
}

func (h HTTP) Download(ctx context.Context, task client.DownloadTask, progress Progress) (Result, error) {
	if task.SourceType() != "http" {
		return Result{}, errors.New("http engine only supports http sources")
	}
	taskDir := filepath.Join(h.Dir, task.ID)
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return Result{}, err
	}

	path, name, err := h.outputPath(task)
	if err != nil {
		return Result{}, err
	}
	existingSize, err := existingFileSize(path)
	if err != nil {
		return Result{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, task.SourceURI(), nil)
	if err != nil {
		return Result{}, err
	}
	if existingSize > 0 {
		req.Header.Set("Range", "bytes="+strconv.FormatInt(existingSize, 10)+"-")
	}

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusRequestedRangeNotSatisfiable && existingSize > 0 {
		return resultFromFile(task, path)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return Result{}, errors.New(res.Status)
	}

	appendExisting := existingSize > 0 && res.StatusCode == http.StatusPartialContent
	if existingSize > 0 && !appendExisting {
		existingSize = 0
	}
	file, err := openOutputFile(path, appendExisting)
	if err != nil {
		return Result{}, err
	}
	defer file.Close()

	var total *int64
	if res.ContentLength > 0 {
		value := res.ContentLength + existingSize
		total = &value
	}
	counter := &progressWriter{progress: progress, total: total, downloaded: existingSize, lastBytes: existingSize, lastAt: time.Now()}
	if _, err := io.Copy(file, io.TeeReader(res.Body, counter)); err != nil {
		return Result{}, err
	}
	if err := progress(counter.downloaded, total, 0, &client.DownloadTaskRuntime{Engine: "builtin", Phase: "completed"}); err != nil {
		return Result{}, err
	}
	return Result{Path: path, Name: name, Size: counter.downloaded}, nil
}

func (h HTTP) outputPath(task client.DownloadTask) (string, string, error) {
	parsed, err := httpURL(task.SourceURI())
	if err != nil {
		return "", "", err
	}
	name := outputName(task, filenameFromURL(parsed))
	return filepath.Join(h.Dir, task.ID, name), name, nil
}

func completedHTTPCheckpoint(task client.DownloadTask) (int64, bool) {
	total := task.Status.Progress.Download.TotalBytes
	if total == nil || *total <= 0 {
		return 0, false
	}
	if task.Status.Progress.Download.Bytes != *total {
		return 0, false
	}
	return *total, true
}

func httpURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("unsupported http source url: %s", raw)
	}
	return parsed, nil
}

func existingFileSize(path string) (int64, error) {
	info, err := os.Stat(path)
	if err == nil {
		if info.IsDir() {
			return 0, nil
		}
		return info.Size(), nil
	}
	if os.IsNotExist(err) {
		return 0, nil
	}
	return 0, err
}

func openOutputFile(path string, appendExisting bool) (*os.File, error) {
	if appendExisting {
		return os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o644)
	}
	return os.Create(path)
}
