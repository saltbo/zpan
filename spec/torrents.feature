Feature: Torrents
  Each torrent is stored once per instance under bt/<infoHash>/ and given to any
  workspace by instant transfer, without copying bytes. Only eviction deletes it.

  @torrents/instant-transfer @usecase
  Scenario: A torrent is transferred into a workspace without copying bytes
    Given a ready torrent and a workspace with enough quota
    When it is transferred into a folder of the workspace
    Then the torrent's folder and files appear there, pointing at the torrent's objects
    And the workspace quota grows by the torrent's size while the storage usage does not

  @torrents/transfer-over-quota @usecase
  Scenario: A transfer that does not fit the quota creates nothing
    Given a ready torrent larger than the workspace's free quota
    When it is transferred
    Then the transfer fails with the quota error and no file is created

  @torrents/transferred-files-keep-bytes @api
  Scenario: Deleting a transferred file never deletes the torrent's bytes
    Given a workspace holding transferred files of a torrent
    When a file is permanently deleted, and another is copied, renamed and moved
    Then the torrent's objects still exist and the copy points at the same object

  @torrents/overwrite-writes-owned-object @api
  Scenario: Overwriting a transferred file gives it an object of its own
    Given transferred files of a torrent
    When one is overwritten through WebDAV and another is replaced by a web upload
    Then each now points at an object it owns and the torrent's objects are untouched

  @torrents/only-eviction-deletes @domain
  Scenario: Only eviction may delete a torrent's objects
    Given a storage gateway
    When anything other than eviction deletes an object under bt/
    Then the deletion is refused

  @torrents/eviction @api
  Scenario: Unheld torrents are evicted after the retention period
    Given one torrent nobody holds and last accessed 31 days ago, one held only from the trash, and one held by a live file
    When the sweep runs
    Then only the unheld torrent's objects and rows are deleted

  @torrents/fill-from-download @api
  Scenario: A download that reports its torrent fills it through the object API
    Given a submitted magnet task and a downloader that reports the torrent's info dictionary
    When the downloader uploads the torrent's files through the object API, each with its torrent path
    Then the files are stored once under bt/ and the requester's drive files reference them

  @torrents/reject-forged-metadata @api
  Scenario: Metadata that does not match the infoHash is refused
    Given a torrent download for one infoHash
    When the downloader uploads metadata of a different torrent
    Then the upload is refused and nothing is stored

  @torrents/verify-pieces @usecase
  Scenario: A torrent is shared only after its pieces verify
    Given a torrent whose files were uploaded
    When verification runs over correct bytes, and over bytes with one altered piece
    Then the first becomes ready and the second is marked invalid and is never handed to another workspace

  @torrents/instant-on-submit @api
  Scenario: Submitting a torrent already on the instance completes at once
    Given a ready torrent
    When another workspace submits its magnet link
    Then the task completes without a download and the files appear in its folder

  @torrents/join-in-progress @api
  Scenario: Submitting a torrent that is still downloading joins that download
    Given a torrent another workspace is downloading
    When its magnet link is submitted again
    Then no second download starts and the task completes when the torrent is ready

  @torrents/legacy-downloader-unchanged @api
  Scenario: Downloaders that report no info dictionary keep uploading into the drive
    Given a downloader built before Torrents, which never reports a torrent's info dictionary
    When a magnet task is assigned to it
    Then it uploads ordinary drive files exactly as before and the torrent stays off the instance

  @torrents/admin-list @api
  Scenario: Admins list the torrents on the instance
    Given torrents with different holders and states
    When an instance admin lists torrents
    Then each shows its name, size, holders, status, verification and last access, page by page

  @torrents/admin-evict @api
  Scenario: Admins evict a torrent nobody holds
    Given one torrent nobody holds and one that is held
    When an admin evicts each
    Then the unheld one is deleted and evicting the held one is refused

  @torrents/admin-settings @web
  Scenario: Admins set how long unheld torrents stay
    Given the Torrents admin page
    When an admin changes the retention and the capacity
    Then the new values are saved and shown after a reload

  @torrents/stremthru-check @api
  Scenario: Addons see which torrents are on the instance
    Given a StremThru key and a ready torrent
    When an addon checks that torrent's infoHash and an unknown one
    Then the torrent is reported cached with its files and the other is not

  @torrents/stremthru-add-and-play @api
  Scenario: Adding a torrent on the instance through StremThru transfers it and yields a playable link
    Given a StremThru key and a ready torrent
    When an addon adds its magnet and generates a link for one of its files
    Then the files appear in the workspace's Media folder and the link downloads that file

  @torrents/stremthru-link-metered-once @api
  Scenario: Regenerating a link within its lifetime is charged once
    Given a generated playback link
    When the addon generates it again an hour later
    Then the same link is returned and traffic is charged once

  @torrents/stremthru-remove-trashes @api
  Scenario: Removing a torrent through StremThru moves its files to the trash
    Given a torrent added through StremThru
    When the addon removes it
    Then its files are in the workspace trash and the torrent remains on the instance

  @torrents/stremthru-auth @api
  Scenario: StremThru requests need a valid key and a licensed instance
    Given a request without a key, one with a revoked key, and one on an unlicensed instance
    When each calls the StremThru API
    Then they get the unauthorized, unauthorized and payment-required errors

  @torrents/stremthru-settings @web
  Scenario: A workspace shows how to connect a StremThru addon
    Given a licensed workspace
    When an admin opens its StremThru settings and creates a StremThru key
    Then they see the address and the MediaFusion token for the new key

  @torrents/downloader-fills-torrent @downloader
  Scenario: The downloader reports the torrent and uploads it the way it uploads any download
    Given an engine that hands over a torrent's metadata
    When the downloader runs a magnet task
    Then it reports the info dictionary on the task and uploads through the object API with each file's torrent path, scraped or not

  @torrents/layout-replay @api
  Scenario: A later holder gets the first download's scraped layout
    Given a scraped download that filled a torrent with folders, renamed files, sidecars and media metadata
    When another workspace remote-downloads the same magnet
    Then it gets the same folders, sidecars and media metadata at once, with sidecars referencing the files it wrote
