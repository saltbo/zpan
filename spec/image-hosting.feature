Feature: Image hosting
  Users upload images to a public-image-hosting bucket — either directly (uPic-style
  base64/multipart through the API) or via a presigned URL — and serve them under an
  optional custom domain. Paths are validated and collisions auto-suffixed.

  @image-hosting/json-missing-file @api
  Scenario: A JSON upload without a file is rejected
    Given a JSON request with no base64 file field
    When it is posted
    Then the API responds 400

  @image-hosting/json-auth @api
  Scenario: A JSON upload requires authentication
    Given a JSON upload with no auth
    When it is posted
    Then the API responds 401

  @image-hosting/unsupported-content-type @api
  Scenario: Unsupported content types are rejected
    Given a text/plain request
    When it is posted
    Then the API responds 415

  @image-hosting/upic-upload @api
  Scenario: A base64 PNG uploads (uPic)
    Given an authenticated user
    When they post a base64 PNG via JSON
    Then it is accepted and stored

  @image-hosting/json-explicit-path @api
  Scenario: A JSON upload honors an explicit path
    Given a base64 upload with an explicit path
    When it is posted
    Then the image is stored at that path

  @image-hosting/invalid-base64 @api
  Scenario: Invalid base64 is rejected
    Given a JSON upload with malformed base64
    When it is posted
    Then the API responds 400

  @image-hosting/presign-session-only @api
  Scenario: Presign requires a session, not an API key
    Given an API-key request to presign
    When it is called
    Then the API responds 401

  @image-hosting/requires-config @api
  Scenario: Image hosting requires a configured org
    Given an org with no image-hosting config
    When a user presigns an upload
    Then the API responds 403

  @image-hosting/requires-storage @api
  Scenario: Image hosting requires a storage
    Given no storage configured
    When a user presigns an upload
    Then the API responds 503

  @image-hosting/presign @api
  Scenario: Presign returns a draft row and upload URL
    Given an authenticated user
    When they presign an upload
    Then a draft row and presigned upload URL are returned

  @image-hosting/path-traversal @api
  Scenario: Path traversal is rejected
    Given a path containing ".."
    When an upload is presigned
    Then the API responds 400

  @image-hosting/path-depth @api
  Scenario: Excessive path depth is rejected
    Given a path deeper than the limit
    When an upload is presigned
    Then the API responds 400

  @image-hosting/disallowed-svg @api
  Scenario: Disallowed mime types are rejected
    Given an SVG upload
    When it is presigned
    Then the API responds 400

  @image-hosting/size-limit @api
  Scenario: Oversized uploads are rejected
    Given a file larger than 20 MB
    When it is presigned
    Then the API responds 413

  @image-hosting/collision-suffix @api
  Scenario: Path collisions are auto-suffixed
    Given a path that already exists
    When an upload is presigned
    Then the path is auto-suffixed

  @image-hosting/default-path @api
  Scenario: A default path is derived from the filename
    Given an upload with no explicit path
    When it is presigned
    Then a default path is derived from the blob filename

  @image-hosting/multipart-upload @api
  Scenario: A multipart upload stores the image
    Given an authenticated user
    When they upload via multipart
    Then the image is stored and a tool response returned

  @image-hosting/active-after-upload @api
  Scenario: The row becomes active after upload
    Given a multipart upload
    When it completes
    Then the row status is active

  @image-hosting/content-length-guard @api
  Scenario: Oversized bodies are rejected before parsing
    Given a Content-Length over the limit
    When the request arrives
    Then the API responds 413 before parsing the body

  @image-hosting/custom-domain @api
  Scenario: A verified custom domain is used in the URL
    Given a configured and verified custom domain
    When an image URL is built
    Then it uses the custom domain

  @image-hosting/cursor-ordering @api
  Scenario: Gallery pagination is deterministic for equal timestamps
    Given active images that share a creation timestamp
    When the gallery is traversed in cursor pages
    Then every image is returned once in ascending creation time and ID order

  @image-hosting/invalid-cursor @api
  Scenario: A malformed gallery cursor is rejected
    Given an authenticated gallery request with a malformed cursor
    When the gallery is listed
    Then the API responds 400 with reason INVALID_CURSOR

  @image-hosting/cursor-live-insert @api
  Scenario: Gallery cursors use live-list insert semantics
    Given the first gallery page has been returned
    When images are inserted before and after its creation time and ID cursor
    Then only newly inserted images after the cursor are eligible for later pages

  @image-hosting/cursor-live-delete @api
  Scenario: Gallery cursors use live-list deletion semantics
    Given the first gallery page has been returned
    When an image from that page and an unseen image are deleted
    Then the traversal contains every surviving image exactly once

  @image-hosting/cursor-terminal @api
  Scenario: A null cursor is the sole gallery terminal signal
    Given the final gallery page contains exactly the requested limit
    When the final page is returned
    Then nextCursor is null even though the page is full
