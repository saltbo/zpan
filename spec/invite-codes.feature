Feature: Invite codes
  Admins mint single-use invite codes; signup validates them.

  @invite-codes/admin-auth @api
  Scenario: Listing invite codes requires authentication
    Given an unauthenticated request
    When it lists invite codes
    Then the API responds 401

  @invite-codes/admin-only @api
  Scenario: Only admins manage invite codes
    Given an authenticated non-admin user
    When they list invite codes
    Then the API responds 403

  @invite-codes/list @api
  Scenario: Admins list created codes with totals
    Given created invite codes
    When an admin lists them
    Then the codes and total are returned

  @invite-codes/generate @api
  Scenario: Admins generate a batch of codes
    Given an authenticated admin
    When they generate N codes
    Then N codes are created and returned

  @invite-codes/generate-expiry @api
  Scenario: Generated codes can carry an expiry
    Given an authenticated admin
    When they generate codes with expiresInDays
    Then the codes expire at the requested time

  @invite-codes/generate-limit @api
  Scenario: Batch size is capped
    Given an authenticated admin
    When they request more than the maximum batch size
    Then the API rejects the request

  @invite-codes/delete @api
  Scenario: Admins delete an unused code
    Given an unused invite code
    When an admin deletes it
    Then it is removed

  @invite-codes/delete-used @api
  Scenario: A used code cannot be deleted
    Given an already-used invite code
    When an admin deletes it
    Then the API rejects the request

  @invite-codes/validate @api
  Scenario: Signup validates an invite code
    Given a valid unused invite code
    When it is validated
    Then it reports as valid

  @invite-codes/admin-console-visibility @web
  Scenario: Admin settings shows invite codes only while sign-up needs one
    Given the effective registration mode is invite-only
    When an admin opens Admin → Settings
    Then the invite codes card sits under New user registration
    And it is absent when registration is open or closed

  @invite-codes/admin-console-manage @web
  Scenario: Admins manage invite codes from the admin console
    Given the invite codes card in Admin → Settings
    When an admin generates codes, copies one, and deletes an unused one
    Then the list shows each code's status, and delete asks for confirmation first
