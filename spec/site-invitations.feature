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
  Scenario: Admins page through invitations
    Given more site invitations than one page
    When an admin lists them and follows each next page token
    Then every invitation is returned exactly once, newest first

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

  @site-invitations/email-not-configured @api
  Scenario: Inviting needs email to be configured
    Given email delivery is not configured
    When an admin invites an email address or resends an invitation
    Then the API responds 400 with a message to configure email first
    And no invitation is created

  @site-invitations/list-apart-from-form @web
  Scenario: Invitations are listed on the Users page, apart from the invite form
    Given an authenticated admin opens Admin → Users
    When they choose the Invitations tab
    Then the invitations are listed on the page with previous, next, and a page size
    And the tab is kept in the link, so reloading or sharing it opens the same tab
    When they choose Invite User
    Then a drawer holds only the invite form, with Cancel and Send Invite in its footer
    When the invite is sent
    Then the drawer closes and the Invitations tab shows the new invitation
