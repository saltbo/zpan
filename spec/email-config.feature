Feature: Email configuration
  Admins configure the outbound email provider (SMTP, HTTP API, or Cloudflare).
  Secrets are masked on read; a test endpoint verifies delivery.

  @email-config/auth-required @api
  Scenario: Reading email config requires authentication
    Given an unauthenticated request
    When it reads the email config
    Then the API responds 401

  @email-config/admin-only @api
  Scenario: Only admins read email config
    Given a non-admin user
    When they read the email config
    Then the API responds 403

  @email-config/empty-state @api
  Scenario: No config returns a disabled empty state
    Given no email config exists
    When an admin reads it
    Then a disabled empty state is returned

  @email-config/incomplete-provider @api
  Scenario: Enabled but incomplete config reports a null provider
    Given email is enabled but sender/provider are incomplete
    When an admin reads it
    Then it returns enabled with a null provider

  @email-config/mask-smtp @api
  Scenario: SMTP secrets are masked on read
    Given a saved SMTP config
    When an admin reads it
    Then the SMTP secrets are masked

  @email-config/mask-http @api
  Scenario: HTTP-provider secrets are masked on read
    Given a saved HTTP-provider config
    When an admin reads it
    Then the secrets are masked

  @email-config/save-smtp @api
  Scenario: SMTP config is saved
    Given an admin
    When they save an SMTP config
    Then it succeeds and persists

  @email-config/save-http @api
  Scenario: HTTP-provider config is saved
    Given an admin
    When they save an HTTP-provider config
    Then it succeeds and persists

  @email-config/save-cloudflare @api
  Scenario: Cloudflare config is saved
    Given an admin
    When they save a Cloudflare config
    Then it succeeds and persists

  @email-config/invalid-provider @api
  Scenario: An invalid provider value is rejected
    Given an admin
    When they save an invalid provider value
    Then the API responds 400

  @email-config/invalid-from @api
  Scenario: An invalid from-address is rejected
    Given an admin
    When they save an invalid from email
    Then the API responds 400

  @email-config/update @api
  Scenario: Saving again updates the config
    Given an existing email config
    When an admin PUTs it again
    Then the config is updated

  @email-config/persist-disabled @api
  Scenario: Disabled state persists even with provider config
    Given a provider config and email disabled
    When an admin saves it
    Then the disabled state persists

  @email-config/test-success @api
  Scenario: The test endpoint reports success
    Given a working email config
    When an admin sends a test email
    Then it reports success

  @email-config/test-failure @api
  Scenario: The test endpoint reports a send failure
    Given an email config whose send fails
    When an admin sends a test email
    Then the API responds 400 with the error

  @email-config/test-no-config @api
  Scenario: Testing with no config fails
    Given no email config
    When an admin sends a test email
    Then the API responds 400
