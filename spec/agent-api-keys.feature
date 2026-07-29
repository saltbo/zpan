Feature: Agent API keys
  Workspace-scoped Agent API keys provide a CI and unattended-service credential
  path. Keys are owned by one authorizing user, bound to one workspace, grant only
  explicit Agent scopes, expire, and are revealed only once.

  @agent-api-keys/lifecycle @api
  Scenario: A user manages a personal workspace Agent API key
    Given an authenticated workspace editor
    When they create, list, rotate, and revoke an Agent API key
    Then the plaintext key is returned only on create or rotation
    And revoked keys stop working immediately

  @agent-api-keys/team-file-ops @api
  Scenario: A team Agent API key performs granted file operations
    Given a team workspace where the owner is an editor
    When they create an Agent API key with file read and create scopes
    Then the key can list files and create folders in that workspace

  @agent-api-keys/scope-boundary @api
  Scenario: Agent API keys cannot request non-Agent scopes
    Given an authenticated workspace editor
    When they request image-hosting or raw Better Auth Agent permissions
    Then the API rejects the key creation request

  @agent-api-keys/denials @api
  Scenario: Agent API keys fail closed
    Given a workspace Agent API key
    When the key is missing scope, crosses workspaces, is revoked, expires, or its owner is banned
    Then protected APIs reject the request

  @agent-api-keys/role-reduction @api
  Scenario: Agent API keys recheck current workspace role
    Given a team Agent API key created by an editor
    When the owner is reduced to viewer
    Then management and editor-only file operations are denied
