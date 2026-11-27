package mediascrape

import (
	"context"
	"path"
	"sort"
	"strings"
)

// Episodes of a TV show: every episode of the download must match the same
// show, which is fetched once, with one fetch per season the download holds.
// The download is laid out as `Show (Year)/Season NN/<video name>`.

func episodesOf(videos []video) []video {
	var episodes []video
	for _, v := range videos {
		if v.info.Kind == KindEpisode {
			episodes = append(episodes, v)
		}
	}
	return episodes
}

func hasMovie(videos []video) bool {
	for _, v := range videos {
		if v.info.Kind == KindMovie {
			return true
		}
	}
	return false
}

type showKey struct {
	title string
	year  int
}

// scrapeShow matches the episodes of a download to one TMDB show. Videos of
// the download that are not episodes (extras whose names classify as nothing)
// upload as ordinary files beside the episodes.
func (s *Scraper) scrapeShow(
	ctx context.Context,
	download Download,
	files []localFile,
	episodes []video,
	byPath map[string]localFile,
	overlayDir string,
) (Plan, error) {
	source := s.sourceShow(download)
	searched := map[showKey]int{}
	id := 0
	for _, v := range episodes {
		matched, err := s.matchShow(ctx, v, byPath, source, searched)
		if err != nil {
			return Plan{}, err
		}
		if matched == 0 {
			return Plan{}, skip("no TMDB show matches %q", v.file.rel)
		}
		if id != 0 && matched != id {
			return Plan{}, skip("the download holds more than one show")
		}
		id = matched
	}

	show, found, err := s.tmdb.Show(ctx, id, s.language, true)
	if err != nil {
		return Plan{}, tmdbFailure(err)
	}
	if !found {
		return Plan{}, skip("TMDB has no show %d", id)
	}
	if show.Overview == "" && s.language != fallbackLanguage {
		english, found, err := s.tmdb.Show(ctx, id, fallbackLanguage, false)
		if err != nil {
			return Plan{}, tmdbFailure(err)
		}
		if found {
			show.Overview = english.Overview
		}
	}
	folder := FolderName(show.Title, show.Year())
	if folder == "" {
		return Plan{}, skip("TMDB show %d has no title", id)
	}
	seasons, err := s.fetchSeasons(ctx, id, episodes)
	if err != nil {
		return Plan{}, err
	}
	return s.showPlan(ctx, files, episodes, show, seasons, folder, overlayDir)
}

// sourceShow resolves the id the source carries once for the whole download.
// A `tmdb:` tag on a task whose download holds episodes names the show.
func (s *Scraper) sourceShow(download Download) func(context.Context) (int, error) {
	resolved, id := false, 0
	return func(ctx context.Context) (int, error) {
		if resolved {
			return id, nil
		}
		if download.TMDBID != 0 {
			id = download.TMDBID
		} else if download.IMDbID != "" {
			found, err := s.tmdb.FindShowByIMDb(ctx, download.IMDbID)
			if err != nil {
				return 0, tmdbFailure(err)
			}
			id = found
		}
		resolved = true
		return id, nil
	}
}

// matchShow settles an episode's TMDB show id: a tvshow.nfo in the episode's
// folder or a folder above it in the download, then an id the source carries,
// then a search for the show title, made once per title and year.
func (s *Scraper) matchShow(
	ctx context.Context,
	v video,
	files map[string]localFile,
	source func(context.Context) (int, error),
	searched map[showKey]int,
) (int, error) {
	for dir := path.Dir(v.file.rel); ; dir = path.Dir(dir) {
		candidate := TVShowNFOName
		if dir != "." {
			candidate = dir + "/" + TVShowNFOName
		}
		if file, ok := files[strings.ToLower(candidate)]; ok {
			identity, err := readIdentity(file.path)
			if err != nil {
				return 0, err
			}
			if identity.TMDBID != 0 && (identity.Kind == "" || identity.Kind == NFOTVShow) {
				return identity.TMDBID, nil
			}
		}
		if dir == "." {
			break
		}
	}
	if id, err := source(ctx); err != nil || id != 0 {
		return id, err
	}
	key := showKey{title: NormalizeTitle(v.info.Title), year: v.info.Year}
	if id, ok := searched[key]; ok {
		return id, nil
	}
	id, err := s.search(ctx, v.info, s.tmdb.SearchShows)
	if err != nil {
		return 0, err
	}
	searched[key] = id
	return id, nil
}

