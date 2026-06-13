Feature: Image hosting configuration
  Org admins enable image hosting and optionally bind a custom domain. Reads are
  open to members; writes are admin-only. A custom domain is verified lazily via
  Cloudflare custom hostnames, exposing DNS instructions until verified.

  @image-hosting-config/read-any-member @api
  Scenario: Any member can read the config
    Given an org member
    When they read the image-hosting config
    Then it is returned

  @image-hosting-config/write-requires-admin @api
  Scenario: Only admins can change the config
    Given a non-admin role
    When they PUT or DELETE the config
    Then the API responds 403

  @image-hosting-config/default-disabled @api
  Scenario: No config reports disabled
    Given no config row
    When the config is read
    Then it reports enabled:false

  @image-hosting-config/no-domain @api
  Scenario: Without a custom domain there are no DNS instructions
    Given a config with no custom domain
    When it is read
    Then domainStatus is none and dnsInstructions is null

  @image-hosting-config/domain-verified @api
  Scenario: A verified domain reports verified
    Given a domain whose verification timestamp is set
    When the config is read
    Then domainStatus is verified

  @image-hosting-config/referer-allowlist @api
  Scenario: The referer allowlist is parsed
    Given a stored referer allowlist
    When the config is read
    Then the allowlist is returned as an array

  @image-hosting-config/no-recheck-verified @api
  Scenario: A verified domain is not re-checked
    Given an already-verified domain
    When the config is read
    Then Cloudflare is not called

  @image-hosting-config/lazy-verify @api
  Scenario: A pending domain verifies lazily when active
    Given a pending domain that Cloudflare now reports active
    When the config is read
    Then the domain is marked verified

  @image-hosting-config/stays-pending @api
  Scenario: A domain stays pending while Cloudflare is non-active
    Given a pending domain that Cloudflare reports non-active
    When the config is read
    Then it stays pending

  @image-hosting-config/dns-cname @api
  Scenario: DNS instructions use CNAME when Cloudflare is configured
    Given Cloudflare custom hostnames configured
    When the config with a domain is read
    Then dnsInstructions use recordType CNAME

  @image-hosting-config/dns-manual @api
  Scenario: DNS instructions are manual without Cloudflare
    Given Cloudflare is not configured
    When the config with a domain is read
    Then dnsInstructions use recordType manual

  @image-hosting-config/create @api
  Scenario: Enabling creates a config row
    Given an admin
    When they enable image hosting with no domain
    Then a config row is created

  @image-hosting-config/cf-register @api
  Scenario: A custom domain registers with Cloudflare
    Given Cloudflare configured
    When an admin sets a custom domain
    Then Cloudflare register is called and the hostname id stored

  @image-hosting-config/domain-change @api
  Scenario: Changing the domain re-registers
    Given an existing custom domain
    When the admin changes it
    Then Cloudflare delete then register is called

  @image-hosting-config/cf-conflict @api
  Scenario: A Cloudflare registration conflict surfaces
    Given Cloudflare returns a 409 conflict
    When an admin sets a custom domain
    Then the API responds 409

  @image-hosting-config/disable-via-delete @api
  Scenario: Disabling must use DELETE
    Given an admin
    When they PUT enabled=false
    Then the API responds 400

  @image-hosting-config/reject-app-host @api
  Scenario: The custom domain cannot be the app host
    Given an admin
    When they set a custom domain equal to the app host
    Then the API responds 400
