package downloader

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
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

// tvShowMedia is the `media` file metadata of a show folder.
type tvShowMedia struct {
	Kind          string        `json:"kind"`
	TMDB          tmdbReference `json:"tmdb"`
	Title         string        `json:"title"`
	OriginalTitle string        `json:"originalTitle,omitempty"`
	Year          int           `json:"year,omitempty"`
	Overview      string        `json:"overview,omitempty"`
	Genres        []string      `json:"genres,omitempty"`
	Poster        string        `json:"poster,omitempty"`
	Fanart        string        `json:"fanart,omitempty"`
}

// episodeMedia is the `media` file metadata of an episode video. TMDB names
// the series, not the episode.
type episodeMedia struct {
	Kind     string        `json:"kind"`
	TMDB     tmdbReference `json:"tmdb"`
	Season   int           `json:"season"`
	Episode  int           `json:"episode"`
	Title    string        `json:"title,omitempty"`
	Overview string        `json:"overview,omitempty"`
	Aired    string        `json:"aired,omitempty"`
	Still    string        `json:"still,omitempty"`
}

type tmdbReference struct {
	ID   int    `json:"id"`
	Type string `json:"type"`
}

// uploadPlan uploads a plan under its folder in the task's target folder and
// returns the folder's id. The folder and every folder inside it are reused
// when they exist, and all of them are settled before any file goes up, so a
// name taken by a file makes the plan unusable. Videos and other files keep
// their names unless the name is taken, when the server renames them; a
// sidecar takes the name its video was given, and a live entry already at a
// sidecar or kept path is kept and referenced instead. Once the files are up,
// the videos and the show folder get their `media`.
func (u *Uploader) uploadPlan(ctx context.Context, log *slog.Logger, task client.DownloadTask, plan UploadPlan, torrentPaths map[string]string) (string, []string, error) {
	token := task.UploadToken()
	target := task.TargetFolder()
	folder, err := u.ensureFolder(ctx, token, target, plan.Folder)
	if err != nil {
		return "", nil, err
	}
	folderPath := joinObjectPath(target, folder.Name)
	// The files this upload created. A failed upload deletes them and leaves
	// the folders: another task may have joined a folder this one created.
	var made []string
	completed := false
	defer func() {
		if completed {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		for _, id := range made {
			if err := u.deleteObject(cleanupCtx, token, id); err != nil {
				log.Warn("failed to delete remote object after plan upload failure", "object_id", id, "error", err)
			}
		}
	}()

	folders := map[string]string{"": folderPath}
	progress := &uploadProgress{lastAt: time.Now()}
	for _, file := range plan.Files {
		progress.totalBytes += file.Size
		if _, err := u.ensureFolderPath(ctx, token, folders, planDir(file.Path)); err != nil {
			return "", nil, err
		}
	}
	finalNames := map[string]string{}
	ids := map[string]string{}
	files := append([]PlannedFile(nil), plan.Files...)
	// Sidecars go last: they are named after the name their video was given.
	sort.SliceStable(files, func(i, j int) bool { return files[i].Sidecar == nil && files[j].Sidecar != nil })
	for _, file := range files {
		parent := folders[planDir(file.Path)]
		if file.Sidecar == nil && !file.Keep {
			live, err := u.uploadSingleFile(ctx, log, task, file.LocalPath, path.Base(file.Path), file.Size, parent, client.OnConflictRename, torrentPathOf(torrentPaths, file.LocalPath), progress)
			if err != nil {
				return "", nil, err
			}
			made = append(made, live.ID)
			finalNames[file.Path] = live.Name
			ids[file.Path] = live.ID
			continue
		}
		name := path.Base(file.Path)
		if file.Sidecar != nil {
			videoName, ok := finalNames[file.Sidecar.Video]
			if !ok {
				return "", nil, fmt.Errorf("plan sidecar %s names a video the plan does not hold", file.Path)
			}
			name = strings.TrimSuffix(videoName, path.Ext(videoName)) + file.Sidecar.Suffix
		}
		id, uploaded, err := u.uploadUnlessPresent(ctx, log, task, file, name, parent, torrentPathOf(torrentPaths, file.LocalPath), progress)
		if err != nil {
			return "", nil, err
		}
		if uploaded {
			made = append(made, id)
		}
		ids[file.Path] = id
	}
	completed = true

	notices := u.writeMedia(ctx, log, token, plan, folder.ID, ids)
	return folder.ID, notices, nil
}

// uploadUnlessPresent uploads a file that an entry already at its name wins
// over, and returns the id of the entry that holds the name and whether this
// call uploaded it.
func (u *Uploader) uploadUnlessPresent(
	ctx context.Context,
	log *slog.Logger,
	task client.DownloadTask,
	file PlannedFile,
	name string,
	parent string,
	torrentPath string,
	progress *uploadProgress,
) (string, bool, error) {
	live, err := u.uploadSingleFile(ctx, log, task, file.LocalPath, name, file.Size, parent, client.OnConflictFail, torrentPath, progress)
	if err == nil {
		return live.ID, true, nil
	}
	if ctx.Err() != nil {
		return "", false, err
	}
	// A create answers 409 when the name is taken, and so does a completion
	// that loses a race with another task's upload of the same name. Any
	// failure while a live file holds the name leaves that file in place.
	existing, found, findErr := u.findObject(ctx, task.UploadToken(), parent, name)
	if findErr != nil {
		return "", false, findErr
	}
	if !found || existing.IsFolder {
		return "", false, fmt.Errorf("%s: %w", name, err)
	}
	log.Info("kept existing entry", "name", name, "object_id", existing.ID)
	return existing.ID, false, nil
}

func planDir(planPath string) string {
	if dir := path.Dir(planPath); dir != "." {
		return dir
	}
	return ""
}

// writeMedia sets `media` on each video that has an .nfo sidecar, read back
// from the file the plan uploaded: a movie .nfo makes it a movie, an episode
// .nfo an episode of the series the plan's tvshow.nfo names. The plan's
// folder gets the show's `media` from that tvshow.nfo, which the server takes
// only while the folder has none. A failure is a notice for the task
// activity: the files are already up.
func (u *Uploader) writeMedia(ctx context.Context, log *slog.Logger, token string, plan UploadPlan, folderID string, ids map[string]string) []string {
	sidecars := map[string]map[string]PlannedFile{}
	var showNFO *PlannedFile
	for i, file := range plan.Files {
		if file.Path == mediascrape.TVShowNFOName {
			showNFO = &plan.Files[i]
		}
		if file.Sidecar == nil {
			continue
		}
		if sidecars[file.Sidecar.Video] == nil {
			sidecars[file.Sidecar.Video] = map[string]PlannedFile{}
		}
		sidecars[file.Sidecar.Video][file.Sidecar.Suffix] = file
	}
	seriesID := 0
	if showNFO != nil {
		if data, err := readNFO(showNFO.LocalPath); err == nil {
			seriesID = mediascrape.ReadNFOIdentity(string(data)).TMDBID
		}
	}
	idOf := func(video string, suffix string) string {
		file, ok := sidecars[video][suffix]
		if !ok {
			return ""
		}
		return ids[file.Path]
	}

	var notices []string
	save := func(label string, id string, media any) {
		err := u.putMediaMetadata(ctx, token, id, media)
		if err == nil {
			return
		}
		log.Warn("failed to save media metadata", "object_id", id, "error", err)
		notices = append(notices, fmt.Sprintf("media metadata for %s was not saved: %v", label, err))
	}
	for _, file := range plan.Files {
		nfo, ok := sidecars[file.Path][mediascrape.SuffixNFO]
		if !file.Video || !ok {
			continue
		}
		media, err := readVideoMedia(nfo.LocalPath, seriesID)
		if err != nil {
			notices = append(notices, fmt.Sprintf("media metadata for %s was not saved: %v", file.Path, err))
			continue
		}
		switch media := media.(type) {
		case movieMedia:
			media.Poster = idOf(file.Path, mediascrape.SuffixPoster)
			media.Fanart = idOf(file.Path, mediascrape.SuffixFanart)
			save(file.Path, ids[file.Path], media)
		case episodeMedia:
			media.Still = idOf(file.Path, mediascrape.SuffixThumb)
			save(file.Path, ids[file.Path], media)
		}
	}
	if showNFO == nil {
		return notices
	}
	show, err := readShowMedia(showNFO.LocalPath)
	if err != nil {
		return append(notices, fmt.Sprintf("media metadata for %s was not saved: %v", plan.Folder, err))
	}
	show.Poster = ids[mediascrape.ShowPosterName]
	show.Fanart = ids[mediascrape.ShowFanartName]
	if err := u.putMediaMetadata(ctx, token, folderID, show); client.IsConflict(err) {
		log.Info("kept the show folder's existing media metadata", "object_id", folderID)
	} else if err != nil {
		log.Warn("failed to save media metadata", "object_id", folderID, "error", err)
		notices = append(notices, fmt.Sprintf("media metadata for %s was not saved: %v", plan.Folder, err))
	}
	return notices
}

func readNFO(nfoPath string) ([]byte, error) {
	f, err := os.Open(nfoPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, mediascrape.MaxNFOBytes))
}

