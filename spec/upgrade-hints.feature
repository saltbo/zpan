Feature: Upgrade hints
  A region gated behind ZPan Pro is replaced by an upgrade hint (UX.md, Pro
  gating). Only an admin can change the instance's license, so only an admin is
  sent to licensing; anyone else is told who can unlock it.

  @upgrade-hints/admin-links-licensing @web
  Scenario: An admin is sent to licensing from an upgrade hint
    Given a signed-in admin on an instance without ZPan Pro
    When they reach a gated region, such as the team limit when creating a team
    Then the upgrade hint offers an action that opens Admin → Licensing

  @upgrade-hints/member-asks-admin @web
  Scenario: A non-admin is told to ask the site's administrator
    Given a signed-in user who is not an admin, on an instance without ZPan Pro
    When they reach a gated region, such as the team limit, media libraries, or an image custom domain
    Then the upgrade hint says to ask the site's administrator to upgrade
    And it offers no link to licensing, which they cannot open
