package mediascrape

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func withBreakingBad(f *fakeTMDB) *fakeTMDB {
	f.shows = map[int]map[string]any{
		1396: {
			"id": 1396, "name": "绝命毒师", "original_name": "Breaking Bad", "overview": "",
			"first_air_date": "2008-01-20", "genres": []map[string]any{{"name": "剧情"}},
			"poster_path": "/show-poster.jpg", "backdrop_path": "/show-backdrop.jpg",
			"images": map[string]any{
				"posters":   []map[string]any{{"file_path": "/show-poster-zh.jpg", "iso_639_1": "zh"}},
				"backdrops": []map[string]any{{"file_path": "/show-backdrop-textless.jpg", "iso_639_1": nil}},
			},
		},
		1399: {"id": 1399, "name": "Game of Thrones", "first_air_date": "2011-04-17"},
	}
	f.seasons = map[string]map[string]any{
		"1396/1/zh-CN": {
			"season_number": 1, "poster_path": "/s1.jpg",
			"episodes": []map[string]any{
				{"id": 62085, "season_number": 1, "episode_number": 1, "name": "试播集", "overview": "化学老师。", "air_date": "2008-01-20", "still_path": "/e1.jpg"},
				{"id": 62086, "season_number": 1, "episode_number": 2, "name": "第二集", "overview": "", "air_date": "2008-01-27", "still_path": "/e2.jpg"},
			},
		},
		"1396/1/en-US": {
			"season_number": 1,
			"episodes": []map[string]any{
				{"id": 62085, "season_number": 1, "episode_number": 1, "name": "Pilot", "overview": "A teacher."},
				{"id": 62086, "season_number": 1, "episode_number": 2, "name": "Cat's in the Bag...", "overview": "Walt and Jesse."},
			},
		},
		"1396/0": {
			"season_number": 0, "poster_path": "/s0.jpg",
			"episodes": []map[string]any{{"id": 1, "season_number": 0, "episode_number": 1, "name": "特别篇", "overview": "番外。"}},
		},
	}
	f.showSearch = func(query, year, language string) []map[string]any {
		if query != "Breaking Bad" {
			return nil
		}
		return []map[string]any{{"id": 1396, "name": "绝命毒师", "original_name": "Breaking Bad", "first_air_date": "2008-01-20"}}
	}
	return f
}

