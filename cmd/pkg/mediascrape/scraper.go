package mediascrape

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/saltbo/zpan/pkg/system"
)

// Sidecar suffixes a video `X.mkv` gets next to it: a movie gets the .nfo,
// poster and fanart, an episode the .nfo and thumb.
const (
	SuffixNFO    = ".nfo"
	SuffixPoster = "-poster.jpg"
	SuffixFanart = "-fanart.jpg"
	SuffixThumb  = "-thumb.jpg"
	movieNFOName = "movie.nfo"
	posterSize   = "w780"
	fanartSize   = "w1280"
	stillSize    = "w300"
)

// The files a show folder gets, besides a `seasonNN-poster.jpg` per season.
const (
	TVShowNFOName  = "tvshow.nfo"
	ShowPosterName = "poster.jpg"
	ShowFanartName = "fanart.jpg"
)

// SeasonPosterName is a season's poster in the show folder, `season01-poster.jpg`.
func SeasonPosterName(season int) string {
	return fmt.Sprintf("season%02d-poster.jpg", season)
}

// SeasonFolderName is a season's folder in the show folder, `Season 01`, and
// `Season 00` for specials.
func SeasonFolderName(season int) string {
	return fmt.Sprintf("Season %02d", season)
}

var videoExtensions = map[string]bool{
	".mkv": true, ".mp4": true, ".m4v": true, ".mov": true, ".avi": true, ".wmv": true, ".flv": true,
	".webm": true, ".ts": true, ".m2ts": true, ".mts": true, ".mpg": true, ".mpeg": true, ".ogv": true,
	".rmvb": true,
}

var (
	sampleName      = regexp.MustCompile(`(?i)(?:^|[.\-_ ])sample$`)
	unsafeNameChars = regexp.MustCompile(`[/\\:*?"<>|]`)
	collapsedSpaces = regexp.MustCompile(`\s+`)
)

// Download is a finished download as the scraper sees it.
type Download struct {
	// Path is the local file, or the folder a multi-file download sits in.
	Path  string
	IsDir bool
	// Name is the release name: the torrent's or the requested name.
	Name string
	// A TMDB or IMDb id the source carries, when it carries one.
	TMDBID int
	IMDbID string
	// Keeps are local files listed whatever their names: a torrent's files.
	Keeps system.Keeps
}

// Plan is where a scraped download goes: every file of the download plus the
// sidecars the scraper wrote, laid out under one folder in the task's target
// folder.
type Plan struct {
	// Folder is the movie's `Title (Year)` or the show's `Show (Year)` folder name.
	Folder string
	Files  []PlanFile
}

// PlanFile is one file to upload. Path is slash-separated, relative to the
// plan's folder.
type PlanFile struct {
	LocalPath string
	Path      string
	Size      int64
	Video     bool
	// Sidecar is set for a file at a sidecar path of a video: its name follows
	// the name the video is given, and an entry already there wins.
	Sidecar *Sidecar
	// Keep is set for a show folder file such as tvshow.nfo or poster.jpg: it
	// keeps its name, and an entry already there wins.
	Keep bool
}

// Sidecar ties a file to a video: it is named after the video's base name
// plus Suffix.
type Sidecar struct {
	Video  string
	Suffix string
}

// SkipError means the download is uploaded unscraped. The reason is shown in
// the task activity.
type SkipError struct {
	Reason string
}

func (e *SkipError) Error() string {
	return e.Reason
}

func skip(format string, args ...any) error {
	return &SkipError{Reason: fmt.Sprintf(format, args...)}
}

// ErrNoVideo means the download holds no video, so scraping leaves it alone.
var ErrNoVideo = errors.New("the download holds no video")

// Scraper matches downloads to TMDB movies and TV shows.
type Scraper struct {
	tmdb     *TMDB
	language string
}

func NewScraper(tmdb *TMDB, language string) *Scraper {
	return &Scraper{tmdb: tmdb, language: nonEmpty(language, DefaultLanguage)}
}

type localFile struct {
	path string
	rel  string
	size int64
}

