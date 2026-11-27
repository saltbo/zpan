package mediascrape

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultAPIBaseURL   = "https://api.themoviedb.org/3"
	DefaultImageBaseURL = "https://image.tmdb.org/t/p"
	DefaultLanguage     = "en-US"
	fallbackLanguage    = "en-US"

	requestTimeout = 30 * time.Second
	// A 429 waits for Retry-After, clamped to this range, 10 s when absent.
	minRetryDelay     = time.Second
	maxRetryDelay     = 300 * time.Second
	defaultRetryDelay = 10 * time.Second
	// Waits for 429s in a row before scraping gives up on the task.
	maxRateLimitedInARow = 10
	maxImageBytes        = 20 << 20
)

// ErrUnauthorized means TMDB rejected the access token.
var ErrUnauthorized = errors.New("TMDB rejected the access token")

// ErrRateLimited means TMDB kept answering 429 for too long.
var ErrRateLimited = errors.New("TMDB kept rate limiting the requests")

// TMDBConfig is how the downloader reaches TMDB. The default HTTP transport
// honours HTTPS_PROXY.
type TMDBConfig struct {
	AccessToken  string
	Language     string
	APIBaseURL   string
	ImageBaseURL string
}

// TMDB is a TMDB v3 API client authenticated with a v4 API Read Access Token.
type TMDB struct {
	token     string
	apiBase   string
	imageBase string
	http      *http.Client
	sleep     func(context.Context, time.Duration) error
	limited   int
}

// NewTMDB returns a client for one task. It counts 429s in a row across its
// requests, so one task gives up after the tenth.
func NewTMDB(cfg TMDBConfig, httpClient *http.Client) *TMDB {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: requestTimeout}
	}
	return &TMDB{
		token:     cfg.AccessToken,
		apiBase:   strings.TrimRight(nonEmpty(cfg.APIBaseURL, DefaultAPIBaseURL), "/"),
		imageBase: strings.TrimRight(nonEmpty(cfg.ImageBaseURL, DefaultImageBaseURL), "/"),
		http:      httpClient,
		sleep:     sleepContext,
	}
}

func nonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func sleepContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

type searchResponse struct {
	Results []struct {
		ID            int    `json:"id"`
		Title         string `json:"title"`
		OriginalTitle string `json:"original_title"`
		ReleaseDate   string `json:"release_date"`
	} `json:"results"`
}

// SearchMovies searches movies by title, with a year when year is not 0.
func (t *TMDB) SearchMovies(ctx context.Context, title string, year int, language string) ([]SearchHit, error) {
	params := url.Values{"query": {title}, "language": {language}, "include_adult": {"false"}}
	if year != 0 {
		params.Set("year", strconv.Itoa(year))
	}
	var body searchResponse
	if _, err := t.getJSON(ctx, "/search/movie", params, &body); err != nil {
		return nil, err
	}
	hits := make([]SearchHit, 0, len(body.Results))
	for _, result := range body.Results {
		hits = append(hits, SearchHit{
			ID:            result.ID,
			Title:         result.Title,
			OriginalTitle: result.OriginalTitle,
			Year:          yearOf(result.ReleaseDate),
		})
	}
	return hits, nil
}

type imageList []struct {
	FilePath string  `json:"file_path"`
	Language *string `json:"iso_639_1"`
}

func (l imageList) images() []Image {
	images := make([]Image, 0, len(l))
	for _, image := range l {
		language := ""
		if image.Language != nil {
			language = *image.Language
		}
		images = append(images, Image{Path: image.FilePath, Language: language})
	}
	return images
}

type movieResponse struct {
	ID            int    `json:"id"`
	Title         string `json:"title"`
	OriginalTitle string `json:"original_title"`
	Overview      string `json:"overview"`
	ReleaseDate   string `json:"release_date"`
	Runtime       *int   `json:"runtime"`
	Genres        []struct {
		Name string `json:"name"`
	} `json:"genres"`
	PosterPath   *string `json:"poster_path"`
	BackdropPath *string `json:"backdrop_path"`
	Images       *struct {
		Posters   imageList `json:"posters"`
		Backdrops imageList `json:"backdrops"`
	} `json:"images"`
}

