Feature: Licensing
  An instance can be bound to a license that unlocks paid features. Binding state
  is available to administrators, authenticated users receive a minimal entitlement
  projection, and scheduler run resources refresh certificates and sync traffic.

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

  @licensing/entitlements-auth @api
  Scenario: License entitlements require authentication
    Given any instance
    When license entitlements are read without authentication
    Then the API responds 401

  @licensing/refresh-auth @api
  Scenario: A licensing refresh run requires scheduler authorization
    Given the licensing refresh run resource
    When a run is created without the matching bearer token
    Then the API responds 401

  @licensing/refresh-noop @api
  Scenario: Refreshing an unbound instance is a no-op success
    Given no license binding and the correct scheduler bearer token
    When a licensing refresh run is created
    Then it responds 200 ok without refreshing

  @licensing/refresh-runs @api
  Scenario: Refresh runs for a stale binding
    Given a binding whose last refresh is old and the correct scheduler bearer token
    When a licensing refresh run is created
    Then it refreshes the certificate and responds 200 ok

  @licensing/refresh-error-swallowed @api
  Scenario: A refresh failure never fails the cron
    Given a binding whose refresh throws
    When a licensing refresh run is created
    Then it still responds 200 ok

  @licensing/traffic-cron-public @api
  Scenario: The traffic sync run resource is reachable
    Given the traffic sync run resource
    When a run is created with scheduler authorization
    Then it is served without a user session

  @licensing/traffic-sync @api
  Scenario: A traffic sync run syncs pending reports
    Given pending traffic reports and the correct scheduler bearer token
    When a traffic sync run is created
    Then the pending reports are synced to the cloud

  @licensing/traffic-cron-secret @api
  Scenario: A traffic sync run requires scheduler authorization
    Given the traffic sync run resource
    When a run is created without the scheduler bearer token
    Then the API responds 401
