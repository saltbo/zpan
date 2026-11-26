Feature: Load errors
  A list or page that fails to load says so and offers a retry, instead of looking
  empty. A route that cannot render falls back to an error page, so no page is ever
  blank (UX.md, States).

  @load-errors/files-list @web
  Scenario: The file list shows an alert with retry when it fails to load
    Given a signed-in user opens their files
    When the file list request fails
    Then an inline alert says the list could not be loaded, instead of the empty folder
    And choosing Retry loads the list again

  @load-errors/shares-list @web
  Scenario: The shares list shows an alert with retry when it fails to load
    Given a signed-in user opens their shares
    When the shares list request fails
    Then an inline alert says the list could not be loaded, instead of the empty state
    And choosing Retry loads the list again

  @load-errors/trash-list @web
  Scenario: The trash list shows an alert with retry when it fails to load
    Given a signed-in user opens their trash
    When the trash list request fails
    Then an inline alert says the list could not be loaded, instead of the empty trash
    And choosing Retry loads the list again

  @load-errors/route-fallback @web
  Scenario: A route that cannot render shows an error page with retry
    Given a page whose route has no error component of its own
    When its loader or component throws
    Then an error page with a Retry action is shown instead of a blank page
