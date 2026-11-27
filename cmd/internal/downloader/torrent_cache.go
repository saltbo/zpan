package downloader

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/pkg/mediascrape"
	"github.com/saltbo/zpan/pkg/system"
	"github.com/saltbo/zpan/pkg/torrentmeta"
)

// A task assigned in cache mode fills the instance-wide torrent cache
// (docs/design/torrent-cache.md §6). Once the engine has the torrent's metadata
// the downloader registers its info dictionary; the server answers whether to
// fill the cache, drop the task because the torrent is cached or being
// downloaded elsewhere, or upload into the drive as before. A fill uploads each
// torrent file to its fileIdx, each sidecar the scraper wrote, and the upload
// plan as the layout, then completes the torrent, and the server finishes the
// task by instant transfer.

// torrentCacheAPI is the part of the API a downloader fills the cache through.
type torrentCacheAPI interface {
	RegisterTaskTorrent(ctx context.Context, token string, taskID string, info []byte) (client.TorrentRegistration, error)
	CreateTorrentFileUpload(ctx context.Context, token string, taskID string, fileIdx int) (client.TorrentUpload, error)
	CompleteTorrentFileUpload(ctx context.Context, token string, taskID string, fileIdx int, uploadID *string, parts []client.CompletedObjectUploadPart) error
	CreateTorrentSidecarUpload(ctx context.Context, token string, taskID string, n int, size int64) (client.TorrentUpload, error)
	CompleteTorrentSidecarUpload(ctx context.Context, token string, taskID string, n int) error
	PutTaskTorrentLayout(ctx context.Context, token string, taskID string, layout any) error
	CompleteTaskTorrent(ctx context.Context, token string, taskID string, files []client.TorrentFile) (client.DownloadTask, error)
}

// errTaskSettledByCache stops a download whose torrent the cache already holds
// or another download is filling: the server settled the task.
var errTaskSettledByCache = errors.New("task settled by the torrent cache")

const registerRetryInterval = 5 * time.Second

