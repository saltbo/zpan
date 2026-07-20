Feature: Site configuration
  The frontend reads one safe structured configuration document while admins
  edit fixed groups of site settings through dedicated endpoints.

  @system/public-config @api
  Scenario: Public site configuration has a stable safe structure
    Given an anonymous visitor
    When they request configz
    Then site identity, branding, effective auth settings, and service URLs are returned without secrets

  @system/settings-admin-only @api
  Scenario: Editable site settings are admin-only
    Given a non-admin
    When they request editable site settings
    Then access is denied and the generic Options API is unavailable

  @system/webdav-url @api
  Scenario: Configz publishes only a verified WebDAV domain
    Given an admin-configured Public URL with an unverified derived WebDAV domain
    When configz is requested before and after an admin verifies that domain
    Then the WebDAV URL uses the path fallback first and the derived dav subdomain after verification

  @system/captcha-secret-private @api
  Scenario: Captcha is updated as a group without exposing its secret
    Given an admin
    When they configure and enable captcha
    Then admin settings report only whether a secret exists and configz exposes only public captcha fields

  @system/settings-validation @api
  Scenario: Site setting groups reject invalid values
    Given an admin
    When they submit invalid quota or captcha settings
    Then the request is rejected without a partial update

  @system/instance-info-admin-only @api
  Scenario: Instance info is admin-only
    Given the instance-info endpoint
    When a non-admin requests it
    Then access is denied

  @system/changelog-admin-only @api
  Scenario: Release version and changelog are admin-only
    Given the changelog endpoint
    When a non-admin requests it
    Then access is denied