// readVideoMedia reads a video's .nfo sidecar as a movieMedia or an
// episodeMedia of the series seriesID.
func readVideoMedia(nfoPath string, seriesID int) (any, error) {
	data, err := readNFO(nfoPath)
	if err != nil {
		return nil, err
	}
	switch mediascrape.ReadNFOIdentity(string(data)).Kind {
	case mediascrape.NFOMovie:
		details, err := mediascrape.ReadMovieNFO(bytes.NewReader(data))
		if err != nil {
			return nil, err
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
	case mediascrape.NFOEpisode:
		if seriesID <= 0 {
			return nil, errors.New("no tvshow.nfo names the series")
		}
		details, err := mediascrape.ReadEpisodeNFO(bytes.NewReader(data))
		if err != nil {
			return nil, err
		}
		return episodeMedia{
			Kind:     "episode",
			TMDB:     tmdbReference{ID: seriesID, Type: "tv"},
			Season:   details.Season,
			Episode:  details.Episode,
			Title:    details.Title,
			Overview: details.Overview,
			Aired:    details.Aired,
		}, nil
	}
	return nil, errors.New("the .nfo describes neither a movie nor an episode")
}

func readShowMedia(nfoPath string) (tvShowMedia, error) {
	data, err := readNFO(nfoPath)
	if err != nil {
		return tvShowMedia{}, err
	}
	details, err := mediascrape.ReadTVShowNFO(bytes.NewReader(data))
	if err != nil {
		return tvShowMedia{}, err
	}
	return tvShowMedia{
		Kind:          "tvshow",
		TMDB:          tmdbReference{ID: details.TMDBID, Type: "tv"},
		Title:         details.Title,
		OriginalTitle: details.OriginalTitle,
		Year:          details.Year,
		Overview:      details.Overview,
		Genres:        details.Genres,
	}, nil
}

// ensureFolder returns the live folder named name in parent, creating it when
// there is none. A create that loses a race to another task answers 409, and
// the folder that task made is used.
func (u *Uploader) ensureFolder(ctx context.Context, token string, parent string, name string) (client.ObjectEntry, error) {
	for attempt := 0; attempt < 2; attempt++ {
		existing, found, err := u.findObject(ctx, token, parent, name)
		if err != nil {
			return client.ObjectEntry{}, err
		}
		if found {
			if !existing.IsFolder {
				return client.ObjectEntry{}, &planUnusableError{reason: fmt.Sprintf("%q is a file, not a folder", joinObjectPath(parent, name))}
			}
			return existing, nil
		}
		draft, err := u.createFolder(ctx, token, name, parent, client.OnConflictFail)
		if client.IsConflict(err) {
			continue
		}
		if err != nil {
			return client.ObjectEntry{}, err
		}
		return client.ObjectEntry{ID: draft.ID, Name: draft.Name, IsFolder: true}, nil
	}
	return client.ObjectEntry{}, fmt.Errorf("folder %q keeps conflicting", joinObjectPath(parent, name))
}

// ensureFolderPath makes sure every folder of dir exists under the plan's
// folder and returns dir's object path. folders caches the paths made so far.
// A name taken by a file makes the plan unusable.
func (u *Uploader) ensureFolderPath(ctx context.Context, token string, folders map[string]string, dir string) (string, error) {
	if objectPath, ok := folders[dir]; ok {
		return objectPath, nil
	}
	parent, err := u.ensureFolderPath(ctx, token, folders, planDir(dir))
	if err != nil {
		return "", err
	}
	folder, err := u.ensureFolder(ctx, token, parent, path.Base(dir))
	if err != nil {
		return "", err
	}
	folders[dir] = joinObjectPath(parent, folder.Name)
	return folders[dir], nil
}
