package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/config"
	"github.com/saltbo/zpan/pkg/mediascrape"
)

// fakeDrive is an in-memory workspace that answers the object calls a task
// upload makes, with the server's name rules: names compare case-insensitively,
// rename picks `X (1).ext`, and fail answers 409.
type fakeDrive struct {
	t         *testing.T
	mu        sync.Mutex
	uploadURL string
	entries   map[string]*driveEntry // lower(path) → entry
	drafts    map[string]*driveEntry
	nextID    int
	metadata  map[string]json.RawMessage
	patches   []client.TaskPatch
	deleted   []string
	// raceFolder makes the first create of this folder name answer 409 after
	// another task created it.
	raceFolder string
}

type driveEntry struct {
	id, parent, name string
	folder           bool
	content          string
}

func newFakeDrive(t *testing.T) *fakeDrive {
	d := &fakeDrive{t: t, entries: map[string]*driveEntry{}, drafts: map[string]*driveEntry{}, metadata: map[string]json.RawMessage{}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		d.mu.Lock()
		if draft := d.drafts[strings.TrimPrefix(r.URL.Path, "/")]; draft != nil {
			draft.content = string(data)
		}
		d.mu.Unlock()
		w.Header().Set("ETag", `"etag"`)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)
	d.uploadURL = server.URL
	return d
}

func (d *fakeDrive) key(parent, name string) string {
	return strings.ToLower(joinObjectPath(parent, name))
}

func (d *fakeDrive) add(parent, name string, folder bool, content string) *driveEntry {
	d.nextID++
	entry := &driveEntry{id: fmt.Sprintf("obj-%d", d.nextID), parent: parent, name: name, folder: folder, content: content}
	d.entries[d.key(parent, name)] = entry
	return entry
}

func (d *fakeDrive) free(parent, name string) string {
	if _, taken := d.entries[d.key(parent, name)]; !taken {
		return name
	}
	ext := path.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s (%d)%s", base, i, ext)
		if _, taken := d.entries[d.key(parent, candidate)]; !taken {
			return candidate
		}
	}
}

func conflict() error {
	return &client.StatusError{Method: "POST", Path: "/api/objects", Status: http.StatusConflict, Message: "exists"}
}

func (d *fakeDrive) CreateFolder(_ context.Context, _ string, name, parent string, onConflict client.OnConflict) (client.ObjectDraft, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.raceFolder == name {
		d.raceFolder = ""
		d.add(parent, name, true, "")
		return client.ObjectDraft{}, conflict()
	}
	if _, taken := d.entries[d.key(parent, name)]; taken {
		if onConflict == client.OnConflictFail {
			return client.ObjectDraft{}, conflict()
		}
		name = d.free(parent, name)
	}
	entry := d.add(parent, name, true, "")
	return client.ObjectDraft{ID: entry.id, Name: entry.name}, nil
}

func (d *fakeDrive) CreateObject(_ context.Context, _ string, name string, _ int64, parent string, onConflict client.OnConflict) (client.ObjectDraft, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, taken := d.entries[d.key(parent, name)]; taken {
		if onConflict == client.OnConflictFail {
			return client.ObjectDraft{}, conflict()
		}
		name = d.free(parent, name)
	}
	d.nextID++
	id := fmt.Sprintf("obj-%d", d.nextID)
	d.drafts[id] = &driveEntry{id: id, parent: parent, name: name}
	return client.ObjectDraft{ID: id, Name: name, Upload: &client.ObjectUploadInstructions{
		SessionID: "session-" + id,
		PartSize:  1 << 20,
		PartCount: 1,
		Parts:     []client.PresignedObjectUploadPart{{PartNumber: 1, URL: d.uploadURL + "/" + id}},
	}}, nil
}

func (d *fakeDrive) CompleteObjectUpload(_ context.Context, _ string, id string, _ string, _ []client.CompletedObjectUploadPart) (client.ObjectDraft, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	draft := d.drafts[id]
	delete(d.drafts, id)
	d.entries[d.key(draft.parent, draft.name)] = draft
	return client.ObjectDraft{ID: draft.id, Name: draft.name}, nil
}

