Feature: List state in the URL
  A list's search, filter, sort, and page size live in the URL, so back, reload, and
  a shared link restore the same view (UX.md, Lists). The position inside a cursor
  list is not in the link: page tokens expire and are bound to their query. Typing
  in a search field updates the link without adding a history entry for each
  keystroke.

  @list-state/admin-users @web
  Scenario: The admin user list restores its search and page size from the link
    Given an admin opens the user list with a search and a page size in the link
    Then the list shows that search and page size, from the first page
    When the admin searches or changes page size
    Then the link carries the new search and page size

  @list-state/users @web
  Scenario: The user directory restores its search from the link
    Given an admin opens the user directory with a search in the link
    Then the directory shows that search
    When the admin searches
    Then the link carries the new search

  @list-state/tasks @web
  Scenario: The task list restores its filter from the link
    Given a user opens their tasks with the failed filter in the link
    Then only failed tasks are listed
    When the user picks another filter
    Then the link carries that filter

  @list-state/downloads @web
  Scenario: The download list restores its filters from the link
    Given a user opens their downloads with a status, category, and tag in the link
    Then the list is filtered by them
    When the user changes or clears the filters
    Then the link carries the new filters

  @list-state/admin-storages @web
  Scenario: The admin storage list restores its filter, sort, and search from the link
    Given an admin opens storages with a filter, a sort, and a search in the link
    Then the list shows that filter, sort, and search
    When the admin changes any of them
    Then the link carries the new filter, sort, and search

  @list-state/unusable-values @web
  Scenario: A link with a value the list cannot use opens the default view
    Given a link whose list filter, sort, or page size is not one the list offers
    When a user opens it
    Then that value is ignored and the list opens with its default

  @list-state/search-typing @web
  Scenario: Typing quickly in a list's search keeps every character
    Given a list whose search lives in the link
    When a user types several characters in quick succession
    Then the search field and the link both hold the full text
    And going back to a link with another search shows that search in the field

  @list-state/refetch-keeps-layout @web
  Scenario: Changing a list's filter keeps the page in place while it loads
    Given a user has a list open with its rows loaded
    When the user picks another filter
    Then the page header, the filter bar, and the previous rows stay on screen
    And the previous rows are shown dimmed until the new rows arrive
    But opening the list for the first time shows the loading state in its place
