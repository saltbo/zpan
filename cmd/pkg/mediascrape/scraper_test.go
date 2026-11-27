package mediascrape

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeTMDB struct {
	t        *testing.T
	mu       sync.Mutex
	searches []string
	movies   map[int]map[string]any
	search   func(query, year, language string) []map[string]any
	// shows by id; seasons by "<show id>/<season>/<language>", falling back to "<show id>/<season>".
	shows      map[int]map[string]any
	seasons    map[string]map[string]any
	showSearch func(query, year, language string) []map[string]any
	requests   []string
	status     int
	limited    int
}

func newFakeTMDB(t *testing.T) *fakeTMDB {
	return &fakeTMDB{t: t, movies: map[int]map[string]any{
		10378: {
			"id": 10378, "title": "Big Buck Bunny", "original_title": "Big Buck Bunny",
			"overview": "A giant rabbit.", "release_date": "2008-05-30", "runtime": 10,
			"genres":      []map[string]any{{"name": "Animation"}, {"name": "Comedy"}},
			"poster_path": "/poster.jpg", "backdrop_path": "/backdrop.jpg",
			"images": map[string]any{
				"posters":   []map[string]any{{"file_path": "/poster-en.jpg", "iso_639_1": "en"}},
				"backdrops": []map[string]any{{"file_path": "/backdrop-textless.jpg", "iso_639_1": nil}},
			},
		},
		45745: {"id": 45745, "title": "Sintel", "original_title": "Sintel", "release_date": "2010-09-30"},
	}}
}

