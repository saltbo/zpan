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

  @media-catalog/broken-poster @web
  Scenario: A poster that fails to load shows the placeholder
    Given a movie or show whose poster file is not a valid image
    When the user opens Movies or TV Shows, or opens that show
    Then its card and the show page show the title placeholder, as for one with no poster
    And a movie sheet whose backdrop fails to load shows the plain backdrop instead of a broken image

  @media-catalog/movie-link @web @api
  Scenario: A shared movie link opens its sheet wherever the movie sits in the list
    Given a movie that is not on the first page of Movies
    When the user opens a link to that movie
    Then its sheet opens with its details
    And a link to a movie that does not exist, or is no longer a movie, opens a sheet saying the movie was not found

  @media-catalog/search @web @api
  Scenario: Movies and TV Shows search by title
    Given scraped movies and shows in the workspace, more than one page of them
    When the user types part of a title, or of an original title, into the search on Movies or TV Shows
    Then the list shows only the matching movies or shows from the whole workspace, newest first, paged
    And the search is kept in the URL, and no match shows that nothing matches the search