type video struct {
	file localFile
	info Info
}

// Scrape matches a download to one TMDB movie, or its episodes to one TMDB
// show, writes the sidecars under overlayDir, and returns the upload plan. It never touches the downloaded
// files, which may still be seeding. It returns ErrNoVideo for a download
// without a video, and a *SkipError when the download cannot be scraped.
func (s *Scraper) Scrape(ctx context.Context, download Download, overlayDir string) (Plan, error) {
	files, err := listFiles(download)
	if err != nil {
		return Plan{}, err
	}
	videos := s.parseVideos(download, files)
	if len(videos) == 0 {
		return Plan{}, ErrNoVideo
	}
	byPath := map[string]localFile{}
	for _, file := range files {
		byPath[strings.ToLower(file.rel)] = file
	}
	if episodes := episodesOf(videos); len(episodes) > 0 {
		if len(episodes) != len(videos) && hasMovie(videos) {
			return Plan{}, skip("the download holds both a movie and TV episodes")
		}
		return s.scrapeShow(ctx, download, files, episodes, byPath, overlayDir)
	}
	return s.scrapeMovie(ctx, download, files, videos, byPath, overlayDir)
}

func (s *Scraper) scrapeMovie(
	ctx context.Context,
	download Download,
	files []localFile,
	videos []video,
	byPath map[string]localFile,
	overlayDir string,
) (Plan, error) {
	id := 0
	for _, v := range videos {
		matched, err := s.matchMovie(ctx, download, v, byPath)
		if err != nil {
			return Plan{}, err
		}
		if matched == 0 {
			return Plan{}, skip("no TMDB movie matches %q", v.file.rel)
		}
		if id != 0 && matched != id {
			return Plan{}, skip("the download holds more than one movie")
		}
		id = matched
	}

	movie, found, err := s.tmdb.Movie(ctx, id, s.language, true)
	if err != nil {
		return Plan{}, tmdbFailure(err)
	}
	if !found {
		return Plan{}, skip("TMDB has no movie %d", id)
	}
	if movie.Overview == "" && s.language != fallbackLanguage {
		english, found, err := s.tmdb.Movie(ctx, id, fallbackLanguage, false)
		if err != nil {
			return Plan{}, tmdbFailure(err)
		}
		if found {
			movie.Overview = english.Overview
		}
	}
	folder := FolderName(movie.Title, movie.Year())
	if folder == "" {
		return Plan{}, skip("TMDB movie %d has no title", id)
	}
	return s.plan(ctx, files, videos, movie, folder, overlayDir)
}

func tmdbFailure(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return &SkipError{Reason: err.Error()}
}

// FolderName is a movie's `Title (Year)` folder: the title with the characters
// a file name cannot hold replaced by a space, and no year when TMDB has none.
func FolderName(title string, year int) string {
	name := strings.TrimSpace(collapsedSpaces.ReplaceAllString(unsafeNameChars.ReplaceAllString(title, " "), " "))
	if name == "" || year == 0 {
		return name
	}
	return name + " (" + strconv.Itoa(year) + ")"
}

