Feature: Public profiles
  Each user has a public profile page listing public landing shares that have
  not been marked private, reachable without authentication.

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

  @profile/public-shares @api
  Scenario: A profile returns public landing shares and hides private ones
    Given public and private landing shares owned by a user
    When their profile is requested without authentication
    Then exactly the public shares are returned

  @profile/privacy-boundaries @api
  Scenario: Private share modes never appear on a profile
    Given direct and recipient-targeted shares
    When the owner's profile is requested
    Then neither private share is returned

  @profile/availability-filtering @api
  Scenario: Unavailable public shares disappear at read time
    Given public revoked, expired, exhausted, trashed, purged, draft, and missing-target shares
    When the owner's profile is requested
    Then none of the unavailable shares are returned

  @profile/share-flow @journey
  Scenario: Listed files and folders use the landing-share flow
    Given public file and folder landing shares
    When a visitor opens either item from the profile
    Then the existing share landing page handles file access and folder navigation
