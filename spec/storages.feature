Feature: Storages
  Admins configure S3-compatible storage backends. Uploads later flow directly to
  the selected backend via presigned URLs.

  @storages/auth-required @api
  Scenario: Storage management requires an authenticated admin
    Given an unauthenticated request
    When it calls the admin storages API
    Then the API responds 401

  @storages/admin-only @api
  Scenario: Non-admins cannot manage storages
    Given an authenticated non-admin user
    When they call the admin storages API
    Then the API responds 403

  @storages/list @api
  Scenario: Admins list configured storages
    Given configured storages
    When an admin lists storages
    Then every configured storage is returned

  @storages/create @api
  Scenario: Admins create a storage
    Given an authenticated admin
    When they POST a valid storage config
    Then the storage is created and returned

  @storages/community-limit @api
  Scenario: The Community edition caps the number of storages
    Given the Community storage limit is reached and storages_unlimited is not licensed
    When an admin creates another storage
    Then the API responds 402 feature_not_available

  @storages/detail @api
  Scenario: Admins read a single storage
    Given an existing storage
    When an admin requests it by id
    Then its detail is returned

  @storages/update @api
  Scenario: Admins update a storage
    Given an existing storage
    When an admin updates its fields
    Then the changes are persisted

  @storages/delete @api
  Scenario: Admins delete an unused storage
    Given an existing storage referenced by no files
    When an admin deletes it
    Then it is removed

  @storages/delete-in-use @api
  Scenario: A storage referenced by files cannot be deleted
    Given a storage referenced by existing files
    When an admin deletes it
    Then the API responds 409

  @storages/select-active @api
  Scenario: Uploads pick an active storage with available capacity
    Given several configured storages
    When the platform selects a storage
    Then it returns the oldest active one below capacity and skips full or disabled ones
