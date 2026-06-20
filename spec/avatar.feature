Feature: Avatar
  Authenticated users upload a personal avatar image, hosted on the ZPan Cloud
  avatar service and surfaced as a URL on their profile. Uploads are validated
  locally (mime + size) before the Cloud call, and require the instance to be
  paired to Cloud.

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
    When they upload a non-image file
    Then the API responds 400 before any Cloud call

  @avatar/size-limit @api
  Scenario: Avatars are size-limited
    Given an authenticated user
    When they upload a file larger than 1 MiB
    Then the API responds 413 before any Cloud call

  @avatar/needs-cloud @api
  Scenario: Avatar upload needs the instance paired to Cloud
    Given an instance with no active Cloud license binding
    When an authenticated user uploads an avatar
    Then the API responds 503 cloud_required

  @avatar/upload @api
  Scenario: A valid avatar is hosted on Cloud and returned
    Given an authenticated user on a Cloud-paired instance
    When they upload a valid image
    Then it is sent to the Cloud avatar service with the image content type, recorded on the user, and its URL is returned

  @avatar/delete @api
  Scenario: A user clears their avatar
    Given a user with an avatar on a Cloud-paired instance
    When they delete it
    Then the image is cleared and the Cloud avatar is deleted

  @avatar/delete-unbound @api
  Scenario: Clearing an avatar succeeds without a Cloud binding
    Given a user with an avatar on an instance not paired to Cloud
    When they delete their avatar
    Then it succeeds and the Cloud delete is skipped
