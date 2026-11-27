package downloader

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/saltbo/zpan/pkg/mediascrape"
)

// showPlan is the plan mediascrape returns for one Breaking Bad episode,
// written to dir.
func showPlan(t *testing.T, dir string, video string) UploadPlan {
	t.Helper()
	write := func(name, content string) string {
		p := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	videoPath := "Season 01/" + video
	stem := strings.TrimSuffix(videoPath, filepath.Ext(videoPath))
	showNFO := mediascrape.TVShowNFO(mediascrape.Show{ID: 1396, Title: "Breaking Bad", Date: "2008-01-20", Overview: "A teacher.", Genres: []string{"Drama"}})
	episodeNFO := mediascrape.EpisodeNFO(mediascrape.Episode{ID: 62086, Season: 1, Number: 2, Title: "Cat's in the Bag...", Overview: "Walt.", Aired: "2008-01-27"})
	file := func(name, content string) PlannedFile {
		return PlannedFile{LocalPath: write(name, content), Path: name, Size: int64(len(content))}
	}
	sidecar := func(suffix, content string) PlannedFile {
		f := file(stem+suffix, content)
		f.Sidecar = &PlannedSidecar{Video: videoPath, Suffix: suffix}
		return f
	}
	kept := func(name, content string) PlannedFile {
		f := file(name, content)
		f.Keep = true
		return f
	}
	videoFile := file(videoPath, "video")
	videoFile.Video = true
	return UploadPlan{Folder: "Breaking Bad (2008)", Files: []PlannedFile{
		videoFile,
		sidecar(mediascrape.SuffixNFO, episodeNFO),
		sidecar(mediascrape.SuffixThumb, "still"),
		kept(mediascrape.TVShowNFOName, showNFO),
		kept(mediascrape.ShowPosterName, "poster"),
		kept(mediascrape.ShowFanartName, "fanart"),
		kept(mediascrape.SeasonPosterName(1), "season poster"),
	}}
}

// [spec: download-scraping/show-layout] [spec: download-scraping/show-sidecars] [spec: download-scraping/show-metadata]
func TestUploadPlanCreatesTheShowLayout(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	uploader := NewUploader(drive, nil)

	id, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Plan: ptr(showPlan(t, t.TempDir(), "Breaking.Bad.S01E02.mkv"))})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"Movies",
		"Movies/Breaking Bad (2008)",
		"Movies/Breaking Bad (2008)/Season 01",
		"Movies/Breaking Bad (2008)/Season 01/Breaking.Bad.S01E02-thumb.jpg",
		"Movies/Breaking Bad (2008)/Season 01/Breaking.Bad.S01E02.mkv",
		"Movies/Breaking Bad (2008)/Season 01/Breaking.Bad.S01E02.nfo",
		"Movies/Breaking Bad (2008)/fanart.jpg",
		"Movies/Breaking Bad (2008)/poster.jpg",
		"Movies/Breaking Bad (2008)/season01-poster.jpg",
		"Movies/Breaking Bad (2008)/tvshow.nfo",
	}
	if got := drive.paths(); strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("drive =\n%s", strings.Join(got, "\n"))
	}
	folder := drive.entry("Movies/Breaking Bad (2008)")
	if folder.id != id {
		t.Fatalf("result object = %s, want the show folder %s", id, folder.id)
	}
	var episode episodeMedia
	drive.decodeMedia(t, drive.entry("Movies/Breaking Bad (2008)/Season 01/Breaking.Bad.S01E02.mkv").id, &episode)
	if episode.Kind != "episode" || episode.TMDB != (tmdbReference{ID: 1396, Type: "tv"}) || episode.Season != 1 || episode.Episode != 2 ||
		episode.Title != "Cat's in the Bag..." || episode.Overview != "Walt." || episode.Aired != "2008-01-27" ||
		episode.Still != drive.entry("Movies/Breaking Bad (2008)/Season 01/Breaking.Bad.S01E02-thumb.jpg").id {
		t.Fatalf("episode media = %+v", episode)
	}
	var show tvShowMedia
	drive.decodeMedia(t, folder.id, &show)
	if show.Kind != "tvshow" || show.TMDB != (tmdbReference{ID: 1396, Type: "tv"}) || show.Title != "Breaking Bad" || show.Year != 2008 ||
		show.Overview != "A teacher." || show.Poster != drive.entry("Movies/Breaking Bad (2008)/poster.jpg").id ||
		show.Fanart != drive.entry("Movies/Breaking Bad (2008)/fanart.jpg").id {
		t.Fatalf("show media = %+v", show)
	}
	if notices := drive.scrapeNotices(); len(notices) != 0 {
		t.Fatalf("notices = %v", notices)
	}
}

