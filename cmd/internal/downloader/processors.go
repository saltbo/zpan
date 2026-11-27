package downloader

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/pkg/mediascrape"
)

// Processor is a step between a finished download and its upload. It never
// changes the downloaded files, which may still be seeding: what it adds goes
// to an overlay directory, and it describes the upload as Result.Plan. A
// processor that fails leaves the Result as it was, so the task uploads as it
// would without it.
type Processor interface {
	Process(ctx context.Context, result Result) (Result, error)
}

// processors builds the chain for one task. It is empty unless configured.
func (w *TaskRunner) processors(task client.DownloadTask, overlayDir string) []Processor {
	if !w.cfg.Scrape.Enabled {
		return nil
	}
	tmdb := mediascrape.NewTMDB(mediascrape.TMDBConfig{
		AccessToken:  w.cfg.Scrape.TMDBToken,
		Language:     w.cfg.Scrape.Language,
		APIBaseURL:   w.cfg.Scrape.TMDBAPIURL,
		ImageBaseURL: w.cfg.Scrape.TMDBImageURL,
	}, nil)
	tmdbID, imdbID := sourceMediaIDs(task.Tags())
	return []Processor{&scrapeProcessor{
		scraper:    mediascrape.NewScraper(tmdb, w.cfg.Scrape.Language),
		overlayDir: overlayDir,
		tmdbID:     tmdbID,
		imdbID:     imdbID,
	}}
}

// postProcess runs the task's processors over a finished download. A failure
// is recorded in the task activity and leaves the result unchanged. The
// returned cleanup removes the overlay once the upload is over.
func (w *TaskRunner) postProcess(ctx context.Context, log *slog.Logger, task client.DownloadTask, result Result) (Result, func()) {
	overlayDir := w.overlayDir(task.ID)
	cleanup := func() {
		if err := os.RemoveAll(overlayDir); err != nil {
			log.Warn("failed to remove processor overlay", "path", overlayDir, "error", err)
		}
	}
	processors := w.processors(task, overlayDir)
	if len(processors) == 0 {
		return result, func() {}
	}
	cleanup()
	for _, processor := range processors {
		processed, err := processor.Process(ctx, result)
		if err != nil {
			if ctx.Err() != nil {
				return result, cleanup
			}
			log.Warn("download processor failed; uploading unprocessed", "error", err)
			w.uploader.reportScrapeSkipped(ctx, log, task.ID, err.Error())
			continue
		}
		result = processed
	}
	return result, cleanup
}

func (w *TaskRunner) overlayDir(taskID string) string {
	base := w.cfg.StateDir
	if base == "" {
		base = filepath.Join(os.TempDir(), "zpan-downloader")
	}
	return filepath.Join(base, "overlays", taskID)
}

func scrapeReason(reason string) string {
	if len(reason) > maxTaskErrorMessageLength {
		return reason[:maxTaskErrorMessageLength-3] + "..."
	}
	return reason
}

// sourceMediaIDs reads the TMDB or IMDb id a task carries as a tag,
// `tmdb:<id>` or `imdb:<tt id>`.
func sourceMediaIDs(tags []string) (int, string) {
	tmdbID, imdbID := 0, ""
	for _, tag := range tags {
		key, value, ok := strings.Cut(strings.TrimSpace(tag), ":")
		if !ok {
			continue
		}
		switch strings.ToLower(key) {
		case "tmdb":
			if id, err := strconv.Atoi(value); err == nil && id > 0 {
				tmdbID = id
			}
		case "imdb":
			if strings.HasPrefix(value, "tt") {
				imdbID = value
			}
		}
	}
	return tmdbID, imdbID
}

// scrapeProcessor matches a download to a TMDB movie and lays it out as
// `Title (Year)/` with Kodi sidecars.
type scrapeProcessor struct {
	scraper    *mediascrape.Scraper
	overlayDir string
	tmdbID     int
	imdbID     string
}

func (p *scrapeProcessor) Process(ctx context.Context, result Result) (Result, error) {
	plan, err := p.scraper.Scrape(ctx, mediascrape.Download{
		Path:   result.Path,
		IsDir:  result.IsDir,
		Name:   result.Name,
		TMDBID: p.tmdbID,
		IMDbID: p.imdbID,
	}, p.overlayDir)
	if errors.Is(err, mediascrape.ErrNoVideo) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	upload := &UploadPlan{Folder: plan.Folder, Files: make([]PlannedFile, 0, len(plan.Files))}
	for _, file := range plan.Files {
		planned := PlannedFile{LocalPath: file.LocalPath, Path: file.Path, Size: file.Size, Video: file.Video}
		if file.Sidecar != nil {
			planned.Sidecar = &PlannedSidecar{Video: file.Sidecar.Video, Suffix: file.Sidecar.Suffix}
		}
		upload.Files = append(upload.Files, planned)
	}
	result.Plan = upload
	return result, nil
}
