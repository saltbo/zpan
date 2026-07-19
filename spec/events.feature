Feature: Event stream
  The client subscribes to a single authenticated server-sent event stream that
  pushes background-job and notification updates, replacing per-resource polling.

  @events/auth-required @api
  Scenario: The event stream requires authentication
    Given an unauthenticated request
    When it opens the event stream
    Then the API responds 401

  @events/stream @api
  Scenario: A browser session receives its multiplexed event stream
    Given an authenticated user
    When they open the event stream with download tasks enabled
    Then job, notification, and download-task events are streamed to them

  @events/api-key-download-tasks @api
  Scenario: An authorized organization API key receives only its organization's download tasks
    Given an organization API key with remoteDownload read permission
    And download tasks exist in its organization and another organization
    When it opens the event stream with download tasks enabled
    Then its organization receives a download-tasks event
    And the stream contains no notification, job, or other-organization task data

  @events/api-key-permission-denied @api
  Scenario: An organization API key without download-task read permission is forbidden
    Given an organization API key without remoteDownload read permission
    When it opens the event stream with download tasks enabled
    Then the API responds 403

  @events/api-key-download-tasks-required @api
  Scenario: An authorized organization API key must opt in to download-task events
    Given an organization API key with remoteDownload read permission
    When it opens the event stream without download tasks enabled
    Then the API responds 403

  @events/api-key-invalid @api
  Scenario: An invalid API key cannot open the event stream
    Given an invalid API key
    When it opens the event stream with download tasks enabled
    Then the API responds 401

  @events/abort @api
  Scenario: Aborting the request closes the stream
    Given an open event stream
    When the request is aborted
    Then the stream is closed

  @events/error-event @api
  Scenario: A failing query surfaces as an error event
    Given an open event stream
    When a domain query fails
    Then an error event is emitted