// torrentCache is the cache state of one running task.
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
	return c.registration.Outcome == client.TorrentOutcomeJoined || c.registration.Outcome == client.TorrentOutcomeCompleted
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
// Pending metadata leaves the state unregistered for a later attempt. A
// registration the server refuses, such as a v2-only torrent, sends the task
// to the drive.
func (w *TaskRunner) registerTorrent(ctx context.Context, log *slog.Logger, task client.DownloadTask, state *torrentCache) error {
	if state.registration != nil {
		return nil
	}
	api, ok := w.cacheAPI()
	if !ok {
		state.registration = &client.TorrentRegistration{Outcome: client.TorrentOutcomeDrive}
		return nil
	}
	state.lastAttempt = time.Now()
	metadata, err := w.downloader.TorrentMetadata(ctx, downloadTask(task))
	if err != nil {
		return err
	}
	info, err := torrentmeta.InfoDict(metadata)
	if err != nil {
		log.Warn("torrent metadata is unreadable; uploading into the drive", "error", err)
		state.registration = &client.TorrentRegistration{Outcome: client.TorrentOutcomeDrive}
		return nil
	}
	var registration client.TorrentRegistration
	err = callAPI(ctx, log, "register task torrent", func(ctx context.Context) error {
		var err error
		registration, err = api.RegisterTaskTorrent(ctx, task.UploadToken(), task.ID, info)
		return err
	})
	if client.IsStatus(err, http.StatusBadRequest) || client.IsConflict(err) {
		log.Warn("torrent cache refused the torrent; uploading into the drive", "error", err)
		state.registration = &client.TorrentRegistration{Outcome: client.TorrentOutcomeDrive}
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
// yet, waiting for the engine's metadata where it is still being written.
func (w *TaskRunner) registerAfterDownload(ctx context.Context, log *slog.Logger, task client.DownloadTask, state *torrentCache) error {
	for attempt := 0; ; attempt++ {
		err := w.registerTorrent(ctx, log, task, state)
		if err == nil {
			return nil
		}
		if !errors.Is(err, ErrTorrentMetadataPending) || attempt >= 5 {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// dropSettledTask removes the local download of a task the server settled from
// the cache.
func (w *TaskRunner) dropSettledTask(ctx context.Context, log *slog.Logger, task client.DownloadTask, state *torrentCache) {
	if err := w.cleanupTerminalTask(ctx, task); err != nil {
		log.Warn("failed to remove local download of a task settled by the torrent cache", "error", err)
	}
	log.Info("task settled by the torrent cache", "outcome", state.registration.Outcome)
}

// uploadToCache uploads a finished download into the torrent cache and
// completes it. It returns notices for the task activity.
func (u *Uploader) uploadToCache(ctx context.Context, log *slog.Logger, task client.DownloadTask, result Result, registration client.TorrentRegistration) ([]string, error) {
	api, ok := u.api.(torrentCacheAPI)
	if !ok {
		return nil, errors.New("API client cannot fill the torrent cache")
	}
	locals, err := torrentLocalFiles(result, registration)
	if err != nil {
		return nil, err
	}
	var plan *cacheLayout
	var notices []string
	if result.Plan != nil {
		plan = layoutFromPlan(*result.Plan, locals)
	}
	progress := &uploadProgress{lastAt: time.Now()}
	for _, file := range registration.Files {
		progress.totalBytes += file.Size
	}
	if plan != nil {
		for _, sidecar := range plan.sidecars {
			progress.totalBytes += sidecar.size
		}
	}
	token := task.UploadToken()
	for _, file := range registration.Files {
		if err := u.uploadTorrentFile(ctx, log, api, task, file, locals[file.FileIdx], progress); err != nil {
			return nil, err
		}
	}
	if plan != nil {
		notices = append(notices, u.uploadLayout(ctx, log, api, task, *plan, progress)...)
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
		etag, err := uploadFilePart(ctx, part.URL, nil, file, part.Offset, part.Length, func(written int64) error {
			return u.reportUploadProgress(ctx, log, task, progress, written)
		})
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

// uploadLayout uploads the plan's sidecars and then the layout that names
// them. A failure leaves the torrent without a layout, laid out as its own
// tree, and is a notice for the task activity.
func (u *Uploader) uploadLayout(ctx context.Context, log *slog.Logger, api torrentCacheAPI, task client.DownloadTask, plan cacheLayout, progress *uploadProgress) []string {
	token := task.UploadToken()
	for _, sidecar := range plan.sidecars {
		var upload client.TorrentUpload
		err := callAPI(ctx, log, "create torrent sidecar upload", func(ctx context.Context) error {
			var err error
			upload, err = api.CreateTorrentSidecarUpload(ctx, token, task.ID, sidecar.n, sidecar.size)
			return err
		})
		if err == nil {
			_, err = u.putParts(ctx, log, task, sidecar.localPath, upload, progress)
		}
		if err == nil {
			err = callAPI(ctx, log, "complete torrent sidecar upload", func(ctx context.Context) error {
				return api.CompleteTorrentSidecarUpload(ctx, token, task.ID, sidecar.n)
			})
		}
		if err != nil {
			log.Warn("failed to upload sidecar into the torrent cache", "path", sidecar.path, "error", err)
			return []string{fmt.Sprintf("the scraped layout was not cached: %s: %v", sidecar.path, err)}
		}
	}
	put := func(layout torrentLayout) error {
		return callAPI(ctx, log, "put task torrent layout", func(ctx context.Context) error {
			return api.PutTaskTorrentLayout(ctx, token, task.ID, layout)
		})
	}
	err := put(plan.layout)
	if client.IsStatus(err, http.StatusBadRequest) && plan.layout.hasMedia() {
		// Media the server cannot take should not cost the folders and sidecars.
		log.Warn("torrent cache refused the layout's media; caching it without media", "error", err)
		bare := plan.layout.withoutMedia()
		if err = put(bare); err == nil {
			return []string{"media metadata was not cached: the server refused it"}
		}
	}
	if err != nil {
		log.Warn("failed to cache the scraped layout", "error", err)
		return []string{fmt.Sprintf("the scraped layout was not cached: %v", err)}
	}
	return nil
}

// torrentLocalFiles finds each torrent file in the finished download, by its
// path inside the torrent below the download's root folder, whatever the
// engine named that folder, and by its size.
func torrentLocalFiles(result Result, registration client.TorrentRegistration) (map[int]string, error) {
	type local struct {
		path string
		size int64
	}
	var files []local
	byRel := map[string]local{}
	if !result.IsDir {
		info, err := os.Stat(result.Path)
		if err != nil {
			return nil, err
		}
		files = append(files, local{path: result.Path, size: info.Size()})
	} else {
		err := filepath.WalkDir(result.Path, func(p string, entry os.DirEntry, err error) error {
			if err != nil || entry.IsDir() {
				return err
			}
			rel, err := filepath.Rel(result.Path, p)
			if err != nil {
				return err
			}
			rel = filepath.ToSlash(rel)
			// The engines' copy of the .torrent file is no torrent file.
			if system.IsDownloadSidecarPath(rel) {
				return nil
			}
			info, err := entry.Info()
			if err != nil {
				return err
			}
			item := local{path: p, size: info.Size()}
			files = append(files, item)
			byRel[rel] = item
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	out := make(map[int]string, len(registration.Files))
	single := len(registration.Files) == 1 && registration.Files[0].Path == registration.Name
	for _, file := range registration.Files {
		if single {
			var match []local
			for _, item := range files {
				if item.size == file.Size {
					match = append(match, item)
				}
			}
			if len(match) != 1 {
				return nil, fmt.Errorf("downloaded file %s is missing", file.Path)
			}
			out[file.FileIdx] = match[0].path
			continue
		}
		item, ok := byRel[file.Path]
		if !ok {
			// The download folder holds the torrent's root folder, under
			// whatever name the engine gave it.
			for rel, candidate := range byRel {
				if _, rest, cut := strings.Cut(rel, "/"); cut && rest == file.Path {
					item, ok = candidate, true
					break
				}
			}
		}
		if !ok || item.size != file.Size {
			return nil, fmt.Errorf("downloaded file %s is missing", file.Path)
		}
		out[file.FileIdx] = item.path
	}
	return out, nil
}

// torrentLayout is the upload layout the server stores as layout.json.
type torrentLayout struct {
	Version int           `json:"version"`
	Entries []layoutEntry `json:"entries"`
}

type layoutEntry struct {
	Kind    string `json:"kind"`
	Path    string `json:"path"`
	FileIdx *int   `json:"fileIdx,omitempty"`
	Sidecar *int   `json:"sidecar,omitempty"`
	Video   string `json:"video,omitempty"`
	Media   any    `json:"media,omitempty"`
}

func (l torrentLayout) hasMedia() bool {
	for _, entry := range l.Entries {
		if entry.Media != nil {
			return true
		}
	}
	return false
}

func (l torrentLayout) withoutMedia() torrentLayout {
	bare := torrentLayout{Version: l.Version, Entries: make([]layoutEntry, len(l.Entries))}
	for i, entry := range l.Entries {
		entry.Media = nil
		bare.Entries[i] = entry
	}
	return bare
}

type layoutSidecar struct {
	n         int
	path      string
	localPath string
	size      int64
}

type cacheLayout struct {
	layout   torrentLayout
	sidecars []layoutSidecar
}

// layoutFromPlan turns an upload plan into the cache's layout: plan paths
// under the plan's folder, the downloaded files by fileIdx, every other file of
// the plan as a numbered sidecar, and the media the drive upload would have
// set, with image references written as layout paths.
func layoutFromPlan(plan UploadPlan, locals map[int]string) *cacheLayout {
	fileIdx := make(map[string]int, len(locals))
	for idx, local := range locals {
		fileIdx[filepath.Clean(local)] = idx
	}
	layoutPath := func(p string) string { return joinObjectPath(plan.Folder, p) }

	dirs := map[string]bool{"": true}
	for _, file := range plan.Files {
		for dir := planDir(file.Path); dir != "" && !dirs[dir]; dir = planDir(dir) {
			dirs[dir] = true
		}
	}
	sortedDirs := make([]string, 0, len(dirs))
	for dir := range dirs {
		sortedDirs = append(sortedDirs, dir)
	}
	sort.Strings(sortedDirs)

	out := &cacheLayout{layout: torrentLayout{Version: 1}}
	folderAt := map[string]int{}
	for _, dir := range sortedDirs {
		folderAt[dir] = len(out.layout.Entries)
		out.layout.Entries = append(out.layout.Entries, layoutEntry{Kind: "folder", Path: layoutPath(dir)})
	}
	entryAt := map[string]int{}
	for _, file := range plan.Files {
		entry := layoutEntry{Path: layoutPath(file.Path)}
		if idx, ok := fileIdx[filepath.Clean(file.LocalPath)]; ok && file.Sidecar == nil && !file.Keep {
			entry.Kind = "torrent-file"
			entry.FileIdx = &idx
		} else {
			n := len(out.sidecars)
			entry.Kind = "sidecar"
			entry.Sidecar = &n
			if file.Sidecar != nil {
				entry.Video = layoutPath(file.Sidecar.Video)
			}
			out.sidecars = append(out.sidecars, layoutSidecar{n: n, path: file.Path, localPath: file.LocalPath, size: file.Size})
		}
		entryAt[file.Path] = len(out.layout.Entries)
		out.layout.Entries = append(out.layout.Entries, entry)
	}

	media := planMedia(plan)
	for planPath, value := range media.videos {
		if at, ok := entryAt[planPath]; ok && out.layout.Entries[at].Kind == "torrent-file" {
			out.layout.Entries[at].Media = value
		}
	}
	if media.show != nil {
		out.layout.Entries[folderAt[""]].Media = media.show
	}
	return out
}

type plannedMedia struct {
	videos map[string]any
	show   *tvShowMedia
}

// planMedia reads the plan's .nfo sidecars the way writeMedia does, with each
// image named by its layout path instead of a matter id.
func planMedia(plan UploadPlan) plannedMedia {
	out := plannedMedia{videos: map[string]any{}}
	layoutPath := func(p string) string { return joinObjectPath(plan.Folder, p) }
	sidecars := map[string]map[string]string{}
	var showNFO *PlannedFile
	planned := map[string]bool{}
	for i, file := range plan.Files {
		planned[file.Path] = true
		if file.Path == mediascrape.TVShowNFOName {
			showNFO = &plan.Files[i]
		}
		if file.Sidecar == nil {
			continue
		}
		if sidecars[file.Sidecar.Video] == nil {
			sidecars[file.Sidecar.Video] = map[string]string{}
		}
		sidecars[file.Sidecar.Video][file.Sidecar.Suffix] = file.Path
	}
	image := func(video string, suffix string) string {
		if p, ok := sidecars[video][suffix]; ok {
			return layoutPath(p)
		}
		return ""
	}
	seriesID := 0
	if showNFO != nil {
		if data, err := readNFO(showNFO.LocalPath); err == nil {
			seriesID = mediascrape.ReadNFOIdentity(string(data)).TMDBID
		}
	}
	for _, file := range plan.Files {
		nfo, ok := sidecars[file.Path][mediascrape.SuffixNFO]
		if !file.Video || !ok {
			continue
		}
		local := ""
		for _, candidate := range plan.Files {
			if candidate.Path == nfo {
				local = candidate.LocalPath
			}
		}
		value, err := readVideoMedia(local, seriesID)
		if err != nil {
			continue
		}
		switch media := value.(type) {
		case movieMedia:
			media.Poster = image(file.Path, mediascrape.SuffixPoster)
			media.Fanart = image(file.Path, mediascrape.SuffixFanart)
			out.videos[file.Path] = media
		case episodeMedia:
			media.Still = image(file.Path, mediascrape.SuffixThumb)
			out.videos[file.Path] = media
		}
	}
	if showNFO == nil {
		return out
	}
	show, err := readShowMedia(showNFO.LocalPath)
	if err != nil {
		return out
	}
	if planned[mediascrape.ShowPosterName] {
		show.Poster = layoutPath(mediascrape.ShowPosterName)
	}
	if planned[mediascrape.ShowFanartName] {
		show.Fanart = layoutPath(mediascrape.ShowFanartName)
	}
	out.show = &show
	return out
}
