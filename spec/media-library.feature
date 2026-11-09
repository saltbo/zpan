Feature: Media libraries
  A folder marked as a media library gets a JSON Feed index at
  <folder>/library.json that WebDAV clients fetch conditionally instead of
  walking the folder tree. A 10-minute sweep rescans a library when its subtree
  fingerprint changes. Media libraries are a Pro and Business feature.

  @media-library/parse-filenames @domain
  Scenario: Video filenames are parsed into movie, episode, or unknown metadata
    Given release-style movie, episode, Chinese, and junk filenames
    When they are parsed
    Then each yields its media type, title, year, season, and episode

  @media-library/build-feed @domain
  Scenario: The index is a deterministic JSON Feed snapshot of the library videos
    Given video and non-video files under a library folder
    When the feed is built
    Then it lists only the videos, ordered by path, with library-relative encoded URLs

  @media-library/create-and-scan @api
  Scenario: Marking a folder queues a scan that writes the index
    Given a licensed workspace with videos in a folder
    When the folder is marked as a media library
    Then a scan job completes and library.json lists the videos
    And a WebDAV GET with the returned ETag answers 304

  @media-library/sweep-rescans-on-change @api
  Scenario: The sweep rescans only libraries whose subtree changed
    Given a scanned media library
    When the sweep runs without changes, then after a video is added and another renamed
    Then only the changed state queues scans and the index is rewritten in place

  @media-library/first-scan-enqueue-failure @api
  Scenario: A library is kept when its first scan cannot be queued
    Given queueing the first scan fails after the library is stored
    When a folder is marked as a media library
    Then the library is created without a running scan and the next sweep scans it

  @media-library/manual-rescan @api
  Scenario: A rescan is refused while another scan is active
    Given a media library with a queued scan
    When a rescan is requested
    Then it is rejected until the queued scan's lease expires

  @media-library/no-nesting @api
  Scenario: Libraries cannot overlap
    Given a folder that is a media library, live or in trash
    When its ancestor, its descendant, or the same folder is marked
    Then each request is rejected with a specific reason

  @media-library/overlap-after-move @api
  Scenario: The older of two overlapping libraries keeps its index
    Given two libraries that came to overlap after creation
    When the sweep runs
    Then the older library is scanned and the newer one's scan fails naming the older one
    And the newer library is not retried until its subtree changes

  @media-library/sweep-isolates-failures @api
  Scenario: One failing library does not stop the sweep
    Given two changed libraries where checking one of them fails
    When the sweep runs
    Then the failure is logged with the library id and the other library is still scanned

  @media-library/transient-scan-retry @api
  Scenario: A transient scan failure is retried by the next sweep
    Given a library whose first scan failed on a storage error
    When the sweep runs without any change to the library
    Then a new scan is queued and writes the index

  @media-library/index-cleanup-failure @api
  Scenario: Failing to delete the previous index object does not fail the scan
    Given a scanned media library
    When a rescan cannot delete the previous index object
    Then the scan completes with the new index and the failure is logged

  @media-library/user-index-file-blocks @api
  Scenario: A user's own library.json is never overwritten
    Given a library folder whose root already holds a user file named library.json
    When the library is scanned
    Then the scan fails naming that file and the file is left untouched

  @media-library/scan-holds-lease @api
  Scenario: A long scan keeps its lease
    Given a scan whose file listing outlasts the scan lease
    When the scan writes the index
    Then the library still reports a scan in progress

  @media-library/sweep-lifecycle @api
  Scenario: The sweep skips trashed library folders and drops purged ones
    Given one library whose folder is trashed and one whose folder is purged
    When the sweep runs
    Then the trashed library is kept without a scan and the purged library is removed and logged

  @media-library/requires-license @api
  Scenario: Community instances cannot create or rescan media libraries
    Given an instance without a Pro or Business license and an existing media library
    When a user creates or rescans a media library
    Then the requests are blocked as a paid feature
    But the user can still list and remove the existing library

  @media-library/sweep-requires-license @api
  Scenario: The sweep does nothing without a license
    Given an existing media library on an instance without a license
    When its subtree changes and the sweep runs
    Then no scan is queued and the library stays in place

  @media-library/editor-only @api
  Scenario: Only editors manage media libraries
    Given a workspace viewer and an anonymous caller
    When they try to mark a folder as a media library
    Then the viewer is forbidden and the anonymous caller is unauthenticated

  @media-library/jobs-disabled @api
  Scenario: Media libraries need background jobs
    Given an environment with background jobs disabled
    When a folder is marked as a media library
    Then the request is rejected as unavailable

  @media-library/queue-consumer @api
  Scenario: The Workers queue consumer runs media library scans on D1
    Given a media library scan message on the background job queue
    When the Workers queue consumer receives it
    Then the scan job completes and the index matter exists in D1