// fetchSeasons fetches each season the episodes belong to. A season TMDB
// does not have leaves its episodes with their numbers only. When an episode
// of the download has no overview in the configured language, one English
// fetch of its season fills the empty ones.
func (s *Scraper) fetchSeasons(ctx context.Context, showID int, episodes []video) (map[int]Season, error) {
	wanted := map[int][]int{}
	for _, v := range episodes {
		wanted[v.info.Season] = append(wanted[v.info.Season], v.info.Episode)
	}
	numbers := make([]int, 0, len(wanted))
	for number := range wanted {
		numbers = append(numbers, number)
	}
	sort.Ints(numbers)
	seasons := map[int]Season{}
	for _, number := range numbers {
		season, found, err := s.tmdb.Season(ctx, showID, number, s.language, true)
		if err != nil {
			return nil, tmdbFailure(err)
		}
		if !found {
			seasons[number] = Season{Number: number}
			continue
		}
		if s.language != fallbackLanguage && missingOverview(season, wanted[number]) {
			english, found, err := s.tmdb.Season(ctx, showID, number, fallbackLanguage, false)
			if err != nil {
				return nil, tmdbFailure(err)
			}
			if found {
				fillOverviews(&season, english)
			}
		}
		seasons[number] = season
	}
	return seasons, nil
}

func missingOverview(season Season, numbers []int) bool {
	for _, number := range numbers {
		if episode, ok := season.episode(number); ok && episode.Overview == "" {
			return true
		}
	}
	return false
}

func fillOverviews(season *Season, english Season) {
	for i, episode := range season.Episodes {
		if episode.Overview != "" {
			continue
		}
		if other, ok := english.episode(episode.Number); ok {
			season.Episodes[i].Overview = other.Overview
		}
	}
}

func (s Season) episode(number int) (Episode, bool) {
	for _, episode := range s.Episodes {
		if episode.Number == number {
			return episode, true
		}
	}
	return Episode{}, false
}

