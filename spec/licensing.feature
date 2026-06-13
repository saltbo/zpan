Feature: Licensing
  An instance can be bound to a license that unlocks paid features. Binding state
  is read publicly; a cron endpoint periodically refreshes the cached certificate
  and syncs pending traffic reports to the cloud.

  @licensing/state-unbound @api
  Scenario: An unbound instance reports no binding
    Given no license binding row exists
    When the licensing state is read
    Then it reports bound:false

  @licensing/state-bound @api
  Scenario: A bound instance reports its plan and features
    Given a license binding with a cached certificate
    When the licensing state is read
    Then it reports bound:true with the plan and features

  @licensing/state-bound-no-cert @api
  Scenario: A bound instance with no cached cert reports binding only
    Given a license binding whose cached certificate is null
    When the licensing state is read
    Then it reports bound:true with no plan or features

  @licensing/public @api
  Scenario: Licensing state is public
    Given any instance
    When the licensing state is read without authentication
    Then it is still returned

  @licensing/refresh-auth @api
  Scenario: The refresh cron endpoint requires its secret
    Given the refresh cron endpoint
    When it is called without the matching cron secret
    Then the API responds 401

  @licensing/refresh-noop @api
  Scenario: Refreshing an unbound instance is a no-op success
    Given no license binding and the correct cron secret
    When the refresh cron endpoint is called
    Then it responds 200 ok without refreshing

  @licensing/refresh-runs @api
  Scenario: Refresh runs for a stale binding
    Given a binding whose last refresh is old and the correct cron secret
    When the refresh cron endpoint is called
    Then it refreshes the certificate and responds 200 ok

  @licensing/refresh-error-swallowed @api
  Scenario: A refresh failure never fails the cron
    Given a binding whose refresh throws
    When the refresh cron endpoint is called
    Then it still responds 200 ok

  @licensing/traffic-cron-public @api
  Scenario: The traffic-sync cron endpoint is reachable
    Given the dedicated traffic cron endpoint
    When it is called
    Then it is served without a user session

  @licensing/traffic-sync @api
  Scenario: The traffic cron syncs pending reports
    Given pending traffic reports and the correct cron secret
    When the traffic cron endpoint is called
    Then the pending reports are synced to the cloud

  @licensing/traffic-cron-secret @api
  Scenario: The traffic cron endpoint requires its secret
    Given the dedicated traffic cron endpoint
    When it is called without the cron secret
    Then the API responds 401
