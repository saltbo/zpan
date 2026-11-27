package downloader

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/pkg/mediascrape"
)

// planUnusableError means the plan cannot be uploaded as laid out, before
// anything was created, so the download uploads as it would unscraped.
type planUnusableError struct {
	reason string
}

func (e *planUnusableError) Error() string {
	return e.reason
}

// movieMedia is the `media` file metadata of a movie video.
type movieMedia struct {
	Kind          string        `json:"kind"`
	TMDB          tmdbReference `json:"tmdb"`
	Title         string        `json:"title"`
	OriginalTitle string        `json:"originalTitle,omitempty"`
	Year          int           `json:"year,omitempty"`
	Overview      string        `json:"overview,omitempty"`
	Genres        []string      `json:"genres,omitempty"`
	Runtime       int           `json:"runtime,omitempty"`
	Poster        string        `json:"poster,omitempty"`
	Fanart        string        `json:"fanart,omitempty"`
}

type tmdbReference struct {
	ID   int    `json:"id"`
	Type string `json:"type"`
}

// uploadPlan uploads a plan under its folder in the task's target folder and
// returns the folder's id. The folder and its subfolders are reused when they
// exist. Videos and other files keep their names unless the name is taken,
// when the server renames them; a sidecar takes the name its video was given,
// and a live entry already at a sidecar path is kept and referenced instead.
// Once the files are up, each video with a movie .nfo gets its `media`.
func (u *Uploader) uploadPlan(ctx context.Context, log *slog.Logger, task client.DownloadTask, plan UploadPlan) (string, []string, error) {
	token := task.UploadToken()
	target := task.TargetFolder()
	folder, created, err := u.ensureFolder(ctx, token, target, plan.Folder)
	if err != nil {
		return "", nil, err
	}
	folderPath := joinObjectPath(target, folder.Name)
	var uploaded []string
	completed := false
	defer func() {
		if completed {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		discard := uploaded
		if created {
			discard = []string{folder.ID}
		}
		for _, id := range discard {
			if err := u.deleteObject(cleanupCtx, token, id); err != nil {
				log.Warn("failed to delete remote object after plan upload failure", "object_id", id, "error", err)
			}
		}
	}()

	folders := map[string]string{"": folderPath}
	progress := &uploadProgress{lastAt: time.Now()}
	for _, file := range plan.Files {
		progress.totalBytes += file.Size
	}
	finalNames := map[string]string{}
	ids := map[string]string{}
	files := append([]PlannedFile(nil), plan.Files...)
	// Sidecars go last: they are named after the name their video was given.
	sort.SliceStable(files, func(i, j int) bool { return files[i].Sidecar == nil && files[j].Sidecar != nil })
	for _, file := range files {
		dir := path.Dir(file.Path)
		if dir == "." {
			dir = ""
		}
		parent, err := u.ensureFolderPath(ctx, token, folders, dir)
		if err != nil {
			return "", nil, err
		}
		if file.Sidecar == nil {
			live, err := u.uploadSingleFile(ctx, log, task, file.LocalPath, path.Base(file.Path), file.Size, parent, client.OnConflictRename, progress)
			if err != nil {
				return "", nil, err
			}
			uploaded = append(uploaded, live.ID)
			finalNames[file.Path] = live.Name
			ids[file.Path] = live.ID
			continue
		}
		videoName, ok := finalNames[file.Sidecar.Video]
		if !ok {
			return "", nil, fmt.Errorf("plan sidecar %s names a video the plan does not hold", file.Path)
		}
		name := strings.TrimSuffix(videoName, path.Ext(videoName)) + file.Sidecar.Suffix
		live, err := u.uploadSingleFile(ctx, log, task, file.LocalPath, name, file.Size, parent, client.OnConflictFail, progress)
		if client.IsConflict(err) {
			existing, found, findErr := u.findObject(ctx, token, parent, name)
			if findErr != nil {
				return "", nil, findErr
			}
			if !found || existing.IsFolder {
				return "", nil, fmt.Errorf("sidecar %s: %w", name, err)
			}
			log.Info("kept existing sidecar", "name", name, "object_id", existing.ID)
			ids[file.Path] = existing.ID
			continue
		}
		if err != nil {
			return "", nil, err
		}
		uploaded = append(uploaded, live.ID)
		ids[file.Path] = live.ID
	}
	completed = true

	notices := u.writeMovieMedia(ctx, log, token, plan, ids)
	return folder.ID, notices, nil
}

// writeMovieMedia sets `media` on each video that has a movie .nfo sidecar,
// read back from the file the plan uploaded. A failure is a notice for the
// task activity: the files are already up.
func (u *Uploader) writeMovieMedia(ctx context.Context, log *slog.Logger, token string, plan UploadPlan, ids map[string]string) []string {
	sidecars := map[string]map[string]PlannedFile{}
	for _, file := range plan.Files {
		if file.Sidecar == nil {
			continue
		}
		if sidecars[file.Sidecar.Video] == nil {
			sidecars[file.Sidecar.Video] = map[string]PlannedFile{}
		}
		sidecars[file.Sidecar.Video][file.Sidecar.Suffix] = file
	}
	var notices []string
	for _, file := range plan.Files {
		nfo, ok := sidecars[file.Path][mediascrape.SuffixNFO]
		if !file.Video || !ok {
			continue
		}
		media, err := readMovieMedia(nfo.LocalPath)
		if err != nil {
			notices = append(notices, fmt.Sprintf("media metadata for %s was not saved: %v", file.Path, err))
			continue
		}
		media.Poster = ids[sidecars[file.Path][mediascrape.SuffixPoster].Path]
		media.Fanart = ids[sidecars[file.Path][mediascrape.SuffixFanart].Path]
		if err := u.putMediaMetadata(ctx, token, ids[file.Path], media); err != nil {
			log.Warn("failed to save media metadata", "object_id", ids[file.Path], "error", err)
			notices = append(notices, fmt.Sprintf("media metadata for %s was not saved: %v", file.Path, err))
		}
	}
	return notices
}

func readMovieMedia(nfoPath string) (movieMedia, error) {
	f, err := os.Open(nfoPath)
	if err != nil {
		return movieMedia{}, err
	}
	defer f.Close()
	details, err := mediascrape.ReadMovieNFO(f)
	if err != nil {
		return movieMedia{}, err
	}
	return movieMedia{
		Kind:          "movie",
		TMDB:          tmdbReference{ID: details.TMDBID, Type: "movie"},
		Title:         details.Title,
		OriginalTitle: details.OriginalTitle,
		Year:          details.Year,
		Overview:      details.Overview,
		Genres:        details.Genres,
		Runtime:       details.Runtime,
	}, nil
}

// ensureFolder returns the live folder named name in parent, creating it when
// there is none. A create that loses a race to another task answers 409, and
// the folder that task made is used. created reports whether this call made it.
func (u *Uploader) ensureFolder(ctx context.Context, token string, parent string, name string) (client.ObjectEntry, bool, error) {
	for attempt := 0; attempt < 2; attempt++ {
		existing, found, err := u.findObject(ctx, token, parent, name)
		if err != nil {
			return client.ObjectEntry{}, false, err
		}
		if found {
			if !existing.IsFolder {
				return client.ObjectEntry{}, false, &planUnusableError{reason: fmt.Sprintf("%q is a file, not a folder", joinObjectPath(parent, name))}
			}
			return existing, false, nil
		}
		draft, err := u.createFolder(ctx, token, name, parent, client.OnConflictFail)
		if client.IsConflict(err) {
			continue
		}
		if err != nil {
			return client.ObjectEntry{}, false, err
		}
		return client.ObjectEntry{ID: draft.ID, Name: draft.Name, IsFolder: true}, true, nil
	}
	return client.ObjectEntry{}, false, fmt.Errorf("folder %q keeps conflicting", joinObjectPath(parent, name))
}

// ensureFolderPath makes sure every folder of dir exists under the plan's
// folder and returns dir's object path. folders caches the paths made so far.
func (u *Uploader) ensureFolderPath(ctx context.Context, token string, folders map[string]string, dir string) (string, error) {
	if objectPath, ok := folders[dir]; ok {
		return objectPath, nil
	}
	parentDir := path.Dir(dir)
	if parentDir == "." {
		parentDir = ""
	}
	parent, err := u.ensureFolderPath(ctx, token, folders, parentDir)
	if err != nil {
		return "", err
	}
	folder, _, err := u.ensureFolder(ctx, token, parent, path.Base(dir))
	var unusable *planUnusableError
	if errors.As(err, &unusable) {
		return "", errors.New(unusable.reason)
	}
	if err != nil {
		return "", err
	}
	folders[dir] = joinObjectPath(parent, folder.Name)
	return folders[dir], nil
}
