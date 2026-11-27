Feature: File metadata
  Files and folders carry metadata by namespace. The `media` namespace holds
  what a downloader scraped for the files its task uploaded; it belongs to the
  matter, so it follows the file through renames and moves.

  @file-metadata/task-write @api
  Scenario: A download task writes media metadata on what it uploaded
    Given a download task's upload token
    When it sets media metadata on objects its task created
    Then the metadata is stored, and the same token is refused on any other object, including one another task of the same downloader created
    And rename, move, trash and restore keep the metadata, copy copies it, and overwriting a file's content clears it
