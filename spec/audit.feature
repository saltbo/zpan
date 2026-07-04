Feature: Audit log
  Admins review a chronological audit log of activities across the orgs they
  administer. The log is a licensed feature, filterable and paginated.

  @audit/auth-required @api
  Scenario: The audit log requires authentication
    Given an unauthenticated request
    When it calls the audit log API
    Then the API responds 401

  @audit/admin-only @api
  Scenario: Non-admins cannot read the audit log
    Given an authenticated non-admin user
    When they call the audit log API
    Then the API responds 403

  @audit/feature-gated @api
  Scenario: The audit log requires the audit_log feature
    Given an admin whose instance lacks the audit_log feature
    When they read the audit log
    Then the API responds 402 feature_not_available

  @audit/empty @api
  Scenario: An instance with no activity has an empty log
    Given no recorded events
    When an admin reads the audit log
    Then an empty list is returned

  @audit/list-newest-first @api
  Scenario: Events are listed newest first
    Given recorded events across multiple orgs
    When an admin reads the audit log
    Then events are returned newest first

  @audit/filter-org @api
  Scenario: Events can be filtered by org
    Given recorded events in several orgs
    When an admin filters by orgId
    Then only that org's events are returned

  @audit/filter-user @api
  Scenario: Events can be filtered by actor
    Given recorded events by several users
    When an admin filters by userId
    Then only that user's events are returned

  @audit/filter-action @api
  Scenario: Events can be filtered by action
    Given recorded events of several action types
    When an admin filters by action
    Then only events of that action are returned

  @audit/filter-action-created-range @api
  Scenario: Events can be filtered by action and creation time range
    Given recorded events of several action types across several creation times
    When an admin filters by action and created-at range
    Then only matching events within that range are returned

  @audit/filter-created-range-validation @api
  Scenario: Inverted audit creation time ranges are rejected
    Given an admin audit log request with createdFrom after createdTo
    When the admin reads the audit log
    Then the API responds 400 invalid_time_range

  @audit/filter-target-type @api
  Scenario: Events can be filtered by target type
    Given recorded events on several target types
    When an admin filters by targetType
    Then only events on that target type are returned

  @audit/pagination @api
  Scenario: The audit log paginates
    Given more events than one page
    When an admin requests a page
    Then the correct page and pageSize are returned

  @audit/actor-info @api
  Scenario: Events carry actor and org display info
    Given a recorded event
    When an admin reads the audit log
    Then each item includes the actor display info and org name
