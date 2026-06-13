Feature: Username sign-up
  Users sign up with an optional username. When omitted, a username is generated
  from the email prefix; usernames are unique.

  @auth-username/signup-with-username @api
  Scenario: Sign-up stores a provided username
    Given a sign-up with a username
    When the account is created
    Then the username is stored on the user record

  @auth-username/signup-generates-username @api
  Scenario: Sign-up generates a username when omitted
    Given a sign-up without a username
    When the account is created
    Then a username is generated from the email prefix

  @auth-username/duplicate-rejected @api
  Scenario: Duplicate usernames are rejected
    Given an existing username
    When a sign-up reuses it
    Then a non-200 response is returned

  @auth-username/distinct-usernames @api
  Scenario: Distinct usernames register independently
    Given two sign-ups with different usernames
    When both are created
    Then both succeed
