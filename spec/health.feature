Feature: Health
  The service exposes an unauthenticated health endpoint for liveness checks.

  @health/ok @api
  Scenario: The health endpoint reports liveness
    Given a running instance
    When the health endpoint is called
    Then it responds ok
