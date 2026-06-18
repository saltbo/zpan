Feature: User administration
  Admin user management runs through better-auth's admin plugin
  (/api/auth/admin/*). ZPan owns the per-user storage quota and the entitlement
  grants against each user's personal org, and enforces bans in its auth
  middleware.

  @users/admin-only @api
  Scenario: Non-admins cannot administer users
    Given an authenticated non-admin user
    When they call the better-auth admin user endpoints
    Then the API responds 403

  @users/list @api
  Scenario: Admins list users
    Given several users
    When an admin lists users
    Then the users are returned

  @users/quota-personal-org @api
  Scenario: A user's quota reflects their personal org
    Given a user with a personal org
    When an admin reads the user's quota
    Then the quota reflects their personal organization

  @users/disable @api
  Scenario: Admins disable (ban) a user
    Given an active user
    When an admin bans them
    Then the user is disabled

  @users/patch-missing @api
  Scenario: Acting on a missing user returns 404
    Given a user id that does not exist
    When an admin acts on it
    Then the API responds 404

  @users/disabled-session-rejected @api
  Scenario: A disabled user's existing session is rejected
    Given a user disabled mid-session
    When they make an authenticated request
    Then the auth middleware rejects it

  @users/delete @api
  Scenario: Admins delete a user
    Given an existing user
    When an admin removes them
    Then the user is removed

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