// [spec: download-scraping/show-folder-reused] [spec: download-scraping/show-sidecars] [spec: download-scraping/show-metadata]
func TestUploadPlanJoinsTheExistingShowAndSeason(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	folder := drive.add("Movies", "breaking bad (2008)", true, "")
	drive.add("Movies/breaking bad (2008)", "season 01", true, "")
	drive.add("Movies/breaking bad (2008)/season 01", "Breaking.Bad.S01E01.mkv", false, "episode 1")
	showNFO := drive.add("Movies/breaking bad (2008)", "tvshow.nfo", false, "their show")
	drive.hasMedia = map[string]bool{folder.id: true}
	uploader := NewUploader(drive, nil)

	id, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Plan: ptr(showPlan(t, t.TempDir(), "Breaking.Bad.S01E02.mkv"))})
	if err != nil {
		t.Fatal(err)
	}
	if id != folder.id {
		t.Fatalf("result object = %s, want the reused show folder %s", id, folder.id)
	}
	for _, p := range drive.paths() {
		if strings.Contains(p, "(1)") {
			t.Fatalf("a renamed copy was made: %v", drive.paths())
		}
	}
	if drive.entry("Movies/breaking bad (2008)/season 01/Breaking.Bad.S01E02.mkv") == nil {
		t.Fatalf("drive = %v", drive.paths())
	}
	if got := drive.entry("Movies/breaking bad (2008)/tvshow.nfo"); got.id != showNFO.id || got.content != "their show" {
		t.Fatalf("tvshow.nfo = %+v", got)
	}
	if _, written := drive.metadata[folder.id]; written {
		t.Fatal("the show folder's existing media was overwritten")
	}
	// The episode still names its series from the plan's tvshow.nfo.
	var episode episodeMedia
	drive.decodeMedia(t, drive.entry("Movies/breaking bad (2008)/season 01/Breaking.Bad.S01E02.mkv").id, &episode)
	if episode.TMDB.ID != 1396 || episode.Episode != 2 {
		t.Fatalf("episode media = %+v", episode)
	}
	if notices := drive.scrapeNotices(); len(notices) != 0 {
		t.Fatalf("notices = %v", notices)
	}
}

// [spec: download-scraping/show-folder-reused]
func TestUploadPlanUsesASeasonFolderAnotherTaskCreatedFirst(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	drive.add("Movies", "Breaking Bad (2008)", true, "")
	drive.raceFolder = "Season 01"
	uploader := NewUploader(drive, nil)

	if _, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Plan: ptr(showPlan(t, t.TempDir(), "e.mkv"))}); err != nil {
		t.Fatal(err)
	}
	if drive.entry("Movies/Breaking Bad (2008)/Season 01 (1)") != nil || drive.entry("Movies/Breaking Bad (2008)/Season 01/e.mkv") == nil {
		t.Fatalf("drive = %v", drive.paths())
	}
}

// [spec: download-scraping/show-folder-reused] [spec: download-scraping/fallback]
func TestUploadPlanFallsBackWhenTheSeasonNameIsAFile(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	drive.add("Movies", "Breaking Bad (2008)", true, "")
	drive.add("Movies/Breaking Bad (2008)", "Season 01", false, "a file")
	uploader := NewUploader(drive, nil)
	download := writeTempFile(t, "video")

	plan := showPlan(t, t.TempDir(), "e.mkv")
	if _, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Path: download, Name: "e.mkv", Size: 5, Plan: &plan}); err != nil {
		t.Fatal(err)
	}
	if drive.entry("Movies/e.mkv") == nil {
		t.Fatalf("drive = %v", drive.paths())
	}
	if drive.entry("Movies/Breaking Bad (2008)/tvshow.nfo") != nil || len(drive.deleted) != 0 {
		t.Fatalf("plan files went up before the season folder was settled: %v, deleted %v", drive.paths(), drive.deleted)
	}
	if notices := drive.scrapeNotices(); len(notices) != 1 || !strings.Contains(notices[0], "is a file") {
		t.Fatalf("notices = %v", notices)
	}
}

// [spec: download-scraping/show-folder-reused] [spec: download-scraping/show-sidecars]
func TestUploadPlanKeepsAShowFileAnotherTaskUploadedAtOnce(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	drive.add("Movies", "Breaking Bad (2008)", true, "")
	drive.raceComplete = mediascrape.SeasonPosterName(1)
	uploader := NewUploader(drive, nil)

	if _, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Plan: ptr(showPlan(t, t.TempDir(), "e.mkv"))}); err != nil {
		t.Fatal(err)
	}
	if got := drive.entry("Movies/Breaking Bad (2008)/season01-poster.jpg"); got == nil || got.content != "another task" {
		t.Fatalf("season poster = %+v", got)
	}
	if drive.entry("Movies/Breaking Bad (2008)/Season 01/e.mkv") == nil || len(drive.deleted) != 0 {
		t.Fatalf("drive = %v, deleted %v", drive.paths(), drive.deleted)
	}
}

func TestUploadPlanReportsAnEpisodeWithoutASeries(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	plan := showPlan(t, t.TempDir(), "e.mkv")
	plan.Files = append(plan.Files[:3], plan.Files[4:]...) // no tvshow.nfo
	uploader := NewUploader(drive, nil)

	if _, err := uploader.Upload(context.Background(), discardLogger(), planTask(), Result{Plan: &plan}); err != nil {
		t.Fatal(err)
	}
	if notices := drive.scrapeNotices(); len(notices) != 1 || !strings.Contains(notices[0], "no tvshow.nfo") {
		t.Fatalf("notices = %v", notices)
	}
}
