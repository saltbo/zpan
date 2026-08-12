Feature: OAuth server
  ZPan exposes OAuth endpoints for delegated applications and agents.

  @oauth-server/idempotent-token-revocation @api
  Scenario: Revoking an inactive token is idempotent
    Given an authenticated OAuth client with an expired, revoked, or unknown token
    When the client submits the token to the revocation endpoint
    Then the endpoint returns success without revealing the token state
