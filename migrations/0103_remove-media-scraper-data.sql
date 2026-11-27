-- Server-side TMDB scraping is gone: downloaders scrape and write file metadata.
-- Its settings and its jobs, which no processor runs any more, go with it.
DELETE FROM `system_options` WHERE `key` IN ('media_scraper_tmdb_access_token', 'media_scraper_language');--> statement-breakpoint
DELETE FROM `background_jobs` WHERE `type` = 'media_library_scrape';
