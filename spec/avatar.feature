Feature: Avatar
  Authenticated users upload a personal avatar image, stored on public S3 and
  surfaced as a URL on their profile. Uploads are validated and idempotent.

  @avatar/auth-required @api
  Scenario: Uploading an avatar requires authentication
    Given an unauthenticated request
    When it uploads an avatar
    Then the API responds 401

  @avatar/multipart-required @api
  Scenario: Avatar upload must be multipart
    Given an authenticated user
    When they upload with a non-multipart content type
    Then the API responds 415

  @avatar/file-required @api
  Scenario: Avatar upload must include a file
    Given an authenticated user
    When they submit with no file field
    Then the API responds 400

  @avatar/mime-validated @api
  Scenario: Avatars must be a supported image type
    Given an authenticated user
    When they upload a non PNG/JPG/WebP file
    Then the API responds 400

  @avatar/size-limit @api
  Scenario: Avatars are size-limited
    Given an authenticated user
    When they upload a file larger than 2 MiB
    Then the API responds 413

  @avatar/needs-storage @api
  Scenario: Avatar upload needs a public storage
    Given no public storage is configured
    When an authenticated user uploads an avatar
    Then the API responds 503

  @avatar/upload @api
  Scenario: A valid avatar is stored and returned
    Given an authenticated user and a public storage
    When they upload a valid image
    Then it is stored to S3, recorded on the user, and its URL is returned

  @avatar/idempotent @api
  Scenario: Re-uploading the same type returns the same URL
    Given a user who already has an avatar
    When they re-upload with the same mime type
    Then the same URL is returned

  @avatar/delete @api
  Scenario: A user clears their avatar
    Given a user with an avatar
    When they delete it
    Then the image is cleared and all variants are removed from S3

  @avatar/delete-no-storage @api
  Scenario: Clearing an avatar succeeds without storage
    Given a user whose avatar storage is gone
    When they delete their avatar
    Then it succeeds and S3 cleanup is skipped
