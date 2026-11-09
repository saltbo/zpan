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
