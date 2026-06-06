package engine

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/saltbo/zpan/downloader/internal/client"
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

func (h HTTP) Recover(ctx context.Context, task client.DownloadTask) (Result, bool, error) {
	return Result{}, false, nil
}

func (h HTTP) Download(ctx context.Context, task client.DownloadTask, progress Progress) (Result, error) {
	if task.SourceType != "http" {
		return Result{}, errors.New("http engine only supports http sources")
	}
	taskDir := filepath.Join(h.Dir, task.ID)
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		return Result{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, task.SourceURI, nil)
	if err != nil {
		return Result{}, err
	}
	name := outputName(task, filenameFromURL(req.URL))
	path := filepath.Join(taskDir, name)
	existingSize, err := existingFileSize(path)
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
	if err := progress(counter.downloaded, total, 0, &client.DownloadTaskDetail{Engine: "builtin", Phase: "completed"}); err != nil {
		return Result{}, err
	}
	return Result{Path: path, Name: name, Size: counter.downloaded}, nil
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
