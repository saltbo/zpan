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

	"github.com/saltbo/zpan/downloader/internal/client"
	"github.com/saltbo/zpan/downloader/internal/engine"
)

const maxSingleUploadSize = 5 * 1024 * 1024 * 1024
const defaultMultipartPartSize = 64 * 1024 * 1024
const maxMultipartPartSize = 512 * 1024 * 1024
const maxMultipartParts = 10_000
const presignMultipartPartsBatchSize = 100

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
	log.Info("uploading file to object storage", "object_id", draft.ID, "path", path)
	if size > maxSingleUploadSize {
		if err := w.uploadMultipartFile(ctx, log, task, draft.ID, path, size, progress); err != nil {
			return "", fmt.Errorf("upload object %s: %w", draft.ID, err)
		}
	} else {
		if err := uploadFile(ctx, draft.UploadURL, path, draft.ContentDisposition, func(written int64) error {
			return w.reportUploadProgress(ctx, log, task, progress, written)
		}); err != nil {
			return "", fmt.Errorf("upload object %s: %w", draft.ID, err)
		}
	}
	log.Info("confirming uploaded object", "object_id", draft.ID)
	if err := w.confirmObject(ctx, task.UploadToken(), draft.ID); err != nil {
		return "", fmt.Errorf("confirm object %s: %w", draft.ID, err)
	}
	return draft.ID, nil
}

func (w *Worker) uploadMultipartFile(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	objectID string,
	filePath string,
	size int64,
	progress *uploadProgress,
) error {
	partSize := multipartPartSize(size)
	log.Info("creating multipart upload session", "object_id", objectID, "part_size", partSize)
	session, err := w.createObjectUploadSession(ctx, task.UploadToken(), objectID, partSize)
	if err != nil {
		return fmt.Errorf("create multipart upload session: %w", err)
	}
	if session.PartSize <= 0 {
		return fmt.Errorf("create multipart upload session: invalid part size %d", session.PartSize)
	}
	completed := false
	defer func() {
		if completed {
			return
		}
		abortCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		if abortErr := w.abortObjectUploadSession(abortCtx, task.UploadToken(), objectID, session.ID); abortErr != nil {
			log.Warn("failed to abort multipart upload session", "object_id", objectID, "upload_session_id", session.ID, "error", abortErr)
		}
	}()

	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	totalParts := int((size + session.PartSize - 1) / session.PartSize)
	parts := make([]client.CompletedObjectUploadPart, 0, totalParts)
	for firstPart := 1; firstPart <= totalParts; firstPart += presignMultipartPartsBatchSize {
		lastPart := firstPart + presignMultipartPartsBatchSize - 1
		if lastPart > totalParts {
			lastPart = totalParts
		}
		partNumbers := make([]int, 0, lastPart-firstPart+1)
		for partNumber := firstPart; partNumber <= lastPart; partNumber++ {
			partNumbers = append(partNumbers, partNumber)
		}
		presignedParts, err := w.presignObjectUploadParts(ctx, task.UploadToken(), objectID, session.ID, partNumbers)
		if err != nil {
			return fmt.Errorf("presign multipart upload parts: %w", err)
		}
		byNumber := make(map[int]string, len(presignedParts))
		for _, part := range presignedParts {
			byNumber[part.PartNumber] = part.URL
		}
		for _, partNumber := range partNumbers {
			url, ok := byNumber[partNumber]
			if !ok {
				return fmt.Errorf("presign multipart upload part %d: missing upload URL", partNumber)
			}
			offset := int64(partNumber-1) * session.PartSize
			length := session.PartSize
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
	}
	if err := w.completeObjectUploadSession(ctx, task.UploadToken(), objectID, session.ID, parts); err != nil {
		return fmt.Errorf("complete multipart upload session: %w", err)
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
	detail := task.Runtime()
	if detail == nil {
		detail = &client.DownloadTaskRuntime{}
	}
	detail.Phase = "uploading"
	detail.ETASeconds = uploadETA(progress, bps)
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

func uploadFile(ctx context.Context, url, path string, contentDisposition string, progress func(written int64) error) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return err
	}
	reader := io.Reader(file)
	if progress != nil {
		reader = &uploadProgressReader{reader: file, progress: progress}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	if contentDisposition != "" {
		req.Header.Set("Content-Disposition", contentDisposition)
	}
	req.ContentLength = stat.Size()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		if len(body) > 0 {
			return fmt.Errorf("upload failed: %s: %s", res.Status, strings.TrimSpace(string(body)))
		}
		return fmt.Errorf("upload failed: %s", res.Status)
	}
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
