Feature: OAuth server
  ZPan exposes OAuth endpoints for delegated applications and agents.

  @oauth-server/idempotent-token-revocation @api
  Scenario: Revoking an inactive token is idempotent
    Given an authenticated OAuth client with an expired, revoked, or unknown token
    When the client submits the token to the revocation endpoint
    Then the endpoint returns success without revealing the token state

  @oauth-server/stable-context-id @api
  Scenario: Workspace Context identity survives a rename
    Given a connected user can discover a workspace
    When the workspace is renamed
    Then its authorization catalog entry keeps the same stable ID
    And its display label reflects the new name
