package downloader

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/pkg/system"
)

type uploadProgress struct {
	totalBytes int64
	uploaded   int64
	lastAt     time.Time
	lastBytes  int64
}

type Uploader struct {
	api         apiClient
	reportSpeed func(taskID string, speeds transferSpeeds)
}

func NewUploader(api apiClient, reportSpeed func(taskID string, speeds transferSpeeds)) *Uploader {
	return &Uploader{api: api, reportSpeed: reportSpeed}
}

func (u *Uploader) Upload(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	result Result,
) (string, error) {
	if result.Plan != nil {
		id, notices, err := u.uploadPlan(ctx, log, task, *result.Plan, result.TorrentPaths)
		var unusable *planUnusableError
		if !errors.As(err, &unusable) {
			for _, notice := range notices {
				u.reportScrapeSkipped(ctx, log, task.ID, notice)
			}
			return id, err
		}
		log.Warn("upload plan unusable; uploading unprocessed", "reason", unusable.reason)
		u.reportScrapeSkipped(ctx, log, task.ID, unusable.reason)
	}
	if !result.IsDir {
		progress := &uploadProgress{totalBytes: result.Size, lastAt: time.Now()}
		draft, err := u.uploadSingleFile(ctx, log, task, result.Path, result.Name, result.Size, task.TargetFolder(), client.OnConflictRename, torrentPathOf(result.TorrentPaths, result.Path), progress)
		return draft.ID, err
	}

	progress := &uploadProgress{totalBytes: result.Size, lastAt: time.Now()}
	log.Info("creating remote folder", "name", result.Name, "size", result.Size, "target_folder", task.TargetFolder())
	root, err := u.createFolder(ctx, task.UploadToken(), result.Name, task.TargetFolder(), client.OnConflictRename)
	if err != nil {
		return "", fmt.Errorf("create remote folder: %w", err)
	}
	// The files this upload created. A failed upload deletes them and leaves
	// the folders, which a task's upload token may not delete.
	var made []string
	completed := false
	defer func() {
		if completed {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		for _, id := range made {
			if deleteErr := u.deleteObject(cleanupCtx, task.UploadToken(), id); deleteErr != nil {
				log.Warn("failed to delete remote object after directory upload failure", "object_id", id, "error", deleteErr)
			}
		}
	}()
	rootPath := joinObjectPath(task.TargetFolder(), root.Name)
	entries, err := collectDirectoryEntries(result.Path)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		parent := joinObjectPath(rootPath, path.Dir(entry.relativePath))
		if entry.isDir {
			log.Debug("creating remote subfolder", "name", entry.name, "parent", parent)
			if _, err := u.createFolder(ctx, task.UploadToken(), entry.name, parent, client.OnConflictRename); err != nil {
				return "", fmt.Errorf("create remote subfolder %s: %w", entry.relativePath, err)
			}
			continue
		}
		live, err := u.uploadSingleFile(ctx, log, task, entry.path, entry.name, entry.size, parent, client.OnConflictRename, torrentPathOf(result.TorrentPaths, entry.path), progress)
		if err != nil {
			return "", err
		}
		made = append(made, live.ID)
	}
	completed = true
	return root.ID, nil
}

func (u *Uploader) uploadSingleFile(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	path string,
	name string,
	size int64,
	parent string,
	onConflict client.OnConflict,
	torrentPath string,
	progress *uploadProgress,
) (client.ObjectDraft, error) {
	log.Info("creating remote object", "name", name, "size", size, "target_folder", parent, "torrent_path", torrentPath)
	draft, err := u.createObject(ctx, task.UploadToken(), name, size, parent, onConflict, torrentPath)
	if err != nil {
		return client.ObjectDraft{}, fmt.Errorf("create remote object: %w", err)
	}
	if draft.Upload == nil {
		return client.ObjectDraft{}, fmt.Errorf("create remote object %s: missing upload instructions", draft.ID)
	}
	log.Info("uploading file to object storage", "object_id", draft.ID, "path", path, "parts", len(draft.Upload.Parts))
	live, err := u.uploadObjectSlices(ctx, log, task, draft, path, size, progress)
	if err != nil {
		return client.ObjectDraft{}, fmt.Errorf("upload object %s: %w", draft.ID, err)
	}
	return live, nil
}

