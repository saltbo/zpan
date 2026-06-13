Feature: Announcements
  Admins publish site announcements (a licensed feature); users read the active ones.

  @announcements/admin-only @api
  Scenario: Only admins manage announcements
    Given an authenticated non-admin user
    When they call the admin announcements API
    Then the API responds 403

  @announcements/crud @api
  Scenario: Admins create, list, update and delete announcements
    Given an authenticated admin with the announcements feature
    When they create, list, update and delete an announcement
    Then each operation succeeds

  @announcements/user-active @api
  Scenario: Users see active announcements
    Given published announcements
    When a user lists announcements with scope active
    Then only published announcements are returned

  @announcements/archived-history @api
  Scenario: Archived announcements stay in history but not the active list
    Given an archived announcement
    When the user active list and the history are read
    Then it appears in history but not in the active list

  @announcements/no-drafts @api
  Scenario: Draft announcements never leak to users
    Given a draft announcement
    When a user reads the announcement history
    Then drafts are excluded

  @announcements/pagination-validation @api
  Scenario: Invalid pagination is rejected
    Given an authenticated user
    When they request announcements with invalid pagination values
    Then the API rejects the request
