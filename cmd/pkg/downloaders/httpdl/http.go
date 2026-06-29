package httpdl

import (
	"context"
	"errors"
	"fmt"
	"io"
	nethttp "net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/saltbo/zpan/internal/downloader"
	"github.com/saltbo/zpan/pkg/downloaders/core"
)

func init() {
	downloader.Register("http", true, nil, New)
}

func New(cfg downloader.Config) (downloader.Downloader, error) {
	return HTTP{Dir: cfg.DownloadDir}, nil
}

type HTTP struct {
	Dir string
}

type progressWriter struct {
	progress   downloader.ProgressReporter
	total      *int64
	downloaded int64
	lastBytes  int64
	lastAt     time.Time
}

func newDownloadProgressWriter(progress downloader.ProgressReporter, total *int64, downloaded int64) *progressWriter {
	return &progressWriter{progress: progress, total: total, downloaded: downloaded, lastBytes: downloaded, lastAt: time.Now()}
}

func (w *progressWriter) Write(data []byte) (int, error) {
	n := len(data)
	w.downloaded += int64(n)
	now := time.Now()
	if now.Sub(w.lastAt) >= time.Second {
		bps := int64(float64(w.downloaded-w.lastBytes) / now.Sub(w.lastAt).Seconds())
		if err := w.progress(downloader.ProgressUpdate{
			Downloaded: w.downloaded,
			Total:      w.total,
			Bps:        bps,
			Runtime:    &downloader.TaskRuntime{Engine: "http", Phase: "downloading"},
		}); err != nil {
			return n, err
		}
		w.lastBytes = w.downloaded
		w.lastAt = now
	}
	return n, nil
}

func (w *progressWriter) Downloaded() int64 {
	return w.downloaded
}

func (h HTTP) Name() string {
	return "http"
}

func (h HTTP) Capabilities() downloader.Capabilities {
	return downloader.Capabilities{SourceTypes: []string{"http"}}
}

func (h HTTP) Start(ctx context.Context) error {
	return nil
}

func (h HTTP) Stop(ctx context.Context) error {
	return nil
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

func (h HTTP) ResetTask(ctx context.Context, task downloader.DownloadTask) error {
	if task.SourceType() != "http" {
		return nil
	}
	return os.RemoveAll(filepath.Join(h.Dir, task.ID))
}

func (h HTTP) InspectTask(ctx context.Context, task downloader.DownloadTask) (downloader.TaskSnapshot, bool, error) {
	if task.SourceType() != "http" {
		return downloader.TaskSnapshot{}, false, nil
	}
	size, ok := completedHTTPCheckpoint(task)
	if !ok {
		return downloader.TaskSnapshot{}, false, nil
	}
	path, name, err := h.outputPath(task)
	if err != nil {
		return downloader.TaskSnapshot{}, false, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return downloader.TaskSnapshot{}, false, fmt.Errorf("inspect http completed file: %w", err)
	}
	if info.IsDir() {
		return downloader.TaskSnapshot{}, false, fmt.Errorf("inspect http completed file: %s is a directory", path)
	}
	if info.Size() != size {
		return downloader.TaskSnapshot{}, false, fmt.Errorf("inspect http completed file: size mismatch path=%s expected=%d actual=%d", path, size, info.Size())
	}
	result := downloader.Result{Path: path, Name: name, Size: size}
	return downloader.TaskSnapshot{
		State:      downloader.TaskStateCompleted,
		Downloaded: size,
		Total:      &size,
		Runtime:    &downloader.TaskRuntime{Engine: "http", Phase: "completed"},
		Result:     &result,
	}, true, nil
}

func (h HTTP) Download(ctx context.Context, task downloader.DownloadTask, progress downloader.ProgressReporter) (downloader.Result, error) {
	if task.SourceType() != "http" {
		return downloader.Result{}, errors.New("http engine only supports http sources")
	}
	taskDir := filepath.Join(h.Dir, task.ID)
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return downloader.Result{}, err
	}

	path, name, err := h.outputPath(task)
	if err != nil {
		return downloader.Result{}, err
	}
	existingSize, err := existingFileSize(path)
	if err != nil {
		return downloader.Result{}, err
	}
	req, err := nethttp.NewRequestWithContext(ctx, nethttp.MethodGet, task.SourceURI(), nil)
	if err != nil {
		return downloader.Result{}, err
	}
	if existingSize > 0 {
		req.Header.Set("Range", "bytes="+strconv.FormatInt(existingSize, 10)+"-")
	}

	res, err := nethttp.DefaultClient.Do(req)
	if err != nil {
		return downloader.Result{}, err
	}
	defer res.Body.Close()
	if res.StatusCode == nethttp.StatusRequestedRangeNotSatisfiable && existingSize > 0 {
		return core.ResultFromPath(task, path, name)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return downloader.Result{}, errors.New(res.Status)
	}

	appendExisting := existingSize > 0 && res.StatusCode == nethttp.StatusPartialContent
	if existingSize > 0 && !appendExisting {
		existingSize = 0
	}
	file, err := openOutputFile(path, appendExisting)
	if err != nil {
		return downloader.Result{}, err
	}
	defer file.Close()

	var total *int64
	if res.ContentLength > 0 {
		value := res.ContentLength + existingSize
		total = &value
	}
	counter := newDownloadProgressWriter(progress, total, existingSize)
	if _, err := io.Copy(file, io.TeeReader(res.Body, counter)); err != nil {
		return downloader.Result{}, err
	}
	if err := progress(downloader.ProgressUpdate{
		Downloaded: counter.Downloaded(),
		Total:      total,
		Runtime:    &downloader.TaskRuntime{Engine: "http", Phase: "completed"},
	}); err != nil {
		return downloader.Result{}, err
	}
	return downloader.Result{Path: path, Name: name, Size: counter.Downloaded()}, nil
}

func (h HTTP) outputPath(task downloader.DownloadTask) (string, string, error) {
	parsed, err := httpURL(task.SourceURI())
	if err != nil {
		return "", "", err
	}
	name := core.OutputName(task, core.FilenameFromURL(parsed))
	return filepath.Join(h.Dir, task.ID, name), name, nil
}

func completedHTTPCheckpoint(task downloader.DownloadTask) (int64, bool) {
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
