Feature: License administration
  Admins pair the instance with Cloud (device-style code + poll), which stores a
  signed binding certificate; they can refresh the binding and unbind. All
  endpoints are admin-only and validate the certificate's signing key.

  @licensing-admin/auth-required @api
  Scenario: License admin endpoints require authentication
    Given an unauthenticated request
    When it calls a licensing admin endpoint
    Then the API responds 401

  @licensing-admin/admin-only @api
  Scenario: License admin endpoints require an admin
    Given a non-admin user
    When they initiate pairing
    Then the API responds 403

  @licensing-admin/pair-initiate @api
  Scenario: Pairing initiates against Cloud
    Given an admin
    When they start pairing
    Then Cloud is called and pairing info is returned

  @licensing-admin/poll-pending @api
  Scenario: Polling reports pending
    Given a pairing not yet approved
    When the admin polls
    Then a pending status is returned

  @licensing-admin/poll-approved @api
  Scenario: Polling stores the binding on approval
    Given a pairing approved by Cloud
    When the admin polls
    Then the binding is stored and approved is returned

  @licensing-admin/store-cert @api
  Scenario: The pairing certificate is stored on approval
    Given an approved pairing
    When the admin polls
    Then the certificate is persisted

  @licensing-admin/reject-invalid-cert @api
  Scenario: An invalid certificate is rejected
    Given an approved response with an invalid certificate
    When the admin polls
    Then it is rejected

  @licensing-admin/reject-missing-cert @api
  Scenario: A missing certificate is rejected
    Given an approved response with no certificate
    When the admin polls
    Then it is rejected

  @licensing-admin/untrusted-key-rollback @api
  Scenario: An untrusted signing key rolls back the binding
    Given an approved certificate signed by an untrusted key
    When the admin polls
    Then it reports untrusted and rolls back the orphaned Cloud binding

  @licensing-admin/refresh @api
  Scenario: Refresh succeeds for a bound instance
    Given an existing binding and Cloud responding OK
    When the admin refreshes
    Then it succeeds

  @licensing-admin/refresh-unbound @api
  Scenario: Refresh on an unbound instance is a no-op success
    Given no binding
    When the admin refreshes
    Then it returns success with a null last refresh time

  @licensing-admin/unbind @api
  Scenario: Unbinding deletes the binding
    Given an existing binding
    When the admin unbinds
    Then Cloud is told, the binding row is deleted, and deleted:true is returned

  @licensing-admin/unbind-cloud-fail @api
  Scenario: Unbinding clears local state even if Cloud fails
    Given Cloud unbind fails
    When the admin unbinds
    Then the local binding is still cleared

  @licensing-admin/unbind-idempotent @api
  Scenario: Unbinding with no binding still succeeds
    Given no binding
    When the admin unbinds
    Then deleted:true is returned
