Feature: Auth providers
  Admins configure social/OIDC login providers. The public list exposes only
  enabled providers without secrets; admin reads mask the client secret. The free
  plan caps the provider count.

  @auth-providers/public-enabled-only @api
  Scenario: The public list shows only enabled providers
    Given a mix of enabled and disabled providers
    When the public provider list is requested
    Then only enabled providers are returned

  @auth-providers/public-no-secret @api
  Scenario: The public list never exposes secrets
    Given a configured provider
    When the public list is requested
    Then no client secret is included

  @auth-providers/metadata @api
  Scenario: Providers carry display name and icon
    Given a known provider
    When the public list is requested
    Then its display name and icon come from provider metadata

  @auth-providers/oidc-fallback @api
  Scenario: Unknown OIDC providers fall back to their id
    Given an unknown OIDC provider
    When the public list is requested
    Then the providerId is used as name and icon

  @auth-providers/admin-only @api
  Scenario: Only admins manage providers
    Given a non-admin user
    When they call the admin providers API
    Then the API responds 403

  @auth-providers/admin-list-all @api
  Scenario: Admins see all providers including disabled
    Given enabled and disabled providers
    When an admin lists them
    Then all configs are returned

  @auth-providers/mask-secret @api
  Scenario: Admin reads mask the client secret
    Given a provider with a client secret
    When an admin reads it
    Then only the last four characters are visible

  @auth-providers/mask-short-secret @api
  Scenario: Short secrets are fully masked
    Given a provider with a short secret
    When an admin reads it
    Then the secret is entirely masked

  @auth-providers/create-builtin @api
  Scenario: Admins create a built-in provider
    Given an admin
    When they create a built-in provider
    Then it is created with its secret masked in the response

  @auth-providers/create-oidc @api
  Scenario: Admins create an OIDC provider
    Given an admin
    When they create an OIDC provider with a discovery URL
    Then it is created

  @auth-providers/free-limit @api
  Scenario: The free plan caps providers
    Given one provider on the free plan
    When an admin creates a second
    Then the API responds 402

  @auth-providers/unlimited-entitlement @api
  Scenario: The unlimited entitlement lifts the cap
    Given the social_login_unlimited entitlement
    When an admin creates additional providers
    Then they are allowed

  @auth-providers/update-not-limited @api
  Scenario: Updating the only provider is not capped
    Given a single provider on the free plan
    When an admin updates it
    Then the free limit does not block the update

  @auth-providers/update @api
  Scenario: Admins update a provider
    Given an existing provider
    When an admin PUTs it again
    Then it is updated

  @auth-providers/unknown-builtin @api
  Scenario: Unknown built-in ids are rejected
    Given an admin
    When they create an unknown built-in provider id
    Then the API responds 400

  @auth-providers/oidc-missing-discovery @api
  Scenario: OIDC without a discovery URL is rejected
    Given an admin
    When they create an OIDC provider with no discoveryUrl
    Then the API responds 400
