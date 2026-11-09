Feature: Media library scraping
  A Pro or Business instance with a TMDB access token matches the videos of
  each media library to TMDB in a background job. library.json gains only the
  TMDB id of each matched video; titles, plots, and artwork go to Kodi and
  Jellyfin sidecar files next to the videos, and files the user already has
  are never overwritten.

  @media-scraping/match-titles @domain
  Scenario: Search results are matched by normalized title and year
    Given a parsed title and year and TMDB search results
    When the best match is chosen
    Then only a result with a similar localized or original title within a year matches
    And posters prefer the configured language while fanart prefers textless art

  @media-scraping/nfo-files @domain
  Scenario: NFO files are rendered as escaped Kodi XML and read back for their TMDB id
    Given TMDB details with markup characters, CJK text, and missing fields
    When movie, show, and episode NFO files are rendered
    Then they are well-formed Kodi documents without the missing fields
    And an existing NFO yields its root kind and TMDB id however it is formatted

  @media-scraping/sidecar-layout @domain
  Scenario: Sidecars follow the Kodi layout
    Given movies and episodes in show and season folders
    When their sidecar paths are resolved
    Then movies get X.nfo, X-poster.jpg, and X-fanart.jpg
    And a show folder is the episode folder or the parent of a season folder named after the show

  @media-scraping/reuse-previous @domain
  Scenario: A changed video keeps its match while its parsed title is unchanged
    Given an earlier matched or unmatched scrape of a video
    When the video changes or the language changes
    Then a match is reused while the parsed title is the same, and no match is retried only in a new language

  @media-scraping/tmdb-gateway @usecase
  Scenario: The TMDB gateway reads its token from settings and maps TMDB responses and failures
    Given an access token and language saved by an administrator
    When the gateway searches, fetches details, seasons, and images
    Then requests carry the bearer token and the language, and images include the language, textless, and English
    And 401, 429 with Retry-After, 5xx, and network failures become typed errors while a 404 is no result

  @media-scraping/scrape-library @api
  Scenario: A scan queues a scrape that writes sidecars without replacing files
    Given a licensed instance with a TMDB token and a library of movies and a show
    And a movie with its own .nfo naming a TMDB id and a show folder with its own poster
    When the library's first scan completes
    Then a scrape job writes movie, show, season, and episode sidecars as the system actor
    And the user's .nfo and poster are untouched, and the .nfo's id is used without a search
    And each show is searched and fetched once for all its episodes, and an unknown movie stays unmatched

  @media-scraping/show-folders @api
  Scenario: Show sidecars go only to a folder named after the show
    Given episodes loose in a shared folder, specials in a show's Specials folder, and an unclassified video
    When the library is scraped in a language without plots
    Then loose episodes get only their own sidecars, specials get season00-poster.jpg
    And plots come from one English fetch per show and season, and the unclassified video is not searched

  @media-scraping/loop-terminates @api
  Scenario: Scanning and scraping stop once nothing changed
    Given a scraped library whose scan published the matches
    When the sweep runs, a rescan completes, and a scrape is requested again
    Then no further scan is queued by the sweep, the rescan queues no scrape, and the scrape has nothing to do

  @media-scraping/rescrape-changes @api
  Scenario: A renamed video or a new language is scraped again without searching for known matches
    Given a scraped library
    When a video is renamed without changing its parsed title, and later the language changes
    Then the renamed video keeps its match and gets its own sidecars
    And the language change searches again only for the video that did not match

  @media-scraping/batches @api
  Scenario: A scrape continues across queue messages
    Given a library with more videos than one batch holds
    When the scrape job runs
    Then the same job is queued again with its cursor after each full batch and completes with every video

  @media-scraping/queue-consumer @api
  Scenario: The Workers queue consumer continues a scrape on D1
    Given a scrape job on the Workers queue for a library larger than one batch
    When the consumer receives the job and then its continuation
    Then the job completes with every video recorded, and the scan it queues ends without another scrape

  @media-scraping/rate-limited @usecase
  Scenario: A TMDB rate limit delays the job instead of failing it
    Given TMDB answers 429 with a Retry-After partway through a batch
    When the scrape job handles it
    Then the job is queued again after that delay, at most five minutes, with the videos already done

  @media-scraping/transient-failure @usecase
  Scenario: A TMDB outage fails the job as retryable
    Given TMDB fails with a server error or the library disappears
    When the scrape job runs
    Then an outage fails the job as retryable naming the video, and a missing library fails it for good

  @media-scraping/quota @usecase
  Scenario: Exceeding the quota stops the scrape
    Given a workspace without room for another sidecar
    When the scrape writes one
    Then the job fails with a quota message and the uploaded object is deleted

  @media-scraping/rejected-token @api
  Scenario: A rejected token fails the scrape with a clear message
    Given an access token TMDB rejects
    When a scrape runs
    Then the job fails without retry, telling the administrator to update the token

  @media-scraping/requires-token @api
  Scenario: Scraping needs a TMDB token
    Given a licensed instance without a TMDB token
    When a scan completes and a user requests a scrape
    Then no scrape is queued and the request fails with MEDIA_SCRAPER_NOT_CONFIGURED

  @media-scraping/manual-scrape @api
  Scenario: A scrape is refused while another one is active
    Given a media library with a queued scrape
    When a scrape is requested
    Then it is rejected with MEDIA_LIBRARY_SCRAPE_IN_PROGRESS and the library reports scraping

  @media-scraping/requires-license @api
  Scenario: Community instances cannot scrape
    Given an instance without a Pro or Business license
    When a scrape is requested or a scan completes
    Then the request is blocked as a paid feature and no scrape is queued

  @media-scraping/publish-ids @domain
  Scenario: library.json publishes only the TMDB id of each matched video
    Given pages of videos, some with a TMDB match
    When the feed is serialized
    Then each matched item carries _media.tmdb with its id and type, last, and unmatched items carry none
    And the text is still exactly the JSON of the whole feed

  @media-scraping/index-query-plan @api
  Scenario: Joining scrape results keeps the index pages on one index range
    Given the index page query and the needs-scraping queries on D1
    When their query plans are explained
    Then each searches one subtree range of matters and joins media_scrapes on its primary key
    And the bound parameters stay fixed whatever the library size
