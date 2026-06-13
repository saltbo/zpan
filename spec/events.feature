Feature: Event stream
  The client subscribes to a single authenticated server-sent event stream that
  pushes background-job and notification updates, replacing per-resource polling.

  @events/auth-required @api
  Scenario: The event stream requires authentication
    Given an unauthenticated request
    When it opens the event stream
    Then the API responds 401

  @events/stream @api
  Scenario: The stream pushes jobs and notifications
    Given an authenticated user
    When they open the event stream
    Then job and notification events are streamed to them

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
