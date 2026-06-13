Feature: Branding
  Pro instances customize their wordmark, theme colors, and logo (white-label).
  The public branding endpoint serves the active look without authentication.

  @branding/defaults @api
  Scenario: Unconfigured branding returns defaults
    Given no branding is configured
    When the public branding is requested
    Then default branding is returned

  @branding/public @api
  Scenario: Branding is public
    Given configured branding
    When it is requested without authentication
    Then it is still returned

  @branding/stored-values @api
  Scenario: Stored branding is served
    Given stored branding values
    When the public branding is requested
    Then the stored values are returned

  @branding/custom-theme @api
  Scenario: Custom theme colors are served
    Given stored custom theme colors
    When the public branding is requested
    Then the custom theme values are returned

  @branding/white-label-gated @api
  Scenario: White-label requires Pro
    Given an instance without the white_label feature
    When an admin updates branding
    Then the API responds 402

  @branding/multipart-required @api
  Scenario: Branding updates must be multipart
    Given an admin with Pro
    When they PUT a non-multipart body
    Then the API responds 415

  @branding/wordmark-length @api
  Scenario: Wordmark text is length-limited
    Given an admin with Pro
    When they submit a wordmark longer than 24 chars
    Then the API responds 422

  @branding/save-text @api
  Scenario: Wordmark and powered-by settings are saved
    Given an admin with Pro
    When they save wordmark text and hide-powered-by
    Then the settings are persisted

  @branding/builtin-theme @api
  Scenario: A built-in theme can be selected
    Given an admin with Pro
    When they select a built-in theme
    Then the theme is saved

  @branding/save-custom-theme @api
  Scenario: Valid custom theme colors are saved
    Given an admin with Pro
    When they save valid custom colors
    Then the colors are persisted

  @branding/invalid-colors @api
  Scenario: Invalid custom colors are rejected
    Given an admin with Pro
    When they submit invalid custom colors
    Then the API responds 422 and the stored theme is unchanged

  @branding/logo-upload @api
  Scenario: A logo is uploaded to S3
    Given an admin with Pro and a public storage
    When they upload a valid logo
    Then it is stored to S3 and its URL recorded

  @branding/logo-mime @api
  Scenario: Logo type is validated
    Given an admin with Pro
    When they upload an invalid logo type
    Then the API responds 400

  @branding/logo-size @api
  Scenario: Logo size is limited
    Given an admin with Pro
    When they upload a logo larger than 2MB
    Then the API responds 413

  @branding/logo-needs-storage @api
  Scenario: Logo upload needs a public storage
    Given no public storage
    When an admin uploads a logo
    Then the API responds 503

  @branding/admin-only @api
  Scenario: Only admins update branding
    Given a non-admin user
    When they update branding
    Then the API responds 403

  @branding/reset-field @api
  Scenario: A branding field can be reset
    Given stored branding
    When an admin resets a text field
    Then the field is cleared
