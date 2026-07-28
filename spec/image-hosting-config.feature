Feature: Provider-backed image custom domains
  The site administrator configures one instance-wide provider. Workspace
  owners can bind image domains only after that provider has been tested.

  @image-hosting-config/default-disabled @api
  Scenario: No workspace config reports disabled
    Given an authenticated workspace owner
    And no image-hosting config row
    When the config is read
    Then the stable disabled response is returned

  @image-hosting-config/provider-not-ready
  Scenario: An untested provider cannot provision a domain
    Given a saved provider that has not passed its test
    When a workspace owner binds a custom domain
    Then the request is rejected

  @image-hosting-config/reject-app-host
  Scenario: The application host cannot be used as an image domain
    Given a ready provider
    When a workspace owner binds the application host
    Then the request is rejected

  @image-hosting-config/manual-binding @api
  Scenario: A manual binding exposes all DNS records and a challenge
    Given a ready self-managed provider with multiple DNS records
    When a workspace owner binds a custom domain
    Then every DNS record and a unique HTTP challenge path are returned

  @image-hosting-config/manual-verification @api
  Scenario: A matching inbound challenge verifies a manual domain
    Given a pending self-managed domain
    When its unique challenge path is requested through that domain
    Then the domain becomes verified

  @image-hosting-config/challenge-secret @api
  Scenario: A wrong challenge token is not revealed
    Given a pending self-managed domain
    When a different challenge token is requested
    Then the request returns not found

  @image-hosting-config/cloudflare-binding
  Scenario: Cloudflare hostname identity is persisted
    Given a ready Cloudflare for SaaS provider
    When a workspace owner binds a custom domain
    Then the Cloudflare Custom Hostname id is stored

  @image-hosting-config/cloudflare-refresh
  Scenario: Cloudflare DNS and TLS status is refreshed
    Given a pending Cloudflare Custom Hostname
    When Cloudflare reports it active
    Then the binding becomes verified

  @image-hosting-config/deprovision
  Scenario: Removing image hosting removes its provider binding
    Given a workspace with a Cloudflare Custom Hostname
    When image hosting is deleted
    Then the external Custom Hostname is removed