func (d *fakeDrive) AbortObjectUploadSession(context.Context, string, string, string) error {
	return nil
}

func (d *fakeDrive) DeleteObject(_ context.Context, _ string, id string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.deleted = append(d.deleted, id)
	return nil
}

func (d *fakeDrive) FindObject(_ context.Context, _ string, parent, name string) (client.ObjectEntry, bool, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	entry, ok := d.entries[d.key(parent, name)]
	if !ok {
		return client.ObjectEntry{}, false, nil
	}
	return client.ObjectEntry{ID: entry.id, Name: entry.name, IsFolder: entry.folder}, true, nil
}

func (d *fakeDrive) PutMediaMetadata(_ context.Context, _ string, id string, media any) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	data, err := json.Marshal(media)
	if err != nil {
		return err
	}
	d.metadata[id] = data
	return nil
}

func (d *fakeDrive) UpdateTask(_ context.Context, id string, patch client.TaskPatch) (client.DownloadTask, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.patches = append(d.patches, patch)
	return clientTaskWithUploadToken(id, "uploading"), nil
}

func (d *fakeDrive) Heartbeat(context.Context, client.Heartbeat) (client.HeartbeatResult, error) {
	return client.HeartbeatResult{}, nil
}
func (d *fakeDrive) AssignedTasks(context.Context) ([]client.DownloadTask, error)    { return nil, nil }
func (d *fakeDrive) LocalResultTasks(context.Context) ([]client.DownloadTask, error) { return nil, nil }
func (d *fakeDrive) SeedingTasks(context.Context) ([]client.DownloadTask, error)     { return nil, nil }

func (d *fakeDrive) paths() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var paths []string
	for _, entry := range d.entries {
		paths = append(paths, joinObjectPath(entry.parent, entry.name))
	}
	sort.Strings(paths)
	return paths
}

func (d *fakeDrive) entry(p string) *driveEntry {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.entries[strings.ToLower(p)]
}

func (d *fakeDrive) media(t *testing.T, id string) movieMedia {
	t.Helper()
	d.mu.Lock()
	defer d.mu.Unlock()
	var media movieMedia
	if err := json.Unmarshal(d.metadata[id], &media); err != nil {
		t.Fatalf("metadata of %s: %v", id, err)
	}
	return media
}

func (d *fakeDrive) scrapeNotices() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var notices []string
	for _, patch := range d.patches {
		if patch.ScrapeSkippedReason != "" {
			notices = append(notices, patch.ScrapeSkippedReason)
		}
	}
	return notices
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func planTask() client.DownloadTask {
	task := clientTaskWithUploadToken("task-1", "uploading")
	task.Spec.Destination.Folder = "Movies"
	return task
}

