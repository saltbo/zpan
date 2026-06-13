Feature: Shares
  Users share files/folders as landing shares (a public viewer page) or direct
  shares (a one-hop file link). Shares carry optional password, recipients, expiry,
  and download limits; recipients can save a share into their own drive.

  @shares/auth-required @api
  Scenario: Creating a share requires authentication
    Given an unauthenticated request
    When it creates a share
    Then the API responds 401

  @shares/create-landing @api
  Scenario: A landing share is created
    Given an authenticated user
    When they create a landing share without a password
    Then a 201 with the correct shape is returned

  @shares/create-password @api
  Scenario: A landing share can be password-protected
    Given an authenticated user
    When they create a landing share with a password
    Then the password hash is stored

  @shares/create-recipients @api
  Scenario: A landing share can name recipients
    Given an authenticated user
    When they create a landing share with recipients
    Then share-recipient rows are inserted

  @shares/create-direct @api
  Scenario: A direct share returns a direct URL
    Given a file
    When a direct share is created
    Then a direct URL is returned

  @shares/direct-no-folder @api
  Scenario: Direct shares cannot target a folder
    Given a folder
    When a direct share is created
    Then the API responds 400 DIRECT_NO_FOLDER

  @shares/direct-no-password @api
  Scenario: Direct shares cannot carry a password
    Given a direct share request with a password
    When it is created
    Then the API responds 400 DIRECT_NO_PASSWORD

  @shares/direct-no-recipients @api
  Scenario: Direct shares cannot name recipients
    Given a direct share request with recipients
    When it is created
    Then the API responds 400 DIRECT_NO_RECIPIENTS

  @shares/create-cross-org @api
  Scenario: A share's matter must belong to the org
    Given a matterId from another org
    When a share is created
    Then the API responds 404

  @shares/create-expiry @api
  Scenario: A share can carry an expiry
    Given an expiresAt in the request
    When the share is created
    Then the expiry is stored

  @shares/create-download-limit @api
  Scenario: A share can carry a download limit
    Given a downloadLimit in the request
    When the share is created
    Then the limit is stored

  @shares/create-notify-best-effort @api
  Scenario: Share creation succeeds even if notification fails
    Given share-created notification dispatch rejects
    When a share is created
    Then a 201 is still returned

  @shares/list-empty @api
  Scenario: A new user has no shares
    Given a user with no shares
    When they list shares
    Then an empty list is returned

  @shares/list-pagination @api
  Scenario: Shares list with pagination fields
    Given several shares
    When they are listed
    Then pagination fields are returned

  @shares/list-isolation @api
  Scenario: Users only see their own shares
    Given shares owned by another user
    When a user lists shares
    Then the other user's shares are not returned

  @shares/list-filter-status @api
  Scenario: Shares filter by status
    Given shares of various statuses
    When listed with status=active
    Then only active shares are returned

  @shares/detail-creator @api
  Scenario: The creator sees full share detail
    Given a share viewed by its creator
    When the detail is requested
    Then recipients and creator-only fields are included

  @shares/detail-non-creator @api
  Scenario: Non-creators see a reduced landing view
    Given a landing share viewed by a non-creator
    When the detail is requested
    Then recipients and internal ids are hidden

  @shares/detail-not-found @api
  Scenario: An unknown share token is not found
    Given a non-existent token
    When the detail is requested
    Then the API responds 404

  @shares/no-self-view-count @api
  Scenario: The creator does not inflate view counts
    Given the creator viewing their own share
    When the detail is requested
    Then the view count does not increment

  @shares/save-direct-forbidden @api
  Scenario: Direct shares cannot be saved to drive
    Given a direct share
    When a save-to-drive is attempted
    Then the API responds 400 DIRECT_SAVE_FORBIDDEN

  @shares/save-trashed-gone @api
  Scenario: A trashed shared matter is gone
    Given a share whose matter was trashed
    When a save is attempted
    Then the API responds 410

  @shares/save-to-drive @api
  Scenario: A landing share is saved to the user's drive
    Given a landing share
    When a recipient saves it to their personal drive
    Then a 201 is returned

  @shares/save-quota-exceeded @api
  Scenario: Saving over quota is refused
    Given an exhausted target-org quota
    When a share is saved
    Then the API responds 400 QUOTA_EXCEEDED

  @shares/save-target-permission @api
  Scenario: Saving to a team org requires membership
    Given a non-personal target org where the user has no member role
    When a share is saved there
    Then the API responds 403

  @shares/save-recipient-bypass @api
  Scenario: A listed recipient can save a password share
    Given a password-protected share and a listed recipient
    When they save it
    Then it is allowed

  @shares/save-cookie-bypass @api
  Scenario: A valid share-token cookie unlocks a password share
    Given a non-recipient with a valid sharetk cookie
    When they save a password-protected share
    Then the password wall is bypassed

  @shares/save-viewer-forbidden @api
  Scenario: A viewer role cannot save into the org
    Given a user with a viewer role in the target org
    When they save a share there
    Then the API responds 403

  @shares/delete @api
  Scenario: A creator revokes their share
    Given a creator's share
    When they delete it
    Then its status becomes revoked

  @shares/delete-non-creator @api
  Scenario: Non-creators cannot delete a share
    Given a share owned by someone else
    When a non-creator deletes it
    Then the API responds 403

  @shares/received-list @api
  Scenario: Users see shares addressed to them
    Given shares addressed by id and by email
    When the received list is requested
    Then matching shares are returned and unrelated ones hidden

  @shares/received-excludes-revoked @api
  Scenario: Revoked shares drop off the received list
    Given a revoked share addressed to the user
    When the received list is requested
    Then it is excluded