// uploadObjectSlices runs the uniform upload: PUT each explicit presigned part,
// read each ETag, then finalize. On any failure it aborts the session, which also
// discards the draft.
func (u *Uploader) uploadObjectSlices(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	draft client.ObjectDraft,
	filePath string,
	size int64,
	progress *uploadProgress,
) (client.ObjectDraft, error) {
	upload := draft.Upload
	completed := false
	defer func() {
		if completed {
			return
		}
		abortCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		if abortErr := u.abortObjectUploadSession(abortCtx, task.UploadToken(), draft.ID, upload.SessionID); abortErr != nil {
			log.Warn("failed to abort upload session", "object_id", draft.ID, "upload_session_id", upload.SessionID, "error", abortErr)
		}
	}()

	file, err := os.Open(filePath)
	if err != nil {
		return client.ObjectDraft{}, err
	}
	defer file.Close()

	parts := make([]client.CompletedObjectUploadPart, 0, len(upload.Parts))
	for _, part := range upload.Parts {
		partNumber := part.PartNumber
		offset := int64(partNumber-1) * upload.PartSize
		length := upload.PartSize
		if remaining := size - offset; remaining < length {
			length = remaining
		}
		etag, err := u.putPart(ctx, log, task, file, part, offset, length, progress)
		if err != nil {
			return client.ObjectDraft{}, fmt.Errorf("upload part %d: %w", partNumber, err)
		}
		if etag == "" {
			return client.ObjectDraft{}, fmt.Errorf("upload part %d: missing ETag", partNumber)
		}
		parts = append(parts, client.CompletedObjectUploadPart{PartNumber: partNumber, ETag: etag})
	}
	live, err := u.completeObjectUpload(ctx, task.UploadToken(), draft.ID, upload.SessionID, parts)
	if err != nil {
		return client.ObjectDraft{}, fmt.Errorf("complete upload: %w", err)
	}
	completed = true
	return live, nil
}

// Each presigned part PUT is tried this many times, waiting partRetryDelay,
// doubled each time, between attempts.
const partAttempts = 3

var partRetryDelay = time.Second

// putPart PUTs one part, retrying a failed attempt with backoff. The bytes of a
// failed attempt are taken back out of the upload progress.
func (u *Uploader) putPart(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	file *os.File,
	part client.PresignedObjectUploadPart,
	offset int64,
	length int64,
	progress *uploadProgress,
) (string, error) {
	delay := partRetryDelay
	for attempt := 1; ; attempt++ {
		var written int64
		etag, err := uploadFilePart(ctx, part.URL, part.Headers, file, offset, length, func(n int64) error {
			written += n
			return u.reportUploadProgress(ctx, log, task, progress, n)
		})
		if err == nil {
			return etag, nil
		}
		progress.uploaded -= written
		if attempt >= partAttempts || ctx.Err() != nil {
			return "", err
		}
		log.Warn("retrying part upload", "part", part.PartNumber, "attempt", attempt, "error", err)
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(delay):
		}
		delay *= 2
	}
}