// moviePlan is the plan mediascrape returns for Big Buck Bunny, written to dir.
func moviePlan(t *testing.T, dir string, video string) UploadPlan {
	t.Helper()
	write := func(name, content string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	base := strings.TrimSuffix(video, path.Ext(video))
	nfo := mediascrape.MovieNFO(mediascrape.Movie{
		ID: 10378, Title: "Big Buck Bunny", OriginalTitle: "Big Buck Bunny", Overview: "A giant rabbit.",
		Date: "2008-05-30", Genres: []string{"Animation"}, Runtime: 10,
	})
	return UploadPlan{Folder: "Big Buck Bunny (2008)", Files: []PlannedFile{
		{LocalPath: write(video, "video"), Path: video, Size: 5, Video: true},
		{LocalPath: write(base+".nfo", nfo), Path: base + ".nfo", Size: int64(len(nfo)), Sidecar: &PlannedSidecar{Video: video, Suffix: mediascrape.SuffixNFO}},
		{LocalPath: write(base+"-poster.jpg", "poster"), Path: base + "-poster.jpg", Size: 6, Sidecar: &PlannedSidecar{Video: video, Suffix: mediascrape.SuffixPoster}},
		{LocalPath: write(base+"-fanart.jpg", "fanart"), Path: base + "-fanart.jpg", Size: 6, Sidecar: &PlannedSidecar{Video: video, Suffix: mediascrape.SuffixFanart}},
	}}
}

// [spec: download-scraping/movie-layout]
func TestUploadPlanCreatesTheMovieFolder(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	uploader := NewUploader(drive, nil)

	id, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Plan: ptr(moviePlan(t, t.TempDir(), "bbb.1080p.mkv"))})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"Movies",
		"Movies/Big Buck Bunny (2008)",
		"Movies/Big Buck Bunny (2008)/bbb.1080p-fanart.jpg",
		"Movies/Big Buck Bunny (2008)/bbb.1080p-poster.jpg",
		"Movies/Big Buck Bunny (2008)/bbb.1080p.mkv",
		"Movies/Big Buck Bunny (2008)/bbb.1080p.nfo",
	}
	if got := drive.paths(); strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("drive =\n%s", strings.Join(got, "\n"))
	}
	if folder := drive.entry("Movies/Big Buck Bunny (2008)"); folder.id != id {
		t.Fatalf("result object = %s, want the movie folder %s", id, folder.id)
	}
	video := drive.entry("Movies/Big Buck Bunny (2008)/bbb.1080p.mkv")
	media := drive.media(t, video.id)
	if media.Kind != "movie" || media.TMDB != (tmdbReference{ID: 10378, Type: "movie"}) || media.Title != "Big Buck Bunny" ||
		media.Year != 2008 || media.Runtime != 10 || media.Overview != "A giant rabbit." ||
		media.Poster != drive.entry("Movies/Big Buck Bunny (2008)/bbb.1080p-poster.jpg").id ||
		media.Fanart != drive.entry("Movies/Big Buck Bunny (2008)/bbb.1080p-fanart.jpg").id {
		t.Fatalf("media = %+v", media)
	}
}

// [spec: download-scraping/movie-folder-reused]
func TestUploadPlanReusesTheFolderAndFollowsTheVideosNewName(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	folder := drive.add("Movies", "big buck bunny (2008)", true, "")
	drive.add("Movies/big buck bunny (2008)", "bbb.mkv", false, "first version")
	uploader := NewUploader(drive, nil)

	id, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Plan: ptr(moviePlan(t, t.TempDir(), "bbb.mkv"))})
	if err != nil {
		t.Fatal(err)
	}
	if id != folder.id {
		t.Fatalf("result object = %s, want the reused folder %s", id, folder.id)
	}
	for _, p := range []string{"bbb (1).mkv", "bbb (1).nfo", "bbb (1)-poster.jpg", "bbb (1)-fanart.jpg"} {
		if drive.entry("Movies/big buck bunny (2008)/"+p) == nil {
			t.Fatalf("missing %s in %v", p, drive.paths())
		}
	}
	if drive.entry("Movies/big buck bunny (2008)/bbb.mkv").content != "first version" {
		t.Fatal("the first version changed")
	}
}

// [spec: download-scraping/movie-folder-reused]
func TestUploadPlanUsesAFolderAnotherTaskCreatedFirst(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	drive.raceFolder = "Big Buck Bunny (2008)"
	uploader := NewUploader(drive, nil)

	if _, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Plan: ptr(moviePlan(t, t.TempDir(), "bbb.mkv"))}); err != nil {
		t.Fatal(err)
	}
	if drive.entry("Movies/Big Buck Bunny (2008) (1)") != nil || drive.entry("Movies/Big Buck Bunny (2008)/bbb.mkv") == nil {
		t.Fatalf("drive = %v", drive.paths())
	}
}

// [spec: download-scraping/existing-sidecars-win]
func TestUploadPlanKeepsExistingSidecars(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	drive.add("Movies", "Big Buck Bunny (2008)", true, "")
	poster := drive.add("Movies/Big Buck Bunny (2008)", "bbb-poster.jpg", false, "their poster")
	uploader := NewUploader(drive, nil)

	if _, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Plan: ptr(moviePlan(t, t.TempDir(), "bbb.mkv"))}); err != nil {
		t.Fatal(err)
	}
	if got := drive.entry("Movies/Big Buck Bunny (2008)/bbb-poster.jpg"); got.id != poster.id || got.content != "their poster" {
		t.Fatalf("poster = %+v", got)
	}
	if drive.entry("Movies/Big Buck Bunny (2008)/bbb-poster (1).jpg") != nil {
		t.Fatalf("a second poster was uploaded: %v", drive.paths())
	}
	if media := drive.media(t, drive.entry("Movies/Big Buck Bunny (2008)/bbb.mkv").id); media.Poster != poster.id {
		t.Fatalf("poster reference = %s, want %s", media.Poster, poster.id)
	}
}

