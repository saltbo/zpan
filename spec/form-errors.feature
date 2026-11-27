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
    When the server rejects the task
    Then its reason appears above the submit button and the dialog stays open

  @form-errors/team-invite @web
  Scenario: Inviting a team member with a bad email says so under the email
    Given a team admin opens the invite dialog
    When they send an invite to an invalid email address
    Then the email field shows its error under it and no invite is sent
    When the server rejects the invite
    Then its reason appears above the send button
