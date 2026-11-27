Feature: List pagination
  Lists page over the shared cursor (UX.md, Lists; docs/design/list-pagination-realtime.md).
  Admin tables step with previous and next and a page-size choice; user-facing
  lists load the next page as the user scrolls to the end. Neither shows page
  numbers or a total, which would need a count on every query.

  @list-pagination/admin-tables @web
  Scenario: Admin tables page with previous, next, and a page size
    Given an admin opens users, audit, a user's or team's activity, site invitations, teams, invite codes, or storage cleanup
    And the table holds more rows than one page
    When the admin chooses next, then previous
    Then the table shows the following page, then the first page again
    And no page number or total is shown
    And next is disabled on the last page and previous on the first

  @list-pagination/page-size @web
  Scenario: Changing the page size or a filter returns to the first page
    Given an admin on the second page of an admin table
    When the admin changes the page size, a filter, the sort, or the search
    Then the table shows the first page of the new view

  @list-pagination/empty-later-page @web
  Scenario: A later page that empties returns to the page before
    Given an admin on a page after the first of an admin table
    When the last row on that page is deleted
    Then the table shows the page before it instead of an empty page

  @list-pagination/invite-codes-beyond-first-page @web
  Scenario: Every invite code is reachable
    Given a site that has generated more invite codes than one page
    When an admin pages through Admin → Settings → Invite codes
    Then every code can be seen and an unused one deleted

  @list-pagination/scroll @web
  Scenario: The user directory and team activity load on scroll
    Given the user directory or a team's activity holds more than one page
    When the user scrolls to the end of the list
    Then the next page is appended without a button or page controls

  @list-pagination/user-search @api
  Scenario: The admin user list searches on the server
    Given users whose name, email, or username contain a term
    When an admin lists users with that term
    Then only matching users are returned, newest first, across every page

  @list-pagination/directory-search @web
  Scenario: The user directory searches every user, not only loaded rows
    Given the user directory holds more users than its first page
    And a user who is not on the first page
    When the admin searches for that user
    Then the directory asks the server for the term and shows that user
    And the table stays in place while the new results load
