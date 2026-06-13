Feature: Notifications
  Per-user in-app notifications with unread tracking.

  @notifications/auth @api
  Scenario: Notifications require authentication
    Given an unauthenticated request
    When it lists notifications
    Then the API responds 401

  @notifications/list @api
  Scenario: A user lists their notifications with pagination
    Given a user with notifications
    When they list notifications
    Then the page and totals are returned

  @notifications/unread-filter @api
  Scenario: A user filters to unread notifications
    Given a user with read and unread notifications
    When they list with the unread filter
    Then only unread notifications are returned

  @notifications/isolation @api
  Scenario: Users never see another user's notifications
    Given two users with their own notifications
    When one lists notifications
    Then only their own are returned

  @notifications/stats @api
  Scenario: The unread count is reported
    Given a user with unread notifications
    When they request notification stats
    Then the unread count is correct

  @notifications/mark-read @api
  Scenario: Marking a notification read returns 204
    Given a user with an unread notification
    When they mark it read
    Then the API responds 204

  @notifications/mark-read-foreign @api
  Scenario: A user cannot mark another user's notification read
    Given a notification owned by another user
    When the user marks it read
    Then the API responds 404

  @notifications/mark-all @api
  Scenario: Marking all read returns the count
    Given a user with several unread notifications
    When they mark all read
    Then the count of updated notifications is returned