func readPlanFile(t *testing.T, file PlanFile) string {
	t.Helper()
	data, err := os.ReadFile(file.LocalPath)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func countRequests(f *fakeTMDB, prefix string) int {
	n := 0
	for _, request := range f.requests {
		if strings.HasPrefix(request, prefix) {
			n++
		}
	}
	return n
}

// [spec: download-scraping/show-layout] [spec: download-scraping/show-sidecars] [spec: download-scraping/local-files-untouched]
func TestScrapeSeasonPack(t *testing.T) {
	f := withBreakingBad(newFakeTMDB(t))
	root := writeTree(t, map[string]string{
		"Breaking.Bad.S01.1080p/Breaking.Bad.S01E01.1080p.mkv":       "e1",
		"Breaking.Bad.S01.1080p/Breaking.Bad.S01E02.1080p.mkv":       "e2",
		"Breaking.Bad.S01.1080p/Breaking.Bad.S00E01.Special.mkv":     "sp",
		"Breaking.Bad.S01.1080p/Subs/Breaking.Bad.S01E01.en.srt":     "sub",
		"Breaking.Bad.S01.1080p/Breaking.Bad.S01E01.1080p-thumb.jpg": "their thumb",
		"Breaking.Bad.S01.1080p/Extras/making-of.txt":                "notes",
	})
	before := snapshot(t, root)
	overlay := t.TempDir()

	plan, err := newTestScraper(f, "zh-CN").Scrape(context.Background(), Download{
		Path: filepath.Join(root, "Breaking.Bad.S01.1080p"), IsDir: true, Name: "Breaking.Bad.S01.1080p",
	}, overlay)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Folder != "绝命毒师 (2008)" {
		t.Fatalf("folder = %q", plan.Folder)
	}
	paths := planPaths(plan)
	for _, video := range []string{
		"Season 01/Breaking.Bad.S01E01.1080p.mkv",
		"Season 01/Breaking.Bad.S01E02.1080p.mkv",
		"Season 00/Breaking.Bad.S00E01.Special.mkv",
	} {
		if file, ok := paths[video]; !ok || !file.Video {
			t.Fatalf("video %s = %+v in %v", video, file, plan.Files)
		}
	}
	// The subtitles follow the season their name carries.
	if file, ok := paths["Season 01/Subs/Breaking.Bad.S01E01.en.srt"]; !ok || file.Video || file.Sidecar != nil {
		t.Fatalf("subtitle missing from %v", plan.Files)
	}
	// A file named for no episode follows its folder's lowest regular season.
	if _, ok := paths["Season 01/Extras/making-of.txt"]; !ok {
		t.Fatalf("extra missing from %v", plan.Files)
	}
	for name, want := range map[string]string{
		ShowPosterName:      "image:/t/p/w780/show-poster-zh.jpg",
		ShowFanartName:      "image:/t/p/w1280/show-backdrop-textless.jpg",
		SeasonPosterName(1): "image:/t/p/w780/s1.jpg",
		SeasonPosterName(0): "image:/t/p/w780/s0.jpg",
		"Season 01/Breaking.Bad.S01E02.1080p-thumb.jpg": "image:/t/p/w300/e2.jpg",
	} {
		file, ok := paths[name]
		if !ok || !strings.HasPrefix(file.LocalPath, overlay) || readPlanFile(t, file) != want {
			t.Fatalf("%s = %+v", name, file)
		}
		if strings.HasPrefix(name, "Season") != (file.Sidecar != nil) || strings.HasPrefix(name, "Season") == file.Keep {
			t.Fatalf("%s marks = %+v", name, file)
		}
	}
	// The download's own thumb is uploaded in place of one from TMDB.
	if thumb := paths["Season 01/Breaking.Bad.S01E01.1080p-thumb.jpg"]; thumb.Sidecar == nil || readPlanFile(t, thumb) != "their thumb" {
		t.Fatalf("own thumb = %+v", thumb)
	}

	show, err := ReadTVShowNFO(strings.NewReader(readPlanFile(t, paths[TVShowNFOName])))
	if err != nil || show.TMDBID != 1396 || show.Title != "绝命毒师" || show.OriginalTitle != "Breaking Bad" || show.Year != 2008 {
		t.Fatalf("tvshow.nfo = %+v, %v", show, err)
	}
	if !paths[TVShowNFOName].Keep {
		t.Fatal("tvshow.nfo is not kept-existing")
	}
	episode, err := ReadEpisodeNFO(strings.NewReader(readPlanFile(t, paths["Season 01/Breaking.Bad.S01E02.1080p.nfo"])))
	if err != nil || episode.TMDBID != 62086 || episode.Season != 1 || episode.Episode != 2 || episode.Title != "第二集" ||
		episode.Overview != "Walt and Jesse." || episode.Aired != "2008-01-27" {
		t.Fatalf("episode nfo = %+v, %v", episode, err)
	}
	if nfo := paths["Season 01/Breaking.Bad.S01E02.1080p.nfo"]; nfo.Sidecar == nil || nfo.Sidecar.Video != "Season 01/Breaking.Bad.S01E02.1080p.mkv" {
		t.Fatalf("episode nfo link = %+v", nfo.Sidecar)
	}

	// One search for the three episodes, one show fetch plus its English plot,
	// one fetch per season plus English for season 1's empty plot.
	if len(f.searches) != 1 || countRequests(f, "/3/tv/1396?language=zh-CN") != 1 || countRequests(f, "/3/tv/1396?language=en-US") != 1 ||
		countRequests(f, "/3/tv/1396/season/1?language=zh-CN") != 1 || countRequests(f, "/3/tv/1396/season/1?language=en-US") != 1 ||
		countRequests(f, "/3/tv/1396/season/0?") != 1 {
		t.Fatalf("searches %v, requests %v", f.searches, f.requests)
	}
	if got := snapshot(t, root); strings.Join(got, "\n") != strings.Join(before, "\n") {
		t.Fatalf("download changed:\n%v\nwas\n%v", got, before)
	}
}

// [spec: download-scraping/show-layout]
func TestScrapeSingleEpisodeFile(t *testing.T) {
	f := withBreakingBad(newFakeTMDB(t))
	file := filepath.Join(writeTree(t, map[string]string{"Breaking.Bad.S01E02.720p.mkv": "v"}), "Breaking.Bad.S01E02.720p.mkv")
	plan, err := newTestScraper(f, "en-US").Scrape(context.Background(), Download{Path: file, Name: "Breaking.Bad.S01E02.720p.mkv"}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	paths := planPaths(plan)
	if _, ok := paths["Season 01/Breaking.Bad.S01E02.720p.mkv"]; !ok || plan.Folder != "绝命毒师 (2008)" {
		t.Fatalf("plan %q = %v", plan.Folder, plan.Files)
	}
	if _, ok := paths[SeasonPosterName(0)]; ok {
		t.Fatalf("a season the download does not hold got a poster: %v", plan.Files)
	}
}

// [spec: download-scraping/match-rules]
func TestScrapeBareEpisodeTakesTheShowFolder(t *testing.T) {
	f := withBreakingBad(newFakeTMDB(t))
	root := writeTree(t, map[string]string{"Breaking Bad (2008)/Season 1/S01E01.mkv": "v", "Breaking Bad (2008)/Season 1/1x02.mkv": "v"})
	plan, err := newTestScraper(f, "en-US").Scrape(context.Background(), Download{Path: filepath.Join(root, "Breaking Bad (2008)"), IsDir: true, Name: "x"}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(f.searches, ",") != "tv:Breaking Bad|2008|en-US" {
		t.Fatalf("searches = %v", f.searches)
	}
	paths := planPaths(plan)
	if _, ok := paths["Season 01/1x02.mkv"]; !ok {
		t.Fatalf("plan = %v", plan.Files)
	}
}

// [spec: download-scraping/match-rules]
func TestScrapeShowNFOBeforeSourceAndSearch(t *testing.T) {
	f := withBreakingBad(newFakeTMDB(t))
	f.showSearch = func(string, string, string) []map[string]any {
		t.Error("searched although the download has a tvshow.nfo")
		return nil
	}
	root := writeTree(t, map[string]string{
		"d/tvshow.nfo":               `<tvshow><uniqueid type="tmdb">1396</uniqueid></tvshow>`,
		"d/Season 1/Show.S01E01.mkv": "v",
	})
	plan, err := newTestScraper(f, "en-US").Scrape(context.Background(), Download{Path: filepath.Join(root, "d"), IsDir: true, Name: "d", TMDBID: 1399}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// The download's own tvshow.nfo lands at the show folder's tvshow.nfo, so
	// it is uploaded and ours is not written.
	nfo := planPaths(plan)[TVShowNFOName]
	if plan.Folder != "绝命毒师 (2008)" || !nfo.Keep || nfo.LocalPath != filepath.Join(root, "d", "tvshow.nfo") {
		t.Fatalf("plan %q, tvshow.nfo %+v", plan.Folder, nfo)
	}
}

// [spec: download-scraping/match-rules]
func TestScrapeShowSourceIDs(t *testing.T) {
	for _, download := range []Download{{TMDBID: 1396}, {IMDbID: "tt0903747"}} {
		f := withBreakingBad(newFakeTMDB(t))
		f.showSearch = nil
		file := filepath.Join(writeTree(t, map[string]string{"Unknown.S01E01.mkv": "v"}), "Unknown.S01E01.mkv")
		download.Path, download.Name = file, "x"
		plan, err := newTestScraper(f, "en-US").Scrape(context.Background(), download, t.TempDir())
		if err != nil || plan.Folder != "绝命毒师 (2008)" {
			t.Fatalf("%+v: plan %q, %v", download, plan.Folder, err)
		}
	}
}

// [spec: download-scraping/show-metadata] [spec: download-scraping/fallback]
func TestScrapeShowSkips(t *testing.T) {
	cases := []struct {
		label  string
		files  map[string]string
		reason string
	}{
		{"two shows", map[string]string{"d/Breaking.Bad.S01E01.mkv": "v", "d/Game.of.Thrones.S01E01.mkv": "v"}, "more than one show"},
		{"an unmatched show", map[string]string{"d/Unknown.Show.S01E01.mkv": "v"}, "no TMDB show matches"},
		{"two episodes at one path", map[string]string{"d/a/Breaking.Bad.S01E01.mkv": "v", "d/b/Breaking.Bad.S01E01.mkv": "v"}, "both be uploaded"},
	}
	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			f := withBreakingBad(newFakeTMDB(t))
			search := f.showSearch
			f.showSearch = func(query, year, language string) []map[string]any {
				if query == "Game of Thrones" {
					return []map[string]any{{"id": 1399, "name": "Game of Thrones", "first_air_date": "2011-04-17"}}
				}
				return search(query, year, language)
			}
			root := writeTree(t, tc.files)
			_, err := newTestScraper(f, "en-US").Scrape(context.Background(), Download{Path: filepath.Join(root, "d"), IsDir: true, Name: "d"}, t.TempDir())
			var skipped *SkipError
			if !errors.As(err, &skipped) || !strings.Contains(skipped.Reason, tc.reason) {
				t.Fatalf("err = %v, want a skip containing %q", err, tc.reason)
			}
		})
	}
}

func TestShowNFORoundTrip(t *testing.T) {
	nfo := TVShowNFO(Show{ID: 1396, Title: "A & B", OriginalTitle: "AB", Overview: "x", Date: "2008-01-20", Genres: []string{"Drama", " "}})
	details, err := ReadTVShowNFO(strings.NewReader(nfo))
	if err != nil || details.Title != "A & B" || details.Year != 2008 || len(details.Genres) != 1 {
		t.Fatalf("details = %+v, %v", details, err)
	}
	if identity := ReadNFOIdentity(nfo); identity.Kind != NFOTVShow || identity.TMDBID != 1396 {
		t.Fatalf("identity = %+v", identity)
	}
	if _, err := ReadTVShowNFO(strings.NewReader("<tvshow><title>x</title></tvshow>")); err == nil {
		t.Fatal("a tvshow.nfo without an id was read")
	}
	special := EpisodeNFO(Episode{Season: 0, Number: 3, Aired: "bad"})
	episode, err := ReadEpisodeNFO(strings.NewReader(special))
	if err != nil || episode.Season != 0 || episode.Episode != 3 || episode.Aired != "" {
		t.Fatalf("episode = %+v, %v", episode, err)
	}
	if _, err := ReadEpisodeNFO(strings.NewReader("<episodedetails><title>x</title></episodedetails>")); err == nil {
		t.Fatal("an episode .nfo without numbers was read")
	}
}
