Feature: Teams
  Users own a personal org and may belong to shared team orgs. Owners issue invite
  links; invitees join via token. Each org exposes an activity feed to its members.

  @teams/invite-info-public @api
  Scenario: Invite info is readable without authentication
    Given a valid invite token
    When the invite info is requested without auth
    Then the invite info is returned

  @teams/create-invite @api
  Scenario: An owner creates an invite link
    Given an authenticated team owner
    When they create an invite link
    Then a 201 with the invite token is returned

  @teams/list-pending-empty @api
  Scenario: A team with no pending invitations lists none
    Given a team with no pending invitations
    When its owner lists invitations
    Then an empty list is returned

  @teams/join @api
  Scenario: A user joins a team with a valid token
    Given a valid invite token
    When an authenticated user joins
    Then they become a member of the team

  @teams/join-already-member @api
  Scenario: Joining a team twice is rejected
    Given a user who is already a member
    When they join again with a valid token
    Then the API responds 409

  @teams/access-non-member @api
  Scenario: Non-members cannot access a team org
    Given an authenticated user who is not a member of a non-personal org
    When they access that org
    Then the API responds 403

  @teams/access-personal-public @api
  Scenario: Personal orgs are visible to any authenticated user
    Given any authenticated user
    When they access a personal org
    Then the API responds 200

  @teams/access-team-member @api
  Scenario: Team members can access their team org
    Given a member of a non-personal team org
    When they access that org
    Then the API responds 200

  @teams/activity-feed @api
  Scenario: An org exposes its activity feed
    Given an org with recorded activity events
    When a member reads the activity feed
    Then activity items with actor info are returned

  @teams/activity-newest-first @api
  Scenario: Activity is ordered newest first
    Given several activity events
    When a member reads the activity feed
    Then items are ordered newest first

  @teams/activity-pagination @api
  Scenario: The activity feed pages through a cursor
    Given more activity events than one page
    When a member requests a page and then follows its next page token
    Then each page holds at most pageSize events, newest first, with none repeated or skipped

  @teams/delete-purges-space @api
  Scenario: Deleting a team purges everything its space held
    Given a team with files, image hostings, quota grants, download tasks, background jobs, shares and invitations
    When its owner deletes the team
    Then its files and images are purged and their stored objects released, freeing the storage they used
    And its quota, quota grants, invitations, invite links and WebDAV state are removed
    And its download tasks are deleted and its active background jobs canceled
    And another space's data is unchanged

  @teams/delete-purge-resumes @api
  Scenario: A team purge cut short is finished later
    Given a deleted team whose space was not fully purged
    When the daily trash sweep runs
    Then the team's remaining files and quota are purged
    And a space that was never deleted as a team is left alone
