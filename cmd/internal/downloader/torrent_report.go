package downloader

import (
	"context"
	"encoding/base64"
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

// A torrent task uploads exactly as any task does, through the object API
// (docs/design/torrents.md §4). Two additions tell the server what it is
// uploading: once the engine has the torrent's metadata the downloader reports
// the bencoded info dictionary on the task, and each file of the torrent is
// created with its torrentPath, its path inside the torrent, because scraping
// may give it another name. The server decides from that where each upload is
// stored. A torrent already on the instance, or downloading for another task,
// settles the task on the server; the downloader then drops its download.

// errTaskSettledByServer stops a download the server settled from a torrent on
// the instance: it completed the task, or queued it to wait for another
// download of the same torrent.
var errTaskSettledByServer = errors.New("task settled by a torrent on the server")

const reportRetryInterval = 5 * time.Second

// After a download, metadata that is still pending or unreadable is retried
// this many times before the task proceeds without reporting it, uploading
// ordinary drive files.
const metadataAttempts = 6

var metadataRetryDelay = time.Second

// metadataError is a failure to get a readable info dictionary from the
// engine, as opposed to a failure to reach the server.
type metadataError struct{ err error }

func (e *metadataError) Error() string { return e.err.Error() }
func (e *metadataError) Unwrap() error { return e.err }

// torrentReport is the state of reporting one running task's info dictionary.
type torrentReport struct {
	// info is the torrent the server accepted the report of.
	info        *torrentmeta.Info
	done        bool
	settled     bool
	lastAttempt time.Time
}

func (r *torrentReport) pending() bool {
	return r != nil && !r.done
}

// giveUp ends reporting: the task uploads ordinary drive files.
func (r *torrentReport) giveUp() {
	r.done = true
}

// taskWorkStates are the states in which the task is still this downloader's
// to run; any other state after a report means the server settled it.
func taskStillRunning(task client.DownloadTask) bool {
	switch task.State() {
	case "assigned", "downloading", "uploading":
		return true
	}
	return false
}

// canReportTorrent is whether the task's engine can hand over its torrent's
// metadata.
func (w *TaskRunner) canReportTorrent(task client.DownloadTask) bool {
	return w.downloader != nil && w.downloader.CanReportTorrent(downloadTask(task))
}

// reportTorrent reports the task's info dictionary once the engine has it.
// Metadata that is pending, unreadable (a .torrent still being written), or
// that the engine cannot hand over is a *metadataError and leaves the report
// pending for a later attempt. A report the server refuses (400), such as a
// v2-only torrent, ends reporting so the task uploads into the drive; a 403 or
// 409 means the task is no longer this downloader's, which settles it.
func (w *TaskRunner) reportTorrent(ctx context.Context, log *slog.Logger, task client.DownloadTask, state *torrentReport) error {
	if !state.pending() {
		return nil
	}
	state.lastAttempt = time.Now()
	metadata, err := w.downloader.TorrentMetadata(ctx, downloadTask(task))
	if err != nil {
		return &metadataError{err}
	}
	infoDict, err := torrentmeta.InfoDict(metadata)
	if err != nil {
		return &metadataError{fmt.Errorf("%w: %v", ErrTorrentMetadataPending, err)}
	}
	info, err := torrentmeta.Parse(infoDict)
	if err != nil {
		return &metadataError{fmt.Errorf("%w: %v", ErrTorrentMetadataPending, err)}
	}
	updated, err := w.updateTask(ctx, task.ID, client.TaskPatch{TorrentInfo: base64.StdEncoding.EncodeToString(infoDict)})
	switch {
	case client.IsStatus(err, http.StatusBadRequest):
		log.Warn("the server refused the torrent's metadata; uploading into the drive", "error", err)
		state.giveUp()
		return nil
	case client.IsStatus(err, http.StatusForbidden) || client.IsConflict(err):
		log.Warn("the task is no longer this downloader's; stopping it", "error", err)
		state.done, state.settled = true, true
		return nil
	case err != nil:
		return err
	}
	state.done = true
	if !taskStillRunning(updated) {
		log.Info("task settled by a torrent on the server", "info_hash", torrentmeta.InfoHash(infoDict), "state", updated.State())
		state.settled = true
		return nil
	}
	log.Info("reported torrent metadata", "info_hash", torrentmeta.InfoHash(infoDict))
	state.info = &info
	return nil
}

// reportDuringDownload tries to report while the engine downloads, at most
// every few seconds, and stops the download when the server settled the task.
func (w *TaskRunner) reportDuringDownload(ctx context.Context, log *slog.Logger, task client.DownloadTask, state *torrentReport, stop context.CancelCauseFunc) {
	if !state.pending() || time.Since(state.lastAttempt) < reportRetryInterval {
		return
	}
	if err := w.reportTorrent(ctx, log, task, state); err != nil {
		if !errors.Is(err, ErrTorrentMetadataPending) {
			log.Warn("failed to report torrent metadata", "error", err)
		}
		return
	}
	if state.settled {
		stop(errTaskSettledByServer)
	}
}

// reportAfterDownload reports a finished download that is not reported yet,
// waiting for the engine's metadata where it is still being written. When the
// metadata never becomes readable, or the server cannot be reached, the task
// proceeds without reporting rather than failing after the whole download.
func (w *TaskRunner) reportAfterDownload(ctx context.Context, log *slog.Logger, task client.DownloadTask, state *torrentReport) error {
	for attempt := 1; state.pending(); attempt++ {
		err := w.reportTorrent(ctx, log, task, state)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var metaErr *metadataError
		if !errors.As(err, &metaErr) {
			log.Warn("failed to report torrent metadata; uploading into the drive", "error", err)
			state.giveUp()
			return nil
		}
		if attempt >= metadataAttempts {
			log.Warn("torrent metadata is not readable; uploading into the drive", "error", err)
			state.giveUp()
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(metadataRetryDelay):
		}
	}
	return nil
}

// dropSettledTask removes the local download of a task the server settled.
func (w *TaskRunner) dropSettledTask(ctx context.Context, log *slog.Logger, task client.DownloadTask) {
	if err := w.cleanupTerminalTask(ctx, task); err != nil {
		log.Warn("failed to remove local download of a task settled by the server", "error", err)
	}
	log.Info("task settled by a torrent on the server")
}

// torrentPaths maps each local file of a finished download to its path inside
// the reported torrent, so its upload carries torrentPath. A download whose
// files cannot all be found uploads without them, and the server leaves the
// torrent off the instance.
func torrentPaths(log *slog.Logger, result Result, state *torrentReport) map[string]string {
	if state == nil || state.info == nil {
		return nil
	}
	locals, err := torrentLocalFiles(result, *state.info)
	if err != nil {
		log.Warn("the download does not hold the torrent's files; uploading them as ordinary files", "error", err)
		return nil
	}
	paths := make(map[string]string, len(locals))
	for _, file := range state.info.Files {
		if local, ok := locals[file.Index]; ok {
			paths[filepath.Clean(local)] = file.Path
		}
	}
	return paths
}

// torrentLocalFiles finds each torrent file in the finished download by its
// exact path inside the torrent. The download is either the torrent's tree
// itself or a folder holding the torrent's root folder, under the torrent's
// name or whatever name the engine gave it; exactly one such root is stripped,
// and only a root under which every file is found at its size is taken. A
// file is never skipped for its name, so a torrent may carry .torrent files.
func torrentLocalFiles(result Result, torrent torrentmeta.Info) (map[int]string, error) {
	files := torrentFiles(torrent)
	for _, file := range files {
		if !filepath.IsLocal(filepath.FromSlash(file.Path)) {
			return nil, fmt.Errorf("torrent file path %q is not local", file.Path)
		}
	}
	single := len(files) == 1 && files[0].Path == torrent.Name
	if !result.IsDir {
		if !single {
			return nil, fmt.Errorf("download %s is a file, not the torrent's folder", result.Path)
		}
		file := files[0]
		if !isFileOfSize(result.Path, file.Size) {
			return nil, fmt.Errorf("downloaded file %s is missing", file.Path)
		}
		return map[int]string{file.Index: result.Path}, nil
	}

	roots := []string{torrent.Name, ""}
	if entries, err := os.ReadDir(result.Path); err == nil {
		for _, entry := range entries {
			if entry.IsDir() && entry.Name() != torrent.Name {
				roots = append(roots, entry.Name())
			}
		}
	}
	var missing string
	for _, root := range roots {
		if root != "" && !filepath.IsLocal(root) {
			continue
		}
		out, absent := filesUnder(filepath.Join(result.Path, root), files)
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
		if local, ok := onlyFileOfSize(result.Path, files[0].Size); ok {
			return map[int]string{files[0].Index: local}, nil
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
func filesUnder(root string, files []torrentmeta.File) (map[int]string, string) {
	out := make(map[int]string, len(files))
	for _, file := range files {
		local := filepath.Join(root, filepath.FromSlash(file.Path))
		if !isFileOfSize(local, file.Size) {
			return nil, file.Path
		}
		out[file.Index] = local
	}
	return out, ""
}

func isFileOfSize(path string, size int64) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Size() == size
}

// torrentFiles are the files of the torrent a download holds: every file but
// the padding files.
func torrentFiles(torrent torrentmeta.Info) []torrentmeta.File {
	files := make([]torrentmeta.File, 0, len(torrent.Files))
	for _, file := range torrent.Files {
		if !file.Padding {
			files = append(files, file)
		}
	}
	return files
}
