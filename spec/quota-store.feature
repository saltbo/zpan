Feature: Quota Store
  Pro instances bound to Cloud sell storage/traffic packages and subscriptions.
  Checkout and credit calls proxy to Cloud; a signed quota-change webhook delivers
  entitlements back, adjusting org quota idempotently with an audit trail.

  @quota-store/requires-binding @api
  Scenario: Store endpoints are hidden until Cloud is bound
    Given an instance not bound to Cloud
    When the self-service store endpoints are called
    Then they are hidden

  @quota-store/feature-gated @api
  Scenario: The quota webhook requires the quota_store feature
    Given an instance without Pro quota_store
    When a quota-change webhook arrives
    Then the API responds 402

  @quota-store/checkout-return-origin @api
  Scenario: Checkout return URLs use the detected site origin
    Given a configured site origin
    When a checkout is created
    Then the return URL uses the site origin

  @quota-store/checkout-origin-antispoof @api
  Scenario: Spoofed forwarded origins are ignored for return URLs
    Given a spoofed or non-https forwarded origin
    When a checkout is created
    Then the forwarded origin is ignored

  @quota-store/checkout-access @api
  Scenario: Checkout is restricted to accessible orgs
    Given a target org the user cannot access
    When they start checkout
    Then it is rejected

  @quota-store/team-checkout-owner-only @api
  Scenario: Team checkout is owner-only
    Given a non-owner team member
    When they start team checkout
    Then it is rejected

  @quota-store/team-checkout @api
  Scenario: A team owner checks out for the team
    Given a team owner
    When they start team checkout
    Then it targets the team org

  @quota-store/no-double-plan @api
  Scenario: A workspace cannot hold two active plans
    Given a workspace with an active plan
    When a recurring checkout is started
    Then it is rejected

  @quota-store/fixed-checkout @api
  Scenario: Fixed-duration packages check out without credit discounts
    Given a fixed-duration package
    When checkout is created
    Then no credit discount fields are included

  @quota-store/subscription-portal @api
  Scenario: A subscription portal opens for the active plan
    Given an active workspace plan
    When the portal is requested
    Then a subscription portal is created

  @quota-store/list-packages @api
  Scenario: Purchasable packages and orders are listed
    Given a bound instance
    When the store is queried
    Then packages, targets, checkout, and orders are returned

  @quota-store/checkout-currency-guard @api
  Scenario: Client-supplied currency is rejected
    Given a checkout request carrying currency fields
    When it is submitted
    Then it is rejected before proxying to Cloud

  @quota-store/credit-balance @api
  Scenario: Credit balance and gift-card redemption proxy to Cloud
    Given a bound instance
    When credit balance or gift-card redemption is requested
    Then it is proxied through the credit endpoints

  @quota-store/credit-ledger @api
  Scenario: The credit ledger proxies to Cloud
    Given a bound instance
    When credit ledger entries are requested
    Then they are proxied through the credit endpoints

  @quota-store/order-continue-cancel @api
  Scenario: Orders can continue payment or cancel
    Given an order
    When payment is continued or the order cancelled
    Then it is proxied through Cloud

  @quota-store/order-org-scope @api
  Scenario: Order actions are org-scoped
    Given an order belonging to another org
    When payment continuation or cancellation is attempted
    Then it is rejected

  @quota-store/checkout-error-surfacing @api
  Scenario: Cloud checkout errors are surfaced
    Given Cloud returns a checkout error
    When checkout is attempted
    Then the error is surfaced

  @quota-store/webhook-auth-required @api
  Scenario: The quota webhook requires authentication
    Given a quota-change webhook with no auth
    When it arrives
    Then it is rejected

  @quota-store/webhook-token-expiry @api
  Scenario: Expired webhook tokens are rejected
    Given an expired webhook event token
    When the webhook arrives
    Then it is rejected

  @quota-store/webhook-token-audience @api
  Scenario: Webhook tokens must target this instance
    Given a webhook token with the wrong audience
    When it arrives
    Then it is rejected

  @quota-store/webhook-rejects-commerce @api
  Scenario: Commerce-only events are rejected on the quota webhook
    Given a credit-only commerce fulfillment event
    When it hits the quota webhook
    Then it is rejected

  @quota-store/webhook-records-entitlement @api
  Scenario: A valid webhook records an entitlement once with audit
    Given a valid quota-change webhook
    When it is delivered
    Then the active entitlement is recorded once and audited

  @quota-store/webhook-subscription-delivery @api
  Scenario: Subscriptions deliver storage and traffic entitlements
    Given an initial subscription event
    When it is delivered
    Then storage and traffic entitlements are delivered under a stable source id

  @quota-store/webhook-renewal @api
  Scenario: Subscription renewals replace bytes and extend expiry
    Given a renewal event
    When it is delivered
    Then plan bytes are replaced and expiry extended

  @quota-store/webhook-accumulate @api
  Scenario: Repeated increases for one order accumulate
    Given repeated increase events for the same order and resource
    When they are delivered
    Then the entitlement bytes accumulate

  @quota-store/webhook-decrease @api
  Scenario: Decreases reduce accumulated bytes without revoking the remainder
    Given accumulated order entitlement bytes
    When a decrease is delivered
    Then the bytes decrease without revoking the remainder

  @quota-store/webhook-idempotent @api
  Scenario: Replayed decrease events are idempotent
    Given a decrease event already processed
    When the same event is replayed
    Then it does not double-deduct
