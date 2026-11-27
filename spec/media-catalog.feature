Feature: Media catalog
  The Movies and TV Shows pages show the workspace's scraped movies and shows
  from their file metadata, wherever they sit in the workspace.

  @media-catalog/movies @api
  Scenario: Scraped movies show as a poster grid
    Given videos in the workspace with movie media metadata
    When the user opens Movies in the sidebar
    Then the movies show as a poster grid, newest first, paged
    And a movie opens a sheet with fanart, title, year, genres, runtime and overview, and its play action opens the video

  @media-catalog/shows @api
  Scenario: Scraped shows show as a poster grid with their seasons and episodes
    Given show folders in the workspace with show media metadata and episodes with episode media metadata
    When the user opens TV Shows in the sidebar
    Then the shows show as a poster grid, newest first, paged
    And a show lists its seasons and episodes with still, number, title and overview, and an episode plays
