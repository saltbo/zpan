Feature: Torrent cache
  Torrents are cached once per instance under bt/<infoHash>/ and given to any
  workspace by instant transfer, without copying bytes. Only eviction deletes them.

  @torrent-cache/instant-transfer @usecase
  Scenario: A cached torrent is transferred into a workspace without copying bytes
    Given a ready cached torrent and a workspace with enough quota
    When it is transferred into the workspace's torrent folder
    Then the torrent's folder and files appear there, pointing at the cached objects
    And the workspace quota grows by the torrent's size while the storage usage does not

  @torrent-cache/transfer-over-quota @usecase
  Scenario: A transfer that does not fit the quota creates nothing
    Given a ready cached torrent larger than the workspace's free quota
    When it is transferred
    Then the transfer fails with the quota error and no file is created

  @torrent-cache/cached-files-keep-bytes @api
  Scenario: Deleting a transferred file never deletes the cached bytes
    Given a workspace holding transferred files of a cached torrent
    When a file is permanently deleted, and another is copied, renamed and moved
    Then the cached objects still exist and the copy points at the same cached object

  @torrent-cache/cached-files-read-only @api
  Scenario: Transferred files cannot be overwritten
    Given a transferred file of a cached torrent
    When its content is overwritten through WebDAV
    Then the request is rejected and the file still points at the cached object

  @torrent-cache/only-eviction-deletes @domain
  Scenario: Only eviction may delete cached objects
    Given a storage gateway
    When anything other than eviction deletes a cached object
    Then the deletion is refused

  @torrent-cache/eviction @api
  Scenario: Unheld torrents are evicted after the retention period
    Given one cached torrent nobody holds and last accessed 31 days ago, one held only from the trash, and one held by a live file
    When the sweep runs
    Then only the unheld torrent's objects and rows are deleted

  @torrent-cache/workspace-folder @api
  Scenario: The workspace torrent folder defaults to Media and only admins change it
    Given a workspace with an admin and an editor
    When both read the torrent folder and both try to change it
    Then both read Media, the admin's change is saved and the editor's is refused
