Feature: Background jobs
  Long-running work (e.g. building download archives) runs as background jobs.
  Jobs are created via the API, dispatched to a queue, completed by a consumer,
  and listed/cancelled/retried by their owning org.

  @background-jobs/create-and-complete @api
  Scenario: A job is created and completed
    Given an authenticated user
    When they create an archive job
    Then the job is created and completed after the response

  @background-jobs/queue-dispatch @api
  Scenario: Jobs dispatch to the queue and a consumer completes them
    Given a queue binding is configured
    When an archive job is created
    Then it is dispatched to the queue and the consumer completes it

  @background-jobs/missing-target @api
  Scenario: A job for a missing target folder fails
    Given an explicit target folder that does not exist
    When an archive job is created
    Then a failed archive job is returned

  @background-jobs/target-is-file @api
  Scenario: A job whose target is a file fails
    Given an explicit target folder that points to a file
    When an archive job is created
    Then a failed archive job is returned

  @background-jobs/list-filter @api
  Scenario: Jobs are listed with filters and pagination
    Given an org's jobs of various status and type
    When they are listed with filters
    Then matching jobs are returned paginated

  @background-jobs/cross-org-guard @api
  Scenario: Jobs are isolated across orgs
    Given a job in another org
    When a user requests its detail
    Then access is rejected

  @background-jobs/cancel @api
  Scenario: Only queued or running jobs can be cancelled
    Given jobs in various states
    When a cancel is requested
    Then only queued or running jobs are cancelled

  @background-jobs/retry @api
  Scenario: Only failed retryable jobs are retried
    Given a failed retryable job
    When a retry is requested
    Then it is retried without hiding the original failure

  @background-jobs/error-surfacing @api
  Scenario: Non-domain errors surface at the route boundary
    Given a job whose processing throws a non-domain error
    When it is run
    Then the error surfaces at the route boundary
