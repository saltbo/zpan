Feature: User administration
  Admins list, filter, disable, and delete users, and manage per-user storage
  entitlement grants against each user's personal org.

  @users/auth-required @api
  Scenario: User administration requires authentication
    Given an unauthenticated request
    When it calls the admin users API
    Then the API responds 401

  @users/admin-only @api
  Scenario: Non-admins cannot administer users
    Given an authenticated non-admin user
    When they call the admin users API
    Then the API responds 403

  @users/list @api
  Scenario: Admins list users with pagination
    Given several users
    When an admin lists users
    Then a paginated list of users is returned

  @users/quota-personal-org @api
  Scenario: A listed user shows their personal-org quota
    Given a user with a personal org
    When an admin lists users
    Then the user's quota reflects their personal organization

  @users/quota-entitlements @api
  Scenario: A listed user's quota includes active entitlements
    Given a user with an active plan and extra storage entitlements
    When an admin lists users
    Then the quota total is computed from plan plus entitlements

  @users/filter @api
  Scenario: Admins filter users
    Given users with various names, usernames, and emails
    When an admin filters the list
    Then only matching users and the filtered totals are returned

  @users/disable @api
  Scenario: Admins disable a user
    Given an active user
    When an admin sets their status to disabled
    Then the user is disabled

  @users/invalid-status @api
  Scenario: Setting an invalid status is rejected
    Given an existing user
    When an admin sets an invalid status
    Then the API rejects it

  @users/patch-missing @api
  Scenario: Updating a missing user returns 404
    Given a user id that does not exist
    When an admin updates it
    Then the API responds 404

  @users/disabled-session-rejected @api
  Scenario: A disabled user's existing session is rejected
    Given a user disabled mid-session
    When they make an authenticated request
    Then the auth middleware rejects it

  @users/delete @api
  Scenario: Admins delete a user
    Given an existing user
    When an admin deletes them
    Then the user is removed

  @users/batch @api
  Scenario: Admins batch-toggle user status
    Given several users
    When an admin batch-disables and enables them
    Then each user's status is updated

  @users/grant-entitlement @api
  Scenario: Admins grant a storage entitlement
    Given a user with a personal org
    When an admin grants a storage entitlement
    Then the entitlement is recorded against the personal org

  @users/update-entitlement @api
  Scenario: Admins update an admin-granted entitlement
    Given an existing admin grant
    When an admin updates it
    Then the changes are persisted

  @users/revoke-entitlement @api
  Scenario: Admins revoke an admin-granted entitlement
    Given an existing admin grant
    When an admin revokes it
    Then the entitlement is removed

  @users/entitlement-source-guard @api
  Scenario: Only admin-granted entitlements can be edited
    Given an entitlement that was not admin-granted
    When an admin tries to update or revoke it
    Then the API rejects the operation
