Feature: Error messages
  An API error's message is written once, on the server, for the person using the
  product, in the language of the request. The UI shows it as it is (UX.md, Feedback).
  The machine-readable reason and the status do not change with the language.

  @error-messages/request-language @api
  Scenario: A request in Chinese gets its error message in Chinese
    Given a request that asks for Chinese
    When it fails with a known error
    Then the error message is in Chinese
    And the status and reason are the same as for an English request

  @error-messages/english-default @api
  Scenario: A request that names no supported language gets English
    Given a request that asks for no language, or only for unsupported ones
    When it fails with a known error
    Then the error message is in English

  @error-messages/invalid-request @api
  Scenario: A request the API cannot accept gets a readable error
    Given a request whose body or parameters do not fit what the API accepts
    When the API rejects it
    Then the error has the same shape and status as every other invalid argument
    And its message is one short sentence in the request's language, not a list of checks
    And the error names the field that is wrong, when one is

  @error-messages/ui-language @web
  Scenario: The UI asks for the language it shows
    Given a user who has switched the UI to 中文
    When an action fails with a known error
    Then the toast shows the server's message in Chinese, as it is

  @error-messages/auth @api
  Scenario: Sign-in, sign-up, password reset, API-key and team errors follow the request language
    Given a request to the sign-in service that asks for Chinese
    When sign-in, sign-up, a password reset, an API-key action or a team action fails
    Then the error message is in Chinese, not an internal code
    And a sign-up the registration gate refuses names its reason, such as a missing invite code
    And the status and code are the same as for an English request

  @error-messages/catalog-complete @api
  Scenario: Every error message has its Chinese text
    Given the server's error messages, including every sign-in service error
    Then each one has Chinese text with the same parameters

  @error-messages/external-failure @api
  Scenario: A failure outside ZPan reaches the user as a product message
    Given a request that fails because of ZPan Cloud, a storage service or an email provider
    When the API answers with the error
    Then the message is a product sentence in the request's language, not a code or the service's own text
    And a code the service reported stays machine-readable as the error's reason
    And the service's own text appears only in the server log

  @error-messages/vary @api
  Scenario: A cache keeps each language's error message apart
    Given a request that fails with an error in the request's language
    When the API answers with the error
    Then the response says it varies by the request's language
    And it still says it varies by any other header it already did, such as the origin