func (f *fakeTMDB) server() *httptest.Server {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.limited > 0 {
			f.limited--
			w.Header().Set("Retry-After", "2")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		if f.status != 0 {
			w.WriteHeader(f.status)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/t/p/") {
			_, _ = w.Write([]byte("image:" + r.URL.Path))
			return
		}
		if r.Header.Get("Authorization") != "Bearer token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		q := r.URL.Query()
		f.requests = append(f.requests, r.URL.Path+"?language="+q.Get("language"))
		switch {
		case r.URL.Path == "/3/search/tv":
			f.searches = append(f.searches, "tv:"+q.Get("query")+"|"+q.Get("first_air_date_year")+"|"+q.Get("language"))
			results := []map[string]any{}
			if f.showSearch != nil {
				results = f.showSearch(q.Get("query"), q.Get("first_air_date_year"), q.Get("language"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"results": results})
		case r.URL.Path == "/3/find/tt0903747":
			_ = json.NewEncoder(w).Encode(map[string]any{"tv_results": []map[string]any{{"id": 1396}}})
		case strings.HasPrefix(r.URL.Path, "/3/tv/"):
			parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/3/tv/"), "/")
			id, _ := strconv.Atoi(parts[0])
			var body map[string]any
			if len(parts) == 1 {
				body = f.shows[id]
			} else if len(parts) == 3 && parts[1] == "season" {
				body = f.seasons[parts[0]+"/"+parts[2]+"/"+q.Get("language")]
				if body == nil {
					body = f.seasons[parts[0]+"/"+parts[2]]
				}
			}
			if body == nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_ = json.NewEncoder(w).Encode(body)
		case r.URL.Path == "/3/search/movie":
			f.searches = append(f.searches, q.Get("query")+"|"+q.Get("year")+"|"+q.Get("language"))
			results := []map[string]any{}
			if f.search != nil {
				results = f.search(q.Get("query"), q.Get("year"), q.Get("language"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"results": results})
		case r.URL.Path == "/3/find/tt1254207":
			_ = json.NewEncoder(w).Encode(map[string]any{"movie_results": []map[string]any{{"id": 10378}}})
		case strings.HasPrefix(r.URL.Path, "/3/movie/"):
			var id int
			for _, candidate := range []int{10378, 45745} {
				if r.URL.Path == "/3/movie/"+strconv.Itoa(candidate) {
					id = candidate
				}
			}
			movie, ok := f.movies[id]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_ = json.NewEncoder(w).Encode(movie)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	f.t.Cleanup(server.Close)
	return server
}

func newTestScraper(f *fakeTMDB, language string) *Scraper {
	server := f.server()
	client := NewTMDB(TMDBConfig{AccessToken: "token", APIBaseURL: server.URL + "/3", ImageBaseURL: server.URL + "/t/p"}, server.Client())
	client.sleep = func(context.Context, time.Duration) error { return nil }
	return NewScraper(client, language)
}

func writeTree(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, content := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// snapshot lists every path under root with its content, to prove a scrape
// leaves the download as it found it.
func snapshot(t *testing.T, root string) []string {
	t.Helper()
	var entries []string
	err := filepath.WalkDir(root, func(p string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		data := ""
		if !entry.IsDir() {
			raw, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			data = string(raw)
		}
		entries = append(entries, p+"="+data)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(entries)
	return entries
}

func bunnySearch(query, year, language string) []map[string]any {
	if query != "Big Buck Bunny" {
		return nil
	}
	return []map[string]any{{"id": 10378, "title": "Big Buck Bunny", "original_title": "Big Buck Bunny", "release_date": "2008-05-30"}}
}

func planPaths(plan Plan) map[string]PlanFile {
	paths := map[string]PlanFile{}
	for _, file := range plan.Files {
		paths[file.Path] = file
	}
	return paths
}

// [spec: download-scraping/movie-layout] [spec: download-scraping/local-files-untouched]
func TestScrapeMovieFolder(t *testing.T) {
	f := newFakeTMDB(t)
	f.search = bunnySearch
	root := writeTree(t, map[string]string{
		"bbb/Big.Buck.Bunny.2008.1080p.mkv": "video",
		"bbb/Subs/en.srt":                   "subtitle",
		"bbb/.hidden":                       "skip",
	})
	download := filepath.Join(root, "bbb")
	before := snapshot(t, root)
	overlay := t.TempDir()

	plan, err := newTestScraper(f, "zh-CN").Scrape(context.Background(), Download{Path: download, IsDir: true, Name: "bbb"}, overlay)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Folder != "Big Buck Bunny (2008)" {
		t.Fatalf("folder = %q", plan.Folder)
	}
	paths := planPaths(plan)
	if len(paths) != 5 {
		t.Fatalf("plan = %+v", plan.Files)
	}
	if v := paths["Big.Buck.Bunny.2008.1080p.mkv"]; !v.Video || v.Sidecar != nil {
		t.Fatalf("video = %+v", v)
	}
	if s := paths["Subs/en.srt"]; s.Video || s.Sidecar != nil {
		t.Fatalf("subtitle = %+v", s)
	}
	for suffix, content := range map[string]string{
		SuffixPoster: "image:/t/p/w780/poster-en.jpg",
		SuffixFanart: "image:/t/p/w1280/backdrop-textless.jpg",
	} {
		file := paths["Big.Buck.Bunny.2008.1080p"+suffix]
		if file.Sidecar == nil || file.Sidecar.Video != "Big.Buck.Bunny.2008.1080p.mkv" || file.Sidecar.Suffix != suffix {
			t.Fatalf("%s sidecar = %+v", suffix, file)
		}
		if !strings.HasPrefix(file.LocalPath, overlay) {
			t.Fatalf("%s written outside the overlay: %s", suffix, file.LocalPath)
		}
		data, _ := os.ReadFile(file.LocalPath)
		if string(data) != content {
			t.Fatalf("%s = %q, want %q", suffix, data, content)
		}
	}
	nfo := paths["Big.Buck.Bunny.2008.1080p.nfo"]
	raw, _ := os.ReadFile(nfo.LocalPath)
	details, err := ReadMovieNFO(strings.NewReader(string(raw)))
	if err != nil || details.TMDBID != 10378 || details.Runtime != 10 || details.Overview != "A giant rabbit." {
		t.Fatalf("nfo = %+v, %v", details, err)
	}
	if got := snapshot(t, root); strings.Join(got, "\n") != strings.Join(before, "\n") {
		t.Fatalf("download changed:\n%v\nwas\n%v", got, before)
	}
	// zh-CN found nothing with the year, so English was not tried for that year.
	if strings.Join(f.searches, ",") != "Big Buck Bunny|2008|zh-CN" {
		t.Fatalf("searches = %v", f.searches)
	}
}

// [spec: download-scraping/match-rules]
func TestScrapeSearchOrder(t *testing.T) {
	f := newFakeTMDB(t)
	f.search = func(query, year, language string) []map[string]any {
		if language == "en-US" && year == "" {
			return bunnySearch(query, year, language)
		}
		// A result that does not match keeps the search going.
		return []map[string]any{{"id": 1, "title": "Something Else", "release_date": "2008-01-01"}}
	}
	file := filepath.Join(writeTree(t, map[string]string{"Big.Buck.Bunny.2008.mkv": "v"}), "Big.Buck.Bunny.2008.mkv")
	plan, err := newTestScraper(f, "zh-CN").Scrape(context.Background(), Download{Path: file, Name: "x"}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	want := "Big Buck Bunny|2008|zh-CN,Big Buck Bunny|2008|en-US,Big Buck Bunny||zh-CN,Big Buck Bunny||en-US"
	if strings.Join(f.searches, ",") != want || plan.Folder != "Big Buck Bunny (2008)" {
		t.Fatalf("searches = %v, folder %q", f.searches, plan.Folder)
	}
}

// [spec: download-scraping/match-rules]
func TestScrapeNFOBeforeSourceAndSearch(t *testing.T) {
	f := newFakeTMDB(t)
	f.search = func(string, string, string) []map[string]any {
		t.Error("searched although the download has an .nfo")
		return nil
	}
	root := writeTree(t, map[string]string{
		"d/film.mkv":  "v",
		"d/movie.nfo": `<movie><uniqueid type="tmdb">45745</uniqueid></movie>`,
	})
	plan, err := newTestScraper(f, "en-US").Scrape(context.Background(), Download{Path: filepath.Join(root, "d"), IsDir: true, Name: "d", TMDBID: 10378}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if plan.Folder != "Sintel (2010)" {
		t.Fatalf("folder = %q", plan.Folder)
	}
	// The download's own movie.nfo is not at a sidecar path of film.mkv, so
	// it uploads as an ordinary file and ours is written as film.nfo.
	paths := planPaths(plan)
	if paths["movie.nfo"].Sidecar != nil || paths["film.nfo"].Sidecar == nil {
		t.Fatalf("plan = %+v", plan.Files)
	}
}

// [spec: download-scraping/match-rules]
func TestScrapeSourceIDs(t *testing.T) {
	for _, download := range []Download{{TMDBID: 10378}, {IMDbID: "tt1254207"}} {
		f := newFakeTMDB(t)
		file := filepath.Join(writeTree(t, map[string]string{"clip.mov": "v"}), "clip.mov")
		download.Path, download.Name = file, "clip"
		plan, err := newTestScraper(f, "en-US").Scrape(context.Background(), download, t.TempDir())
		if err != nil || plan.Folder != "Big Buck Bunny (2008)" {
			t.Fatalf("%+v: plan %q, %v", download, plan.Folder, err)
		}
	}
}

// [spec: download-scraping/existing-sidecars-win]
func TestScrapeKeepsTheDownloadsOwnSidecar(t *testing.T) {
	f := newFakeTMDB(t)
	f.search = bunnySearch
	root := writeTree(t, map[string]string{
		"d/Big.Buck.Bunny.2008.mkv":        "v",
		"d/Big.Buck.Bunny.2008-poster.jpg": "their poster",
	})
	plan, err := newTestScraper(f, "en-US").Scrape(context.Background(), Download{Path: filepath.Join(root, "d"), IsDir: true, Name: "d"}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	poster := planPaths(plan)["Big.Buck.Bunny.2008-poster.jpg"]
	if poster.Sidecar == nil || poster.LocalPath != filepath.Join(root, "d", "Big.Buck.Bunny.2008-poster.jpg") {
		t.Fatalf("poster = %+v", poster)
	}
}

// [spec: download-scraping/fallback]
func TestScrapeSkips(t *testing.T) {
	cases := []struct {
		label  string
		files  map[string]string
		setup  func(*fakeTMDB)
		reason string
	}{
		{"no match", map[string]string{"d/Unknown.Film.1999.mkv": "v"}, nil, "no TMDB movie matches"},
		{"two movies", map[string]string{"d/Big.Buck.Bunny.2008.mkv": "v", "d/Sintel.2010.mkv": "v"}, func(f *fakeTMDB) {
			f.search = func(query, year, language string) []map[string]any {
				if query == "Sintel" {
					return []map[string]any{{"id": 45745, "title": "Sintel", "release_date": "2010-09-30"}}
				}
				return bunnySearch(query, year, language)
			}
		}, "more than one movie"},
		{"a rejected token", map[string]string{"d/Big.Buck.Bunny.2008.mkv": "v"}, func(f *fakeTMDB) { f.status = http.StatusUnauthorized }, "TMDB rejected the access token"},
		{"TMDB failing", map[string]string{"d/Big.Buck.Bunny.2008.mkv": "v"}, func(f *fakeTMDB) { f.status = http.StatusBadGateway }, "502"},
		{"repeated 429s", map[string]string{"d/Big.Buck.Bunny.2008.mkv": "v"}, func(f *fakeTMDB) { f.limited = 11 }, "rate limiting"},
		{"an unmatched show", map[string]string{"d/Show.S01E01.mkv": "v"}, nil, "no TMDB show matches"},
		{"a movie and an episode", map[string]string{"d/Big.Buck.Bunny.2008.mkv": "v", "d/Show.S01E01.mkv": "v"}, nil, "both a movie and TV episodes"},
	}
	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			f := newFakeTMDB(t)
			if tc.setup != nil {
				tc.setup(f)
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

func TestScrapeWaitsOutRateLimits(t *testing.T) {
	f := newFakeTMDB(t)
	f.search = bunnySearch
	f.limited = 10
	file := filepath.Join(writeTree(t, map[string]string{"Big.Buck.Bunny.2008.mkv": "v"}), "Big.Buck.Bunny.2008.mkv")
	if _, err := newTestScraper(f, "en-US").Scrape(context.Background(), Download{Path: file, Name: "x"}, t.TempDir()); err != nil {
		t.Fatalf("ten 429s in a row: %v", err)
	}
}

func TestScrapeNoVideo(t *testing.T) {
	root := writeTree(t, map[string]string{"d/readme.txt": "x", "d/sample.mkv": "s"})
	_, err := newTestScraper(newFakeTMDB(t), "en-US").Scrape(context.Background(), Download{Path: filepath.Join(root, "d"), IsDir: true, Name: "d"}, t.TempDir())
	if !errors.Is(err, ErrNoVideo) {
		t.Fatalf("err = %v", err)
	}
}

func TestRetryDelay(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	cases := map[string]time.Duration{
		"":                              10 * time.Second,
		"0":                             time.Second,
		"5":                             5 * time.Second,
		"9999":                          300 * time.Second,
		"Thu, 01 Jan 2026 00:00:30 GMT": 30 * time.Second,
		"soon":                          10 * time.Second,
	}
	for header, want := range cases {
		if got := retryDelay(header, now); got != want {
			t.Errorf("retryDelay(%q) = %s, want %s", header, got, want)
		}
	}
}

func TestFolderName(t *testing.T) {
	if got := FolderName(`Mission: Impossible / Fallout?`, 2018); got != "Mission Impossible Fallout (2018)" {
		t.Errorf("FolderName = %q", got)
	}
	if got := FolderName("Untitled", 0); got != "Untitled" {
		t.Errorf("FolderName without year = %q", got)
	}
}
