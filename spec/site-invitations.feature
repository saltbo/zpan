Feature: Site invitations
  Admins invite people to register; the invite is consumed at signup.

  @site-invitations/admin-auth @api
  Scenario: Managing invitations requires authentication
    Given an unauthenticated request
    When it lists site invitations
    Then the API responds 401

  @site-invitations/admin-only @api
  Scenario: Only admins manage site invitations
    Given an authenticated non-admin user
    When they create a site invitation
    Then the API responds 403

  @site-invitations/create @api
  Scenario: Admins create a site invitation
    Given an authenticated admin
    When they invite an email address
    Then an invitation is created and returned

  @site-invitations/list @api
  Scenario: Admins list invitations with totals
    Given existing site invitations
    When an admin lists them
    Then the invitations and total are returned

  @site-invitations/resend @api
  Scenario: Resending an invitation rotates its token
    Given a pending invitation
    When an admin resends it
    Then a new token is issued

  @site-invitations/revoke @api
  Scenario: Admins revoke an invitation
    Given a pending invitation
    When an admin revokes it
    Then it is marked revoked

  @site-invitations/duplicate @api
  Scenario: A duplicate pending invitation is rejected
    Given a pending invitation for an email
    When an admin invites the same email again
    Then the API responds 409

  @site-invitations/by-token @api
  Scenario: An invitation can be fetched by token
    Given an existing invitation
    When it is requested by token
    Then the invitation is returned