func (u *Uploader) reportUploadProgress(
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
	if u.reportSpeed != nil {
		u.reportSpeed(task.ID, transferSpeeds{uploadBps: bps})
	}
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
	_, err := u.updateTask(ctx, task.ID, client.TaskPatch{
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

func (u *Uploader) reportScrapeSkipped(ctx context.Context, log *slog.Logger, taskID string, reason string) {
	if _, err := u.updateTask(ctx, taskID, client.TaskPatch{ScrapeSkippedReason: scrapeReason(reason)}); err != nil {
		log.Warn("failed to record skipped media scraping", "error", err)
	}
}

func (u *Uploader) updateTask(ctx context.Context, id string, patch client.TaskPatch) (client.DownloadTask, error) {
	var task client.DownloadTask
	err := callAPI(ctx, nil, "update task", func(ctx context.Context) error {
		var err error
		task, err = u.api.UpdateTask(ctx, id, patch)
		return err
	})
	return task, err
}

func (u *Uploader) createFolder(ctx context.Context, token string, name string, parent string, onConflict client.OnConflict) (client.ObjectDraft, error) {
	var draft client.ObjectDraft
	err := callAPI(ctx, nil, "create folder", func(ctx context.Context) error {
		var err error
		draft, err = u.api.CreateFolder(ctx, token, name, parent, onConflict)
		return err
	})
	return draft, err
}

func (u *Uploader) createObject(ctx context.Context, token string, name string, size int64, parent string, onConflict client.OnConflict, torrentPath string) (client.ObjectDraft, error) {
	var draft client.ObjectDraft
	err := callAPI(ctx, nil, "create object", func(ctx context.Context) error {
		var err error
		draft, err = u.api.CreateObject(ctx, token, name, size, parent, onConflict, torrentPath)
		return err
	})
	return draft, err
}

func (u *Uploader) completeObjectUpload(ctx context.Context, token string, id string, sessionID string, parts []client.CompletedObjectUploadPart) (client.ObjectDraft, error) {
	var live client.ObjectDraft
	err := callAPI(ctx, nil, "complete object upload", func(ctx context.Context) error {
		var err error
		live, err = u.api.CompleteObjectUpload(ctx, token, id, sessionID, parts)
		return err
	})
	return live, err
}

func (u *Uploader) findObject(ctx context.Context, token string, parent string, name string) (client.ObjectEntry, bool, error) {
	var entry client.ObjectEntry
	var found bool
	err := callAPI(ctx, nil, "find object", func(ctx context.Context) error {
		var err error
		entry, found, err = u.api.FindObject(ctx, token, parent, name)
		return err
	})
	return entry, found, err
}

func (u *Uploader) putMediaMetadata(ctx context.Context, token string, id string, media any) error {
	return callAPI(ctx, nil, "put media metadata", func(ctx context.Context) error {
		return u.api.PutMediaMetadata(ctx, token, id, media)
	})
}

func (u *Uploader) abortObjectUploadSession(ctx context.Context, token string, id string, sessionID string) error {
	return callAPI(ctx, nil, "abort object upload", func(ctx context.Context) error {
		return u.api.AbortObjectUploadSession(ctx, token, id, sessionID)
	})
}

func (u *Uploader) deleteObject(ctx context.Context, token string, id string) error {
	return callAPI(ctx, nil, "delete object", func(ctx context.Context) error {
		return u.api.DeleteObject(ctx, token, id)
	})
}

type directoryEntry struct {
	path         string
	relativePath string
	name         string
	size         int64
	isDir        bool
}

func collectDirectoryEntries(root string) ([]directoryEntry, error) {
	var entries []directoryEntry
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		if strings.HasPrefix(entry.Name(), ".") {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		relativePath, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if !entry.IsDir() && system.IsDownloadSidecarPath(relativePath) {
			return nil
		}
		item := directoryEntry{
			path:         path,
			relativePath: filepath.ToSlash(relativePath),
			name:         entry.Name(),
			isDir:        entry.IsDir(),
		}
		if !entry.IsDir() {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			item.size = info.Size()
		}
		entries = append(entries, item)
		return nil
	})
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].isDir != entries[j].isDir {
			return entries[i].isDir
		}
		return entries[i].relativePath < entries[j].relativePath
	})
	return entries, err
}

// torrentPathOf is the path inside the reported torrent of a local file, or
// empty for a file that is not one of the torrent's.
func torrentPathOf(paths map[string]string, localPath string) string {
	if len(paths) == 0 {
		return ""
	}
	return paths[filepath.Clean(localPath)]
}

func joinObjectPath(parent string, name string) string {
	name = strings.Trim(filepath.ToSlash(name), "/")
	if name == "" || name == "." {
		return strings.Trim(parent, "/")
	}
	parent = strings.Trim(parent, "/")
	if parent == "" {
		return name
	}
	return parent + "/" + name
}

func uploadFilePart(
	ctx context.Context,
	url string,
	headers map[string]string,
	file *os.File,
	offset int64,
	length int64,
	progress func(written int64) error,
) (string, error) {
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
	for key, value := range headers {
		req.Header.Set(key, value)
	}
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
