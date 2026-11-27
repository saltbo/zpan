Feature: Language
  All visible text and every accessible name comes from the locale files, and
  English and Chinese are kept complete (UX.md, Language).

  @language/complete-locales
  Scenario: English and Chinese carry the same strings
    Given the English and Chinese locale files
    Then every key in one exists in the other with a non-empty value

  @language/accessible-names @web
  Scenario: Icon controls are named in the chosen language
    Given a signed-in user who chose 中文
    When they open their files and the admin forms
    Then the list and grid view toggles, the notifications button, and the help buttons are named in Chinese
    And the "Powered by ZPan" footer reads in Chinese

  @language/error-fallbacks @web
  Scenario: Client-side error messages follow the chosen language
    Given a signed-in user who chose 中文
    When an upload to storage fails, or a team invite link or invitation list cannot be loaded
    Then the message in the upload panel or the toast reads in Chinese

  @language/no-hard-coded-strings
  Scenario: New hard-coded strings are rejected
    Given a component with a string literal in an aria-label, a toast, JSX text, or an error message
    When the project lint runs
    Then it fails and points at the literal
