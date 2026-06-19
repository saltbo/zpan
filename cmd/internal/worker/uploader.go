package worker

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/engine"
)

type uploadProgress struct {
	totalBytes int64
	uploaded   int64
	lastAt     time.Time
	lastBytes  int64
}

func (w *Worker) uploadResult(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	result engine.Result,
) (string, error) {
	if !result.IsDir {
		progress := &uploadProgress{totalBytes: result.Size, lastAt: time.Now()}
		return w.uploadSingleFile(ctx, log, task, result.Path, result.Name, result.Size, task.TargetFolder(), progress)
	}

	progress := &uploadProgress{totalBytes: result.Size, lastAt: time.Now()}
	log.Info("creating remote folder", "name", result.Name, "size", result.Size, "target_folder", task.TargetFolder())
	root, err := w.createFolder(ctx, task.UploadToken(), result.Name, task.TargetFolder())
	if err != nil {
		return "", fmt.Errorf("create remote folder: %w", err)
	}
	rootPath := joinObjectPath(task.TargetFolder(), root.Name)
	entries, err := collectDirectoryEntries(result.Path)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		parent := joinObjectPath(rootPath, path.Dir(entry.relativePath))
		if entry.isDir {
			log.Debug("creating remote subfolder", "name", entry.name, "parent", parent)
			if _, err := w.createFolder(ctx, task.UploadToken(), entry.name, parent); err != nil {
				return "", fmt.Errorf("create remote subfolder %s: %w", entry.relativePath, err)
			}
			continue
		}
		if _, err := w.uploadSingleFile(ctx, log, task, entry.path, entry.name, entry.size, parent, progress); err != nil {
			return "", err
		}
	}
	return root.ID, nil
}

func (w *Worker) uploadSingleFile(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	path string,
	name string,
	size int64,
	parent string,
	progress *uploadProgress,
) (string, error) {
	log.Info("creating remote object", "name", name, "size", size, "target_folder", parent)
	draft, err := w.createObject(ctx, task.UploadToken(), name, size, parent)
	if err != nil {
		return "", fmt.Errorf("create remote object: %w", err)
	}
	if draft.Upload == nil {
		return "", fmt.Errorf("create remote object %s: missing upload instructions", draft.ID)
	}
	log.Info("uploading file to object storage", "object_id", draft.ID, "path", path, "parts", len(draft.Upload.URLs))
	if err := w.uploadObjectSlices(ctx, log, task, draft, path, size, progress); err != nil {
		return "", fmt.Errorf("upload object %s: %w", draft.ID, err)
	}
	return draft.ID, nil
}

// uploadObjectSlices runs the uniform upload: PUT each presigned slice (1 URL =
// single PutObject, N URLs = multipart), read each ETag, then finalize. On any
// failure it aborts the session, which also discards the draft.
func (w *Worker) uploadObjectSlices(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	draft client.ObjectDraft,
	filePath string,
	size int64,
	progress *uploadProgress,
) error {
	upload := draft.Upload
	completed := false
	defer func() {
		if completed {
			return
		}
		abortCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		if abortErr := w.abortObjectUploadSession(abortCtx, task.UploadToken(), draft.ID, upload.SessionID); abortErr != nil {
			log.Warn("failed to abort upload session", "object_id", draft.ID, "upload_session_id", upload.SessionID, "error", abortErr)
		}
	}()

	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	parts := make([]client.CompletedObjectUploadPart, 0, len(upload.URLs))
	for i, url := range upload.URLs {
		partNumber := i + 1
		offset := int64(i) * upload.PartSize
		length := upload.PartSize
		if remaining := size - offset; remaining < length {
			length = remaining
		}
		etag, err := uploadFilePart(ctx, url, file, offset, length, func(written int64) error {
			return w.reportUploadProgress(ctx, log, task, progress, written)
		})
		if err != nil {
			return fmt.Errorf("upload part %d: %w", partNumber, err)
		}
		if etag == "" {
			return fmt.Errorf("upload part %d: missing ETag", partNumber)
		}
		parts = append(parts, client.CompletedObjectUploadPart{PartNumber: partNumber, ETag: etag})
	}
	if err := w.completeObjectUpload(ctx, task.UploadToken(), draft.ID, upload.SessionID, parts); err != nil {
		return fmt.Errorf("complete upload: %w", err)
	}
	completed = true
	return nil
}

func (w *Worker) reportUploadProgress(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	progress *uploadProgress,
	written int64,
) error {
	progress.uploaded += written
	now := time.Now()
	if progress.uploaded < progress.totalBytes && now.Sub(progress.lastAt) < time.Second {
		return nil
	}
	elapsed := now.Sub(progress.lastAt).Seconds()
	var bps int64
	if elapsed > 0 {
		bps = int64(float64(progress.uploaded-progress.lastBytes) / elapsed)
	}
	w.setTaskTransferSpeed(task.ID, transferSpeeds{uploadBps: bps})
	detail := task.Runtime()
	if detail == nil {
		detail = &client.DownloadTaskRuntime{}
	}
	detail.Phase = "uploading"
	detail.ETASeconds = uploadETA(progress, bps)
	detail.Progress = &client.DownloadTaskProgress{
		Download: task.Status.Progress.Download,
		Upload:   *transferProgress(progress.uploaded, &progress.totalBytes, bps),
	}
	detail.Seeding = nil
	_, err := w.updateTask(ctx, task.ID, client.TaskPatch{
		Status:   "uploading",
		Progress: uploadProgressPatch(progress.uploaded, progress.totalBytes, bps),
		Runtime:  detail,
	})
	if err != nil {
		log.Error("failed to report upload progress", "uploaded_bytes", progress.uploaded, "total_bytes", progress.totalBytes, "bps", bps, "error", err)
		return err
	}
	log.Debug("task upload progress", "uploaded_bytes", progress.uploaded, "total_bytes", progress.totalBytes, "bps", bps)
	progress.lastAt = now
	progress.lastBytes = progress.uploaded
	return nil
}

func uploadFilePart(ctx context.Context, url string, file *os.File, offset int64, length int64, progress func(written int64) error) (string, error) {
	reader := io.NewSectionReader(file, offset, length)
	var body io.Reader = reader
	if progress != nil {
		body = &uploadProgressReader{reader: reader, progress: progress}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, body)
	if err != nil {
		return "", err
	}
	req.ContentLength = length
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		if len(body) > 0 {
			return "", fmt.Errorf("upload failed: %s: %s", res.Status, strings.TrimSpace(string(body)))
		}
		return "", fmt.Errorf("upload failed: %s", res.Status)
	}
	return res.Header.Get("ETag"), nil
}

type uploadProgressReader struct {
	reader   io.Reader
	progress func(written int64) error
}

func (r *uploadProgressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 {
		if progressErr := r.progress(int64(n)); progressErr != nil {
			return n, progressErr
		}
	}
	return n, err
}