// [spec: download-scraping/fallback]
func TestUploadPlanFallsBackWhenTheFolderNameIsAFile(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	drive.add("Movies", "Big Buck Bunny (2008)", false, "a file")
	uploader := NewUploader(drive, nil)
	download := writeTempFile(t, "video")
	plan := moviePlan(t, t.TempDir(), "bbb.mkv")

	if _, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Path: download, Name: "bbb.mkv", Size: 5, Plan: &plan}); err != nil {
		t.Fatal(err)
	}
	if drive.entry("Movies/bbb.mkv") == nil {
		t.Fatalf("drive = %v", drive.paths())
	}
	if notices := drive.scrapeNotices(); len(notices) != 1 || !strings.Contains(notices[0], "is a file") {
		t.Fatalf("notices = %v", notices)
	}
}

// [spec: download-scraping/fallback]
func TestPostProcessFallsBackAndRecordsTheReason(t *testing.T) {
	tmdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer tmdb.Close()
	drive := newFakeDrive(t)
	runner := NewTaskRunnerWithAPI(config.Config{StateDir: t.TempDir(), Scrape: config.ScrapeConfig{
		Enabled: true, TMDBToken: "bad", Language: "en-US", TMDBAPIURL: tmdb.URL,
	}}, drive)
	download := filepath.Join(t.TempDir(), "Big.Buck.Bunny.2008.mkv")
	if err := os.WriteFile(download, []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}
	result := Result{Path: download, Name: "Big.Buck.Bunny.2008.mkv", Size: 5}

	processed, cleanup := runner.postProcess(context.Background(), discardLogger(), planTask(), result)
	defer cleanup()
	if processed.Plan != nil || processed.Path != download {
		t.Fatalf("processed = %+v", processed)
	}
	if notices := drive.scrapeNotices(); len(notices) != 1 || notices[0] != mediascrape.ErrUnauthorized.Error() {
		t.Fatalf("notices = %v", notices)
	}
}

// [spec: download-scraping/fallback]
func TestPostProcessIsEmptyWithScrapingOff(t *testing.T) {
	drive := newFakeDrive(t)
	runner := NewTaskRunnerWithAPI(config.Config{StateDir: t.TempDir()}, drive)
	result := Result{Path: "/nowhere", Name: "x.mkv"}
	processed, cleanup := runner.postProcess(context.Background(), discardLogger(), planTask(), result)
	cleanup()
	if processed.Plan != nil || len(drive.scrapeNotices()) != 0 {
		t.Fatalf("processed = %+v, notices %v", processed, drive.scrapeNotices())
	}
}

func TestSourceMediaIDs(t *testing.T) {
	tmdbID, imdbID := sourceMediaIDs([]string{"movies", "TMDB:10378", "imdb:tt1254207", "imdb:bad", "tmdb:x"})
	if tmdbID != 10378 || imdbID != "tt1254207" {
		t.Fatalf("ids = %d, %q", tmdbID, imdbID)
	}
}

func TestUploadPlanDeletesWhatItCreatedOnFailure(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	plan := moviePlan(t, t.TempDir(), "bbb.mkv")
	plan.Files[1].Sidecar.Video = "missing.mkv"
	uploader := NewUploader(drive, nil)

	_, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Plan: &plan})
	if err == nil || errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if folder := drive.entry("Movies/Big Buck Bunny (2008)"); len(drive.deleted) != 1 || drive.deleted[0] != folder.id {
		t.Fatalf("deleted = %v", drive.deleted)
	}
}

func ptr[T any](value T) *T {
	return &value
}
