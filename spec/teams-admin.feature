Feature: Team administration
  Site admins review team orgs (usage, members, owner) — excluding personal
  spaces — and manage per-team storage entitlement grants.

  @teams-admin/admin-only @api
  Scenario: Team administration requires an admin
    Given a non-admin user
    When they call the admin teams API
    Then the API responds 403

  @teams-admin/list @api
  Scenario: Admins list team orgs
    Given team and personal orgs
    When an admin lists teams
    Then only team orgs are returned with usage, members, and owner

  @teams-admin/detail @api
  Scenario: Admins read a team's detail
    Given a team org
    When an admin requests it
    Then its detail is returned

  @teams-admin/detail-not-found @api
  Scenario: A missing or personal org has no team detail
    Given a missing or personal org id
    When an admin requests team detail
    Then the API responds 404

  @teams-admin/entitlement-lifecycle @api
  Scenario: Admins grant, list, and revoke a team entitlement
    Given a team org
    When an admin grants, lists, and revokes a storage entitlement
    Then each step succeeds

  @teams-admin/update-entitlement @api
  Scenario: Admins update a team entitlement
    Given an existing admin grant
    When an admin updates its bytes
    Then the change is persisted

  @teams-admin/entitlement-guards @api
  Scenario: Team entitlement operations are guarded
    Given an unknown org or a non-admin caller
    When a team entitlement operation is attempted
    Then it responds 404 or 403 respectively
