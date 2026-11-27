Feature: Form errors
  A form says what is wrong where it is wrong: a field's error appears under the
  field, and an error that belongs to the whole form, such as a rejected request,
  appears above the submit button (UX.md, Forms). The form stays open with what the
  user typed, so they can correct it.

  @form-errors/api-key @web
  Scenario: Creating an API key without a name or workspace says which field is missing
    Given a signed-in user opens the create API key dialog
    When they submit with a blank name or without choosing a workspace
    Then the missing field shows its error under it
    And no key is created

  @form-errors/download-task @web
  Scenario: Creating a download with a bad link says so under the link
    Given a signed-in user opens the new download dialog
    When they submit a link that does not fit the chosen source type
    Then the link field shows its error under it and no task is created
    When the server rejects the link, such as a private address
    Then the server's message appears under the link field
    When the server rejects the task for another reason
    Then its reason appears above the submit button and the dialog stays open

  @form-errors/team-invite @web
  Scenario: Inviting a team member with a bad email says so under the email
    Given a team admin opens the invite dialog
    When they send an invite to an invalid email address
    Then the email field shows its error under it and no invite is sent
    When the server rejects the invite
    Then its reason appears above the send button

  @form-errors/admin-drawer @web
  Scenario: An admin form shows a value the server rejects under that value's field
    Given an admin opens a settings drawer, such as the image custom-domain provider
    When they save a value the server rejects, such as a CNAME record whose value is not a hostname
    Then the server's message appears under that field and the drawer stays open
    When the server rejects the save for a reason that names no field in the form
    Then its reason appears above the save button

  @form-errors/branding @web
  Scenario: A rejected branding save shows its reason under the logo, favicon or color it concerns
    Given an admin opens the branding drawer
    When the server rejects the save because of the logo, the favicon or a theme color
    Then the server's message appears under that field and the drawer stays open
    When the server rejects the save for a reason that names no field in the drawer
    Then its reason appears above the save button
