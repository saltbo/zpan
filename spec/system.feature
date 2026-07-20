Feature: System options
  Admins manage instance-wide system options (public and private), default quota
  values, captcha, and read instance info + the release changelog.

  @system/webdav-url @api
  Scenario: The effective WebDAV URL is exposed as a read-only option
    Given the site Public URL
    When system options are listed or the WebDAV option is requested
    Then the effective URL is public and cannot be mutated through the options API

  @system/option-not-found @api
  Scenario: An unknown option key returns 404
    Given no option for a key
    When it is requested
    Then the API responds 404

  @system/admin-crud @api
  Scenario: Admins manage options through their lifecycle
    Given an admin
    When they create, read, update, and delete an option
    Then public/private visibility is honored throughout

  @system/mutations-require-admin @api
  Scenario: Option mutations require an admin
    Given an unauthenticated request
    When it mutates an option
    Then it is rejected

  @system/validate-org-quota @api
  Scenario: Default org quota values are validated
    Given an admin
    When they set an invalid default organization quota
    Then it is rejected

  @system/validate-traffic-quota @api
  Scenario: Default monthly traffic quota values are validated
    Given an admin
    When they set an invalid default monthly traffic quota
    Then it is rejected

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

  @system/captcha-secret-private @api
  Scenario: Captcha secret stays private and cannot be enabled prematurely
    Given an admin
    When they read captcha config or enable captcha before keys exist
    Then the secret stays private and premature enabling is rejected
