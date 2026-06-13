Feature: Public profiles
  Each user has a public profile page listing their public shares, reachable
  without authentication. Profile paths render as navigable breadcrumbs.

  @profile/user-not-found @api
  Scenario: An unknown user id has no profile
    Given a user id that does not exist
    When the profile is requested
    Then the API responds 404

  @profile/user-info @api
  Scenario: A profile returns user info and shares
    Given an existing user
    When their profile is requested
    Then their user info and shares are returned

  @profile/public @api
  Scenario: Profiles are public
    Given an existing user
    When their profile is requested without authentication
    Then it is still returned

  @profile/no-personal-org @api
  Scenario: A user without a personal org still has a profile
    Given an existing user with no personal org
    When their profile is requested
    Then their user info is returned

  @profile/unknown-username @api
  Scenario: An unknown username has no public listing
    Given a username that does not exist
    When its public listing is requested
    Then the API responds 404

  @profile/empty-listing @api
  Scenario: A known user with no public files lists nothing
    Given a known user with no public files
    When their public listing is requested
    Then an empty item list and breadcrumb are returned

  @profile/breadcrumb-segments @domain
  Scenario: A profile path splits into breadcrumb segments
    Given a nested profile path
    When it is split into breadcrumb segments
    Then each path level becomes one ordered segment
