Feature: Public redirects
  Short links resolve public assets: a direct-share token (ds_) streams a shared
  file, and an image-hosting token (ih_) serves a hosted image. Both meter traffic
  quota (refunding on failure) and enforce the image referer allowlist.

  @redirect/direct-share @api
  Scenario: A valid direct-share link redirects to the file
    Given a valid ds_ token
    When the link is followed
    Then it 302-redirects with attachment disposition and no-store cache

  @redirect/unknown-ds-token @api
  Scenario: An unknown direct-share token is not found
    Given an unknown ds_ token
    When the link is followed
    Then the API responds 404

  @redirect/landing-token-rejected @api
  Scenario: A landing-share token is not a direct link
    Given a landing share token at the direct-link path
    When it is followed
    Then the API responds 404

  @redirect/ds-quota-exhausted @api
  Scenario: A direct share over traffic quota is refused
    Given an exhausted direct-share traffic quota
    When the link is followed
    Then the API responds 422

  @redirect/ds-consumes-quota @api
  Scenario: A successful direct share consumes traffic quota
    Given a valid ds_ token within quota
    When the link is followed
    Then traffic quota is consumed

  @redirect/ds-refund-on-failure @api
  Scenario: A failed direct-share signing refunds traffic
    Given direct-share signing fails
    When the link is followed
    Then traffic and download count are refunded

  @redirect/image @api
  Scenario: A valid image link serves the image
    Given a valid ih_ token for an active image
    When the link is followed
    Then it 302-redirects with inline disposition and no-store cache

  @redirect/image-strip-ext @api
  Scenario: Image links resolve regardless of extension
    Given an image link with a file extension
    When the link is followed
    Then the extension is stripped and the same image resolves

  @redirect/unknown-ih-token @api
  Scenario: An unknown image token is not found
    Given an unknown ih_ token
    When the link is followed
    Then the API responds 404

  @redirect/image-draft-hidden @api
  Scenario: Draft images are not served
    Given an image with draft status
    When its link is followed
    Then the API responds 404

  @redirect/image-access-count @api
  Scenario: A served image increments its access count
    Given a valid image link
    When it is followed successfully
    Then the access count increments by one

  @redirect/image-consumes-quota @api
  Scenario: A served image consumes traffic quota
    Given a valid image link within quota
    When it is followed
    Then traffic quota is consumed

  @redirect/image-refund-on-failure @api
  Scenario: A failed image signing refunds traffic
    Given image signing fails
    When the link is followed
    Then traffic is refunded

  @redirect/image-quota-boundary @api
  Scenario: Image redirects stop at the quota boundary
    Given the first redirect consumes the remaining monthly traffic
    When the next image redirect is attempted
    Then it is refused

  @redirect/no-count-on-404 @api
  Scenario: A 404 does not increment access count
    Given a missing image
    When its link is followed
    Then the access count is unchanged

  @redirect/referer-empty-allowlist @api
  Scenario: An empty allowlist permits any referer
    Given an empty referer allowlist
    When an image link is followed from any referer
    Then it is allowed

  @redirect/referer-match @api
  Scenario: A matching referer is allowed
    Given a referer matching the allowlist
    When the image link is followed
    Then it is allowed

  @redirect/referer-missing-ok @api
  Scenario: A missing referer is allowed
    Given no referer (direct access)
    When the image link is followed
    Then it is allowed

  @redirect/referer-mismatch @api
  Scenario: A foreign referer is blocked
    Given a referer from a different origin
    When the image link is followed
    Then the API responds 403

  @redirect/referer-subdomain @api
  Scenario: Referer matching requires an exact origin
    Given a referer from a subdomain of an allowed origin
    When the image link is followed
    Then the API responds 403

  @redirect/no-count-on-403 @api
  Scenario: A blocked referer does not increment access count
    Given a blocked referer
    When the image link is followed
    Then the access count is unchanged
