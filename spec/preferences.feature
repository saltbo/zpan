Feature: Preferences
  Language and theme can be changed on every page. Signed in, they sit in the
  account menu; a page that needs no session carries them itself, because a
  visitor decides there whether the site is usable for them (UX.md, Navigation and
  global controls).

  @preferences/sessionless-controls @e2e
  Scenario: Pages without a session offer language and theme
    Given a visitor who is not signed in
    When they open sign-in, sign-up, forgot password, reset password, a share, or a public profile
    Then the page offers a language menu and a theme menu
    And choosing 中文 there turns the page Chinese

  @preferences/theme-choices @web
  Scenario: Theme offers system, light, and dark wherever it appears
    Given the theme control on a page without a session, or in the account menu
    Then it offers system, light, and dark, with the current choice marked
    And picking one applies it
