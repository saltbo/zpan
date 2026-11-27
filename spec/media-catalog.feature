Feature: Media catalog
  The Movies page shows the workspace's scraped movies from their file
  metadata, wherever the videos sit in the workspace.

  @media-catalog/movies @api
  Scenario: Scraped movies show as a poster grid
    Given videos in the workspace with movie media metadata
    When the user opens Movies in the sidebar
    Then the movies show as a poster grid, newest first, paged
    And a movie opens a sheet with fanart, title, year, genres, runtime and overview, and its play action opens the video
