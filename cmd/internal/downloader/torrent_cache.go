package downloader

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/pkg/system"
	"github.com/saltbo/zpan/pkg/torrentmeta"
)

// A task assigned as a torrent's fill uploads the torrent once for the whole
// instance (docs/design/torrents.md §4). Once the engine has the torrent's
// metadata the downloader registers its info dictionary; the server answers
// whether to fill the torrent, drop the task because the torrent is on the
// instance or being downloaded elsewhere, or upload into the drive as before. A
// fill uploads each torrent file by its fileIdx, then completes the torrent, and
// the server finishes the task by instant transfer.

// torrentCacheAPI is the part of the API a downloader fills the cache through.
type torrentCacheAPI interface {
	RegisterTaskTorrent(ctx context.Context, token string, taskID string, info []byte) (client.TorrentRegistration, error)
	CreateTorrentFileUpload(ctx context.Context, token string, taskID string, fileIdx int) (client.TorrentUpload, error)
	AbortTorrentFileUpload(ctx context.Context, token string, taskID string, fileIdx int, uploadID string) error
	CompleteTorrentFileUpload(ctx context.Context, token string, taskID string, fileIdx int, uploadID *string, parts []client.CompletedObjectUploadPart) error
	CompleteTaskTorrent(ctx context.Context, token string, taskID string, files []client.TorrentFile) (client.DownloadTask, error)
}

// errTaskSettledByCache stops a download whose torrent the cache already holds
// or another download is filling: the server settled the task.
var errTaskSettledByCache = errors.New("task settled by the server's torrent")

const registerRetryInterval = 5 * time.Second

// After a download, metadata that is still pending or unreadable is retried
// this many times before the task gives up on the cache and uploads into the
// drive.
const metadataAttempts = 6

var metadataRetryDelay = time.Second

// Each presigned part PUT is tried this many times, waiting partRetryDelay,
// doubled each time, between attempts.
const partAttempts = 3

var partRetryDelay = time.Second

// outcomeReleased is the local outcome of a registration the server answered
// with 409: it no longer has this task filling the cache (it released, joined,
// or completed it), so the download stops and nothing is uploaded, since a
// drive upload could give the workspace a second copy.
const outcomeReleased = "released"

// metadataError is a failure to get a readable info dictionary from the
// engine, as opposed to a failure to reach the server.
type metadataError struct{ err error }

func (e *metadataError) Error() string { return e.err.Error() }
func (e *metadataError) Unwrap() error { return e.err }

// torrentCache is the fill state of one running task.
type torrentCache struct {
	registration *client.TorrentRegistration
	lastAttempt  time.Time
}

func (c *torrentCache) fills() bool {
	return c != nil && c.registration != nil && c.registration.Outcome == client.TorrentOutcomeFill
}

func (c *torrentCache) settled() bool {
	if c == nil || c.registration == nil {
		return false
	}
	switch c.registration.Outcome {
	case client.TorrentOutcomeJoined, client.TorrentOutcomeCompleted, outcomeReleased:
		return true
	}
	return false
}

func (c *torrentCache) useDrive() {
	c.registration = &client.TorrentRegistration{Outcome: client.TorrentOutcomeDrive}
}

func (w *TaskRunner) cacheAPI() (torrentCacheAPI, bool) {
	api, ok := w.api.(torrentCacheAPI)
	return api, ok
}

// supportsTorrentCache is whether this downloader reports the capability: its
// engine can hand over metadata and its API client speaks the cache API.
func (w *TaskRunner) supportsTorrentCache() bool {
	_, ok := w.cacheAPI()
	return ok && w.downloader != nil && w.downloader.SupportsTorrentCache()
}

// registerTorrent registers the task's info dictionary once the engine has it.
// Metadata that is pending, unreadable (a .torrent still being written), or
// that the engine cannot hand over is a *metadataError and leaves the state
// unregistered for a later attempt. A registration the server refuses (400),
// such as a v2-only torrent, sends the task to the drive; a 409 means the
// server no longer has this task filling the cache, which stops it.
func (w *TaskRunner) registerTorrent(ctx context.Context, log *slog.Logger, task client.DownloadTask, state *torrentCache) error {
	if state.registration != nil {
		return nil
	}
	api, ok := w.cacheAPI()
	if !ok {
		state.useDrive()
		return nil
	}
	state.lastAttempt = time.Now()
	metadata, err := w.downloader.TorrentMetadata(ctx, downloadTask(task))
	if err != nil {
		return &metadataError{err}
	}
	info, err := torrentmeta.InfoDict(metadata)
	if err != nil {
		return &metadataError{fmt.Errorf("%w: %v", ErrTorrentMetadataPending, err)}
	}
	var registration client.TorrentRegistration
	err = callAPI(ctx, log, "register task torrent", func(ctx context.Context) error {
		var err error
		registration, err = api.RegisterTaskTorrent(ctx, task.UploadToken(), task.ID, info)
		return err
	})
	if client.IsStatus(err, http.StatusBadRequest) {
		log.Warn("the server will not fill the torrent; uploading into the drive", "error", err)
		state.useDrive()
		return nil
	}
	if client.IsConflict(err) {
		log.Warn("the server no longer has this task filling the torrent; stopping it", "error", err)
		state.registration = &client.TorrentRegistration{Outcome: outcomeReleased}
		return nil
	}
	if err != nil {
		return err
	}
	log.Info("registered torrent with the cache", "info_hash", registration.InfoHash, "outcome", registration.Outcome)
	state.registration = &registration
	return nil
}

