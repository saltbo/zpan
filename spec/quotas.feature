Feature: Quotas
  Every org has a storage + monthly-traffic quota. Admins inspect all org quotas;
  each user reads their own effective quota (base allowance plus active license
  entitlements).

  @quotas/admin-auth-required @api
  Scenario: The admin quota listing requires authentication
    Given an unauthenticated request
    When it calls the admin quotas API
    Then the API responds 401

  @quotas/admin-only @api
  Scenario: Non-admins cannot list org quotas
    Given an authenticated non-admin user
    When they call the admin quotas API
    Then the API responds 403

  @quotas/default-row @api
  Scenario: A default quota row exists from signup
    Given a freshly signed-up org
    When an admin lists quotas
    Then the default quota row created at signup is returned

  @quotas/normalizes-stale-period @api
  Scenario: A stale monthly traffic period is normalized in the response only
    Given a quota whose monthly traffic period has rolled over
    When an admin reads it
    Then the response shows the current period without writing to the database

  @quotas/list-with-org @api
  Scenario: Quotas are listed with their org info
    Given configured org quotas
    When an admin lists quotas
    Then each quota is returned with its org metadata

  @quotas/effective-with-entitlements @api
  Scenario: Effective quota includes active entitlements
    Given an org with active license entitlements
    When an admin lists effective quotas
    Then the listed quota reflects the base allowance plus active entitlements

  @quotas/plan-labels @api
  Scenario: Effective quota exposes plan and extra-quota labels
    Given an org with an active plan and extra quota
    When an admin lists effective quotas
    Then the active plan and extra-quota labels are exposed

  @quotas/me-auth-required @api
  Scenario: Reading my own quota requires authentication
    Given an unauthenticated request
    When it calls the personal quota API
    Then the API responds 401

  @quotas/me-default @api
  Scenario: My quota falls back to the built-in default
    Given no default-quota system option is set
    When an authenticated user reads their quota
    Then the built-in 10MB default is returned

  @quotas/me-no-org @api
  Scenario: A user with no org has no quota
    Given an authenticated user with no org
    When they read their quota
    Then the API responds 404

  @quotas/me-effective @api
  Scenario: My quota includes my active entitlements
    Given an authenticated user whose org has active entitlements
    When they read their quota
    Then the base quota plus active entitlements and labels are returned