// Movie fetches a movie's details in language, with its images when images
// is set. found is false for a movie TMDB does not have.
func (t *TMDB) Movie(ctx context.Context, id int, language string, images bool) (Movie, bool, error) {
	params := url.Values{"language": {language}}
	if images {
		params.Set("append_to_response", "images")
		params.Set("include_image_language", imageLanguage(language)+",null,en")
	}
	var body movieResponse
	found, err := t.getJSON(ctx, "/movie/"+strconv.Itoa(id), params, &body)
	if err != nil || !found {
		return Movie{}, found, err
	}
	movie := Movie{
		ID:            body.ID,
		Title:         body.Title,
		OriginalTitle: body.OriginalTitle,
		Overview:      body.Overview,
		Date:          body.ReleaseDate,
	}
	if body.Runtime != nil {
		movie.Runtime = *body.Runtime
	}
	for _, genre := range body.Genres {
		movie.Genres = append(movie.Genres, genre.Name)
	}
	if body.PosterPath != nil {
		movie.PosterPath = *body.PosterPath
	}
	if body.BackdropPath != nil {
		movie.BackdropPath = *body.BackdropPath
	}
	if body.Images != nil {
		movie.Posters = body.Images.Posters.images()
		movie.Backdrops = body.Images.Backdrops.images()
	}
	return movie, true, nil
}

type findResponse struct {
	MovieResults []struct {
		ID int `json:"id"`
	} `json:"movie_results"`
}

// FindMovieByIMDb resolves an IMDb id to a TMDB movie id, 0 when TMDB has none.
func (t *TMDB) FindMovieByIMDb(ctx context.Context, imdbID string) (int, error) {
	var body findResponse
	found, err := t.getJSON(ctx, "/find/"+url.PathEscape(imdbID), url.Values{"external_source": {"imdb_id"}}, &body)
	if err != nil || !found || len(body.MovieResults) == 0 {
		return 0, err
	}
	return body.MovieResults[0].ID, nil
}

// Image downloads an image at a TMDB size such as w780. found is false for an
// image TMDB does not have.
func (t *TMDB) Image(ctx context.Context, path string, size string) ([]byte, bool, error) {
	res, err := t.send(ctx, t.imageBase+"/"+size+path, false)
	if err != nil {
		return nil, false, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil, false, nil
	}
	if res.StatusCode != http.StatusOK {
		return nil, false, fmt.Errorf("TMDB image request failed: %s", res.Status)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxImageBytes))
	if err != nil {
		return nil, false, fmt.Errorf("TMDB image request failed: %w", err)
	}
	return data, true, nil
}

// getJSON decodes a TMDB API response into out. found is false for a 404.
func (t *TMDB) getJSON(ctx context.Context, path string, params url.Values, out any) (bool, error) {
	target := t.apiBase + path
	if len(params) > 0 {
		target += "?" + params.Encode()
	}
	res, err := t.send(ctx, target, true)
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == http.StatusNotFound:
		return false, nil
	case res.StatusCode == http.StatusUnauthorized:
		return false, ErrUnauthorized
	case res.StatusCode != http.StatusOK:
		return false, fmt.Errorf("TMDB request %s failed: %s", path, res.Status)
	}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return false, fmt.Errorf("TMDB request %s: decode response: %w", path, err)
	}
	return true, nil
}

// send makes one request, waiting out up to ten 429s in a row, counted
// across the client's requests; the next one gives up.
func (t *TMDB) send(ctx context.Context, target string, authorized bool) (*http.Response, error) {
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return nil, err
		}
		if authorized {
			req.Header.Set("Authorization", "Bearer "+t.token)
			req.Header.Set("Accept", "application/json")
		}
		res, err := t.http.Do(req)
		if err != nil {
			return nil, fmt.Errorf("TMDB request failed: %w", err)
		}
		if res.StatusCode != http.StatusTooManyRequests {
			t.limited = 0
			return res, nil
		}
		res.Body.Close()
		t.limited++
		if t.limited > maxRateLimitedInARow {
			return nil, ErrRateLimited
		}
		if err := t.sleep(ctx, retryDelay(res.Header.Get("Retry-After"), time.Now())); err != nil {
			return nil, err
		}
	}
}

// retryDelay reads Retry-After as delay-seconds or an HTTP date.
func retryDelay(header string, now time.Time) time.Duration {
	header = strings.TrimSpace(header)
	if header == "" {
		return defaultRetryDelay
	}
	delay := defaultRetryDelay
	if seconds, err := strconv.ParseFloat(header, 64); err == nil && seconds >= 0 {
		delay = time.Duration(seconds * float64(time.Second))
	} else if at, err := http.ParseTime(header); err == nil {
		delay = at.Sub(now)
	}
	return min(max(delay, minRetryDelay), maxRetryDelay)
}
