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

  @error-messages/catalog-complete @api
  Scenario: Every error message has its Chinese text
    Given the server's error messages
    Then each one has Chinese text with the same parameters