// showPlan lays the download out under the show folder. Each episode goes to
// its season folder under its own name; a file that is not an episode keeps
// its path relative to the nearest folder above it that holds an episode, in
// that episode's season folder, and a file above every episode keeps its path
// relative to the episodes' common folder in the show folder. A file named
// for an episode (`Show.S01E02.en.srt`) goes to that episode's season. Each episode
// gets its .nfo and thumb, and the show folder its tvshow.nfo, poster,
// fanart, and a poster per season, unless the download holds them already.
func (s *Scraper) showPlan(
	ctx context.Context,
	files []localFile,
	episodes []video,
	show Show,
	seasons map[int]Season,
	folder string,
	overlayDir string,
) (Plan, error) {
	isEpisode := map[string]video{}
	// A folder's season is its lowest regular season, specials only when it
	// holds nothing else.
	seasonOfDir := map[string]int{}
	for _, v := range episodes {
		isEpisode[v.file.rel] = v
		dir := path.Dir(v.file.rel)
		if current, ok := seasonOfDir[dir]; !ok || current == 0 || (v.info.Season != 0 && v.info.Season < current) {
			seasonOfDir[dir] = v.info.Season
		}
	}
	base := commonDir(episodes)
	place := func(rel string) string {
		if v, ok := isEpisode[rel]; ok {
			return SeasonFolderName(v.info.Season) + "/" + path.Base(rel)
		}
		for dir := path.Dir(rel); ; dir = path.Dir(dir) {
			if season, ok := seasonOfDir[dir]; ok {
				// A subtitle or extra named for an episode goes to that episode's season.
				if own := ParseFilename(path.Base(rel)); own.Kind == KindEpisode {
					season = own.Season
				}
				inner := rel
				if dir != "." {
					inner = strings.TrimPrefix(rel, dir+"/")
				}
				return SeasonFolderName(season) + "/" + inner
			}
			if dir == "." {
				break
			}
		}
		if base != "" && strings.HasPrefix(rel, base+"/") {
			return strings.TrimPrefix(rel, base+"/")
		}
		return rel
	}

	plan := Plan{Folder: folder}
	taken := map[string]int{}
	for _, file := range files {
		p := place(file.rel)
		_, video := isEpisode[file.rel]
		if index, ok := taken[strings.ToLower(p)]; ok && (video || plan.Files[index].Video) {
			return Plan{}, skip("two episodes of the download would both be uploaded as %q", p)
		}
		taken[strings.ToLower(p)] = len(plan.Files)
		plan.Files = append(plan.Files, PlanFile{LocalPath: file.path, Path: p, Size: file.size, Video: video})
	}

	images := &imageCache{tmdb: s.tmdb, data: map[string][]byte{}}
	// add puts a file the scraper wrote into the plan, unless the download
	// already holds one at that path, which is uploaded in its place.
	add := func(planPath string, data func() ([]byte, error), mark func(*PlanFile)) error {
		if index, ok := taken[strings.ToLower(planPath)]; ok {
			mark(&plan.Files[index])
			return nil
		}
		content, err := data()
		if err != nil || len(content) == 0 {
			return err
		}
		local, err := writeOverlay(overlayDir, planPath, content)
		if err != nil {
			return err
		}
		file := PlanFile{LocalPath: local, Path: planPath, Size: int64(len(content))}
		mark(&file)
		taken[strings.ToLower(planPath)] = len(plan.Files)
		plan.Files = append(plan.Files, file)
		return nil
	}
	keep := func(file *PlanFile) { file.Keep = true }
	text := func(content string) func() ([]byte, error) {
		return func() ([]byte, error) { return []byte(content), nil }
	}
	image := func(imagePath, size string) func() ([]byte, error) {
		return func() ([]byte, error) { return images.get(ctx, imagePath, size) }
	}

	if err := add(TVShowNFOName, text(TVShowNFO(show)), keep); err != nil {
		return Plan{}, err
	}
	posterPath := nonEmpty(chooseImage(show.Posters, posterPreference(s.language)), show.PosterPath)
	if err := add(ShowPosterName, image(posterPath, posterSize), keep); err != nil {
		return Plan{}, err
	}
	fanartPath := nonEmpty(chooseImage(show.Backdrops, fanartPreference(s.language)), show.BackdropPath)
	if err := add(ShowFanartName, image(fanartPath, fanartSize), keep); err != nil {
		return Plan{}, err
	}
	numbers := make([]int, 0, len(seasons))
	for number := range seasons {
		numbers = append(numbers, number)
	}
	sort.Ints(numbers)
	for _, number := range numbers {
		season := seasons[number]
		seasonPoster := nonEmpty(chooseImage(season.Posters, posterPreference(s.language)), season.PosterPath)
		if err := add(SeasonPosterName(number), image(seasonPoster, posterSize), keep); err != nil {
			return Plan{}, err
		}
	}

	for _, v := range episodes {
		videoPath := place(v.file.rel)
		episode, ok := seasons[v.info.Season].episode(v.info.Episode)
		if !ok {
			episode = Episode{Season: v.info.Season, Number: v.info.Episode}
		}
		episode.Season, episode.Number = v.info.Season, v.info.Episode
		stem := strings.TrimSuffix(videoPath, path.Ext(videoPath))
		for _, sidecar := range []struct {
			suffix string
			data   func() ([]byte, error)
		}{
			{SuffixNFO, text(EpisodeNFO(episode))},
			{SuffixThumb, image(episode.StillPath, stillSize)},
		} {
			link := &Sidecar{Video: videoPath, Suffix: sidecar.suffix}
			if err := add(stem+sidecar.suffix, sidecar.data, func(file *PlanFile) { file.Sidecar = link }); err != nil {
				return Plan{}, err
			}
		}
	}
	return plan, nil
}

// imageCache downloads each TMDB image once per scrape.
type imageCache struct {
	tmdb *TMDB
	data map[string][]byte
}

func (c *imageCache) get(ctx context.Context, imagePath, size string) ([]byte, error) {
	if imagePath == "" {
		return nil, nil
	}
	key := size + imagePath
	if data, ok := c.data[key]; ok {
		return data, nil
	}
	data, found, err := c.tmdb.Image(ctx, imagePath, size)
	if err != nil {
		return nil, tmdbFailure(err)
	}
	if !found {
		data = nil
	}
	c.data[key] = data
	return data, nil
}