// registerDuringDownload tries to register while the engine downloads, at most
// every few seconds, and stops the download when the server settled the task.
func (w *TaskRunner) registerDuringDownload(ctx context.Context, log *slog.Logger, task client.DownloadTask, state *torrentCache, stop context.CancelCauseFunc) {
	if state.registration != nil || time.Since(state.lastAttempt) < registerRetryInterval {
		return
	}
	if err := w.registerTorrent(ctx, log, task, state); err != nil {
		if !errors.Is(err, ErrTorrentMetadataPending) {
			log.Warn("failed to register torrent with the cache", "error", err)
		}
		return
	}
	if state.settled() {
		stop(errTaskSettledByCache)
	}
}

// registerAfterDownload registers a finished download that is not registered
// yet, waiting for the engine's metadata where it is still being written. When
// the metadata never becomes readable, the task uploads into the drive rather
// than failing after the whole download; the server takes a drive upload from
// a task assigned in cache mode as from any other.
func (w *TaskRunner) registerAfterDownload(ctx context.Context, log *slog.Logger, task client.DownloadTask, state *torrentCache) error {
	for attempt := 1; ; attempt++ {
		err := w.registerTorrent(ctx, log, task, state)
		var metaErr *metadataError
		if err == nil || !errors.As(err, &metaErr) {
			return err
		}
		if attempt >= metadataAttempts {
			log.Warn("torrent metadata is not readable; uploading into the drive", "error", err)
			state.useDrive()
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(metadataRetryDelay):
		}
	}
}

// dropSettledTask removes the local download of a task the server settled from
// the cache.
func (w *TaskRunner) dropSettledTask(ctx context.Context, log *slog.Logger, task client.DownloadTask, state *torrentCache) {
	if err := w.cleanupTerminalTask(ctx, task); err != nil {
		log.Warn("failed to remove local download of a task settled by the server's torrent", "error", err)
	}
	log.Info("task settled by the server's torrent", "outcome", state.registration.Outcome)
}

// uploadToCache uploads a finished download as the torrent's fill and
// completes it. It returns notices for the task activity.
func (u *Uploader) uploadToCache(ctx context.Context, log *slog.Logger, task client.DownloadTask, result Result, registration client.TorrentRegistration) ([]string, error) {
	api, ok := u.api.(torrentCacheAPI)
	if !ok {
		return nil, errors.New("API client cannot fill torrents")
	}
	locals, err := torrentLocalFiles(result, registration)
	if err != nil {
		return nil, err
	}
	var notices []string
	if result.Plan != nil {
		// Until one upload path carries the scrape (docs/design/torrents.md §14),
		// a torrent keeps its own tree.
		notices = append(notices, "the scraped layout was not kept with the torrent")
	}
	progress := &uploadProgress{lastAt: time.Now()}
	for _, file := range registration.Files {
		progress.totalBytes += file.Size
	}
	token := task.UploadToken()
	for _, file := range registration.Files {
		if err := u.uploadTorrentFile(ctx, log, api, task, file, locals[file.FileIdx], progress); err != nil {
			return nil, err
		}
	}
	err = callAPI(ctx, log, "complete task torrent", func(ctx context.Context) error {
		_, err := api.CompleteTaskTorrent(ctx, token, task.ID, registration.Files)
		return err
	})
	if err != nil {
		return notices, fmt.Errorf("complete torrent: %w", err)
	}
	return notices, nil
}

func (u *Uploader) uploadTorrentFile(ctx context.Context, log *slog.Logger, api torrentCacheAPI, task client.DownloadTask, file client.TorrentFile, localPath string, progress *uploadProgress) error {
	var upload client.TorrentUpload
	err := callAPI(ctx, log, "create torrent file upload", func(ctx context.Context) error {
		var err error
		upload, err = api.CreateTorrentFileUpload(ctx, task.UploadToken(), task.ID, file.FileIdx)
		return err
	})
	if err != nil {
		return fmt.Errorf("upload %s: %w", file.Path, err)
	}
	parts, err := u.putParts(ctx, log, task, localPath, upload, progress)
	if err != nil {
		if upload.UploadID != nil {
			abortErr := callAPI(context.WithoutCancel(ctx), log, "abort torrent file upload", func(ctx context.Context) error {
				return api.AbortTorrentFileUpload(ctx, task.UploadToken(), task.ID, file.FileIdx, *upload.UploadID)
			})
			if abortErr != nil {
				log.Warn("failed to abort torrent file upload", "path", file.Path, "error", abortErr)
			}
		}
		return fmt.Errorf("upload %s: %w", file.Path, err)
	}
	err = callAPI(ctx, log, "complete torrent file upload", func(ctx context.Context) error {
		return api.CompleteTorrentFileUpload(ctx, task.UploadToken(), task.ID, file.FileIdx, upload.UploadID, parts)
	})
	if err != nil {
		return fmt.Errorf("upload %s: %w", file.Path, err)
	}
	return nil
}

