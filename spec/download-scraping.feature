Feature: Download scraping
  A downloader with media scraping turned on matches each finished download to
  TMDB on the machine that holds the files, and uploads a matched movie or the
  episodes of a matched show under a media-server layout with Kodi and Jellyfin
  sidecars next to the videos. A download it cannot scrape uploads exactly as
  it would without scraping.

  @download-scraping/movie-layout @usecase
  Scenario: A matched movie is uploaded into its Title (Year) folder with sidecars
    Given a downloader with scraping on
    When a download that matches a TMDB movie finishes
    Then it is uploaded as <target>/Title (Year)/ with the original video file name
    And X.nfo, X-poster.jpg and X-fanart.jpg sit next to the video

  @download-scraping/movie-folder-reused @usecase
  Scenario: A second version of a movie joins the existing folder
    Given a Title (Year)/ folder that already holds a version of the movie
    When another version of the same movie is downloaded later
    Then it lands in the existing Title (Year)/ folder beside the first
    And a video name already taken gets the server's renamed name and its sidecars follow that name

  @download-scraping/existing-sidecars-win @usecase
  Scenario: An entry already at a sidecar path is kept
    Given a live entry at a sidecar path of the video
    When the movie is uploaded
    Then that entry is kept unchanged
    And the video's media metadata references it

  @download-scraping/show-layout @usecase
  Scenario: Matched episodes are uploaded into their show and season folders
    Given a downloader with scraping on
    When a season pack or a single episode that matches a TMDB show finishes
    Then each episode is uploaded as <target>/Show (Year)/Season NN/ with its original video file name
    And specials go to Season 00

  @download-scraping/show-folder-reused @usecase
  Scenario: A later season or episode joins the existing show
    Given a Show (Year)/ folder with a Season NN/ folder from an earlier download
    When another season or episode of the same show is downloaded, even if another task created the folder a moment earlier
    Then it lands in the existing show and season folders instead of a renamed copy
    And a folder name already taken by a file uploads the download unscraped

  @download-scraping/show-sidecars @usecase
  Scenario: Episodes and the show folder get their sidecars
    Given matched episodes
    When they are uploaded
    Then each episode X gets X.nfo and X-thumb.jpg next to it
    And the show folder gets tvshow.nfo, poster.jpg, fanart.jpg and seasonNN-poster.jpg, keeping any already there

  @download-scraping/show-metadata @usecase
  Scenario: Episodes and their show carry media metadata
    Given matched episodes of one show
    When they are uploaded
    Then each episode carries its series id, season and episode number
    And the show folder carries the show's metadata only when it has none yet
    And a download with episodes of more than one show uploads unscraped

  @download-scraping/fallback @usecase
  Scenario: A download that cannot be scraped uploads as today
    Given scraping is off, nothing matches, the task holds more than one movie, or TMDB fails or rejects the token
    When the download finishes
    Then it uploads exactly as today under the torrent or requested name and the task completes
    And a scraping failure is shown in the task activity

  @download-scraping/local-files-untouched @usecase
  Scenario: Scraping leaves the local download as it is
    Given a finished download that may still be seeding
    When it is scraped
    Then no file in the downloader's local download directory is modified, renamed or added

  @download-scraping/match-rules @domain
  Scenario: A movie is matched by .nfo, then source id, then search
    Given a downloaded video
    When its TMDB movie is settled
    Then a .nfo in the download is used first, then a source id, then a search in the configured language and English
    And a search result matches only with title similarity of at least 0.85, the same sequel number, and a year within one
