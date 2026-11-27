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

  @torrent-cache/fill-from-download @api
  Scenario: A capable downloader fills the cache and the requester gets the files
    Given a downloader that supports the torrent cache and a submitted magnet task
    When the downloader uploads the torrent's metadata and files through the cache
    Then the torrent is cached and the requester's folder holds its files

  @torrent-cache/reject-forged-metadata @api
  Scenario: Metadata that does not match the infoHash is refused
    Given a cache download for one infoHash
    When the downloader uploads metadata of a different torrent
    Then the upload is refused and nothing is cached

  @torrent-cache/verify-pieces @usecase
  Scenario: A torrent is shared only after its pieces verify
    Given a cached torrent whose files were uploaded
    When verification runs over correct bytes, and over bytes with one altered piece
    Then the first becomes ready and the second is marked invalid and is never handed to another workspace

  @torrent-cache/instant-on-submit @api
  Scenario: Submitting a torrent that is already cached completes at once
    Given a ready cached torrent
    When another workspace submits its magnet link
    Then the task completes without a download and the files appear in its folder

  @torrent-cache/join-in-progress @api
  Scenario: Submitting a torrent that is still downloading joins that download
    Given a torrent another workspace is downloading into the cache
    When its magnet link is submitted again
    Then no second download starts and the task completes when the torrent is ready

  @torrent-cache/legacy-downloader-unchanged @api
  Scenario: Downloaders without cache support keep uploading into the drive
    Given a downloader that does not report torrent cache support
    When a magnet task is assigned to it
    Then it uploads into the drive exactly as before

  @torrent-cache/admin-list @api
  Scenario: Admins list the cached torrents
    Given cached torrents with different holders and states
    When an instance admin lists torrents
    Then each shows its name, size, holders, status, verification and last access, page by page

  @torrent-cache/admin-evict @api
  Scenario: Admins evict a torrent nobody holds
    Given one cached torrent nobody holds and one that is held
    When an admin evicts each
    Then the unheld one is deleted and evicting the held one is refused

  @torrent-cache/admin-settings @web
  Scenario: Admins set how long unheld torrents stay cached
    Given the Torrents admin page
    When an admin changes the retention and the capacity
    Then the new values are saved and shown after a reload

  @torrent-cache/stremthru-check @api
  Scenario: Addons see which torrents are cached
    Given a StremThru key and a ready cached torrent
    When an addon checks that torrent's infoHash and an unknown one
    Then the cached torrent is reported cached with its files and the other is not

  @torrent-cache/stremthru-add-and-play @api
  Scenario: Adding a cached torrent through StremThru transfers it and yields a playable link
    Given a StremThru key and a ready cached torrent
    When an addon adds its magnet and generates a link for one of its files
    Then the files appear in the workspace's torrent folder and the link downloads that file

  @torrent-cache/stremthru-link-metered-once @api
  Scenario: Regenerating a link within its lifetime is charged once
    Given a generated playback link
    When the addon generates it again an hour later
    Then the same link is returned and traffic is charged once

  @torrent-cache/stremthru-remove-trashes @api
  Scenario: Removing a torrent through StremThru moves its files to the trash
    Given a torrent added through StremThru
    When the addon removes it
    Then its files are in the workspace trash and the cached torrent remains

  @torrent-cache/stremthru-auth @api
  Scenario: StremThru requests need a valid key and a licensed instance
    Given a request without a key, one with a revoked key, and one on an unlicensed instance
    When each calls the StremThru API
    Then they get the unauthorized, unauthorized and payment-required errors

  @torrent-cache/stremthru-settings @web
  Scenario: A workspace shows how to connect a StremThru addon
    Given a licensed workspace
    When an admin opens its StremThru settings and creates a StremThru key
    Then they see the torrent folder, the address, and the MediaFusion token for the new key