func (u *Uploader) putParts(ctx context.Context, log *slog.Logger, task client.DownloadTask, localPath string, upload client.TorrentUpload, progress *uploadProgress) ([]client.CompletedObjectUploadPart, error) {
	file, err := os.Open(localPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	parts := make([]client.CompletedObjectUploadPart, 0, len(upload.Parts))
	for _, part := range upload.Parts {
		etag, err := u.putPart(ctx, log, task, file, part, progress)
		if err != nil {
			return nil, fmt.Errorf("part %d: %w", part.PartNumber, err)
		}
		if upload.UploadID != nil && etag == "" {
			return nil, fmt.Errorf("part %d: missing ETag", part.PartNumber)
		}
		parts = append(parts, client.CompletedObjectUploadPart{PartNumber: part.PartNumber, ETag: etag})
	}
	return parts, nil
}

// putPart PUTs one part, retrying a failed attempt with backoff. The bytes of a
// failed attempt are taken back out of the upload progress.
func (u *Uploader) putPart(ctx context.Context, log *slog.Logger, task client.DownloadTask, file *os.File, part client.TorrentUploadPart, progress *uploadProgress) (string, error) {
	delay := partRetryDelay
	for attempt := 1; ; attempt++ {
		var written int64
		etag, err := uploadFilePart(ctx, part.URL, nil, file, part.Offset, part.Length, func(n int64) error {
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
		log.Warn("retrying torrent part upload", "part", part.PartNumber, "attempt", attempt, "error", err)
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(delay):
		}
		delay *= 2
	}
}

// torrentLocalFiles finds each torrent file in the finished download by its
// exact path inside the torrent. The download is either the torrent's tree
// itself or a folder holding the torrent's root folder, under the torrent's
// name or whatever name the engine gave it; exactly one such root is stripped,
// and only a root under which every file is found at its size is taken. A
// file is never skipped for its name, so a torrent may carry .torrent files.
func torrentLocalFiles(result Result, registration client.TorrentRegistration) (map[int]string, error) {
	for _, file := range registration.Files {
		if !filepath.IsLocal(filepath.FromSlash(file.Path)) {
			return nil, fmt.Errorf("torrent file path %q is not local", file.Path)
		}
	}
	single := len(registration.Files) == 1 && registration.Files[0].Path == registration.Name
	if !result.IsDir {
		if !single {
			return nil, fmt.Errorf("download %s is a file, not the torrent's folder", result.Path)
		}
		file := registration.Files[0]
		if !isFileOfSize(result.Path, file.Size) {
			return nil, fmt.Errorf("downloaded file %s is missing", file.Path)
		}
		return map[int]string{file.FileIdx: result.Path}, nil
	}

	roots := []string{registration.Name, ""}
	if entries, err := os.ReadDir(result.Path); err == nil {
		for _, entry := range entries {
			if entry.IsDir() && entry.Name() != registration.Name {
				roots = append(roots, entry.Name())
			}
		}
	}
	var missing string
	for _, root := range roots {
		if root != "" && !filepath.IsLocal(root) {
			continue
		}
		out, absent := filesUnder(filepath.Join(result.Path, root), registration.Files)
		if absent == "" {
			return out, nil
		}
		if missing == "" {
			missing = absent
		}
	}
	if single {
		// An engine may name a lone file after the requested name: take the
		// only file of its size that is not the engine's own metadata.
		if local, ok := onlyFileOfSize(result.Path, registration.Files[0].Size); ok {
			return map[int]string{registration.Files[0].FileIdx: local}, nil
		}
	}
	return nil, fmt.Errorf("downloaded file %s is missing", missing)
}

func onlyFileOfSize(dir string, size int64) (string, bool) {
	var match []string
	_ = filepath.WalkDir(dir, func(p string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil || system.IsDownloadSidecarPath(filepath.ToSlash(rel)) {
			return err
		}
		if info, err := entry.Info(); err == nil && info.Mode().IsRegular() && info.Size() == size {
			match = append(match, p)
		}
		return nil
	})
	if len(match) != 1 {
		return "", false
	}
	return match[0], true
}

// filesUnder maps every torrent file to its path under root, or names the
// first one that is not there at its size.
func filesUnder(root string, files []client.TorrentFile) (map[int]string, string) {
	out := make(map[int]string, len(files))
	for _, file := range files {
		local := filepath.Join(root, filepath.FromSlash(file.Path))
		if !isFileOfSize(local, file.Size) {
			return nil, file.Path
		}
		out[file.FileIdx] = local
	}
	return out, ""
}

func isFileOfSize(path string, size int64) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Size() == size
}