func listFiles(download Download) ([]localFile, error) {
	if !download.IsDir {
		info, err := os.Stat(download.Path)
		if err != nil {
			return nil, err
		}
		return []localFile{{path: download.Path, rel: filepath.Base(download.Path), size: info.Size()}}, nil
	}
	var files []localFile
	err := filepath.WalkDir(download.Path, func(p string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == download.Path {
			return nil
		}
		if entry.IsDir() {
			if !download.Keeps.Dir(p) {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(download.Path, p)
		if err != nil {
			return err
		}
		if !download.Keeps.File(p, rel) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		files = append(files, localFile{path: p, rel: filepath.ToSlash(rel), size: info.Size()})
		return nil
	})
	sort.Slice(files, func(i, j int) bool { return files[i].rel < files[j].rel })
	return files, err
}

// parseVideos parses each video of the download, taking the download's root
// folder as the outermost folder. A video whose own name parses as unknown
// takes the release name instead. Samples are not videos.
func (s *Scraper) parseVideos(download Download, files []localFile) []video {
	var videos []video
	for _, file := range files {
		if !isVideo(file.rel) {
			continue
		}
		var folders []string
		if download.IsDir {
			folders = append(folders, filepath.Base(download.Path))
			if dir := path.Dir(file.rel); dir != "." {
				folders = append(folders, strings.Split(dir, "/")...)
			}
		}
		info := ParsePath(folders, path.Base(file.rel))
		if info.Kind == KindUnknown {
			if release := ParseFilename(download.Name); release.Kind != KindUnknown {
				info = release
			}
		}
		videos = append(videos, video{file: file, info: info})
	}
	return videos
}

func isVideo(rel string) bool {
	if !videoExtensions[strings.ToLower(path.Ext(rel))] {
		return false
	}
	if sampleName.MatchString(baseName(path.Base(rel))) {
		return false
	}
	for _, folder := range strings.Split(path.Dir(rel), "/") {
		if strings.EqualFold(folder, "sample") || strings.EqualFold(folder, "samples") {
			return false
		}
	}
	return true
}

// matchMovie settles a video's TMDB movie id: an .nfo in the download, then
// an id the source carries, then a search. A video neither name classifies is
// matched only through an .nfo. It returns 0 for no match.
func (s *Scraper) matchMovie(ctx context.Context, download Download, v video, files map[string]localFile) (int, error) {
	dir := path.Dir(v.file.rel)
	for _, name := range []string{baseName(path.Base(v.file.rel)) + SuffixNFO, movieNFOName} {
		candidate := name
		if dir != "." {
			candidate = dir + "/" + name
		}
		file, ok := files[strings.ToLower(candidate)]
		if !ok {
			continue
		}
		identity, err := readIdentity(file.path)
		if err != nil {
			return 0, err
		}
		if identity.TMDBID != 0 && (identity.Kind == "" || identity.Kind == NFOMovie) {
			return identity.TMDBID, nil
		}
	}
	if download.TMDBID != 0 {
		return download.TMDBID, nil
	}
	if download.IMDbID != "" {
		id, err := s.tmdb.FindMovieByIMDb(ctx, download.IMDbID)
		if err != nil {
			return 0, tmdbFailure(err)
		}
		if id != 0 {
			return id, nil
		}
	}
	if v.info.Kind != KindMovie {
		return 0, nil
	}
	return s.search(ctx, v.info, s.tmdb.SearchMovies)
}

func readIdentity(file string) (NFOIdentity, error) {
	f, err := os.Open(file)
	if err != nil {
		return NFOIdentity{}, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxNFOBytes))
	if err != nil {
		return NFOIdentity{}, err
	}
	return ReadNFOIdentity(string(data)), nil
}

type searchFunc func(ctx context.Context, title string, year int, language string) ([]SearchHit, error)

// search looks the parsed title up in the configured language and in
// English, with the parsed year and then without it, until a result matches.
// A search with no results at all ends that year: another language finds the
// same nothing.
func (s *Scraper) search(ctx context.Context, info Info, find searchFunc) (int, error) {
	if NormalizeTitle(info.Title) == "" {
		return 0, nil
	}
	languages := []string{s.language}
	if s.language != fallbackLanguage {
		languages = append(languages, fallbackLanguage)
	}
	years := []int{0}
	if info.Year != 0 {
		years = []int{info.Year, 0}
	}
	for _, year := range years {
		for _, language := range languages {
			hits, err := find(ctx, info.Title, year, language)
			if err != nil {
				return 0, tmdbFailure(err)
			}
			if best, ok := ChooseMatch(info.Title, info.Year, hits); ok {
				return best.ID, nil
			}
			if len(hits) == 0 {
				break
			}
		}
	}
	return 0, nil
}

// plan lays the download out under the movie folder: videos and the files
// next to them keep their paths relative to the videos' folder, and each video
// gets the sidecars the download does not already hold.
func (s *Scraper) plan(
	ctx context.Context,
	files []localFile,
	videos []video,
	movie Movie,
	folder string,
	overlayDir string,
) (Plan, error) {
	base := commonDir(videos)
	planPath := func(rel string) string {
		if base == "" {
			return rel
		}
		if strings.HasPrefix(rel, base+"/") {
			return strings.TrimPrefix(rel, base+"/")
		}
		return rel
	}
	isVideoFile := map[string]bool{}
	for _, v := range videos {
		isVideoFile[v.file.rel] = true
	}
	plan := Plan{Folder: folder}
	taken := map[string]int{}
	for _, file := range files {
		p := planPath(file.rel)
		taken[strings.ToLower(p)] = len(plan.Files)
		plan.Files = append(plan.Files, PlanFile{LocalPath: file.path, Path: p, Size: file.size, Video: isVideoFile[file.rel]})
	}

	artwork := map[string][]byte{}
	fetch := func(suffix, imagePath, size string) ([]byte, error) {
		if imagePath == "" {
			return nil, nil
		}
		if data, ok := artwork[suffix]; ok {
			return data, nil
		}
		data, found, err := s.tmdb.Image(ctx, imagePath, size)
		if err != nil {
			return nil, tmdbFailure(err)
		}
		if !found {
			data = nil
		}
		artwork[suffix] = data
		return data, nil
	}
	posterPath := nonEmpty(chooseImage(movie.Posters, posterPreference(s.language)), movie.PosterPath)
	fanartPath := nonEmpty(chooseImage(movie.Backdrops, fanartPreference(s.language)), movie.BackdropPath)
	nfo := []byte(MovieNFO(movie))

	for _, v := range videos {
		videoPath := planPath(v.file.rel)
		for _, sidecar := range []struct {
			suffix string
			data   func() ([]byte, error)
		}{
			{SuffixNFO, func() ([]byte, error) { return nfo, nil }},
			{SuffixPoster, func() ([]byte, error) { return fetch(SuffixPoster, posterPath, posterSize) }},
			{SuffixFanart, func() ([]byte, error) { return fetch(SuffixFanart, fanartPath, fanartSize) }},
		} {
			sidecarPath := strings.TrimSuffix(videoPath, path.Ext(videoPath)) + sidecar.suffix
			link := &Sidecar{Video: videoPath, Suffix: sidecar.suffix}
			// A sidecar the download itself holds is uploaded in its place.
			if index, ok := taken[strings.ToLower(sidecarPath)]; ok {
				plan.Files[index].Sidecar = link
				continue
			}
			data, err := sidecar.data()
			if err != nil {
				return Plan{}, err
			}
			if len(data) == 0 {
				continue
			}
			local, err := writeOverlay(overlayDir, sidecarPath, data)
			if err != nil {
				return Plan{}, err
			}
			taken[strings.ToLower(sidecarPath)] = len(plan.Files)
			plan.Files = append(plan.Files, PlanFile{LocalPath: local, Path: sidecarPath, Size: int64(len(data)), Sidecar: link})
		}
	}
	return plan, nil
}

// writeOverlay writes a file the scraper adds at its plan path under overlayDir.
func writeOverlay(overlayDir string, planPath string, data []byte) (string, error) {
	local := filepath.Join(overlayDir, filepath.FromSlash(planPath))
	if err := os.MkdirAll(filepath.Dir(local), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(local, data, 0o644); err != nil {
		return "", err
	}
	return local, nil
}

// commonDir is the deepest folder that holds every video, "" for the root.
func commonDir(videos []video) string {
	var common []string
	for i, v := range videos {
		dir := path.Dir(v.file.rel)
		var parts []string
		if dir != "." {
			parts = strings.Split(dir, "/")
		}
		if i == 0 {
			common = parts
			continue
		}
		n := 0
		for n < len(common) && n < len(parts) && common[n] == parts[n] {
			n++
		}
		common = common[:n]
	}
	return strings.Join(common, "/")
}

func baseName(name string) string {
	if dot := strings.LastIndex(name, "."); dot > 0 {
		return name[:dot]
	}
	return name
}
