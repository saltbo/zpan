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

  @file-metadata/transfer @api
  Scenario: Media metadata travels to another space with its images
    Given a scraped movie folder, or a scraped show folder, in one space
    When it is copied or moved into another space
    Then the copies keep their media metadata, so they show on that space's Movies or TV Shows page
    And each poster, fanart and still points at the copy of its image in that space, and a reference to an image that stayed behind is dropped
