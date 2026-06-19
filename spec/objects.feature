Feature: Objects
  Files and folders ("matters") are the core entity. Creating a file returns
  size-decided upload instructions; the client PUTs each slice directly to S3,
  reads the ETags, and completes the upload. Clients browse/rename/move, soft-delete
  to trash and restore, permanently purge, copy, and transfer across spaces — with
  name-conflict resolution and quota enforcement throughout.

  @objects/auth-required @api
  Scenario: Object access requires authentication
    Given an unauthenticated request
    When it calls the objects API
    Then the API responds 401

  @objects/list-empty @api
  Scenario: A new drive lists nothing
    Given a user with no objects
    When they list objects
    Then an empty list is returned

  @objects/list-pagination @api
  Scenario: Object listing paginates
    Given many objects
    When they are listed with pagination params
    Then the requested page is returned

  @objects/list-by-parent @api
  Scenario: Objects filter by parent folder
    Given nested folders
    When listing filters by parent
    Then only that parent's children are returned

  @objects/list-live-only @api
  Scenario: Listing returns live objects only
    Given live and trashed objects
    When objects are listed
    Then only live (non-trashed) objects are returned

  @objects/create-folder @api
  Scenario: A folder is created
    Given an authenticated user
    When they create a folder
    Then the folder is created

  @objects/create-invalid @api
  Scenario: Invalid create input is rejected
    Given invalid object input
    When it is posted
    Then the API responds 400

  @objects/create-no-storage @api
  Scenario: Creating a file needs a storage
    Given no storage is available
    When a file object is created
    Then the API responds 500

  @objects/create-file-presign @api
  Scenario: Creating a file returns upload instructions
    Given a configured storage
    When a file object is created
    Then a draft with upload instructions (part size + presigned URLs) is returned

  @objects/create-file-too-large @api
  Scenario: Creating an oversized file is rejected
    Given a file larger than the 5 TiB maximum
    When the file object is created
    Then the API responds 400

  @objects/detail @api
  Scenario: An object's detail is returned
    Given an existing object
    When its detail is requested
    Then the detail is returned

  @objects/detail-missing @api
  Scenario: A missing object detail is 404
    Given a missing object id
    When its detail is requested
    Then the API responds 404

  @objects/rename @api
  Scenario: An object is renamed
    Given an existing object
    When it is renamed
    Then the new name is persisted

  @objects/move @api
  Scenario: An object is moved
    Given an existing object
    When it is moved to a new parent
    Then its location is updated

  @objects/complete-upload @api
  Scenario: An upload is completed
    Given a draft object whose slices were uploaded to S3
    When the upload is completed with the part ETags
    Then the object becomes live

  @objects/complete-etag-mismatch @api
  Scenario: Completing with a mismatched ETag is rejected
    Given a draft single-PutObject upload
    When it is completed with an ETag that does not match the stored object
    Then the API responds 409

  @objects/abort-upload @api
  Scenario: An upload is aborted
    Given a draft object with an open upload session
    When the upload is aborted
    Then the draft is discarded and its S3 upload is cleaned up

  @objects/trash @api
  Scenario: A file is soft-deleted to trash
    Given a live file
    When it is deleted
    Then it moves to trash (trashedAt is set)

  @objects/trash-cascade @api
  Scenario: Trashing a folder cascades to children
    Given a folder with children
    When it is trashed
    Then its children are trashed too

  @objects/restore @api
  Scenario: A trashed file is restored
    Given a trashed file
    When it is restored
    Then it becomes active again

  @objects/list-trashed @api
  Scenario: Trashed roots list under their active parents
    Given trashed objects under active parents
    When trashed objects are listed
    Then trashed folder roots are returned nested under active parents

  @objects/purge-folder @api
  Scenario: A trashed folder is permanently deleted
    Given a trashed folder
    When it is permanently deleted
    Then it is removed

  @objects/purge-file-s3 @api
  Scenario: Purging a trashed file cleans up S3
    Given a trashed file
    When it is permanently deleted
    Then it is removed and its S3 object deleted

  @objects/get-trashed @api
  Scenario: A trashed object's detail is returned from the trash
    Given a trashed object
    When its trash detail is requested
    Then the trashed object is returned

  @objects/download-url @api
  Scenario: A file detail returns a download URL
    Given a file
    When its detail is requested
    Then a download URL is returned

  @objects/download-traffic @api
  Scenario: Downloads report Cloud traffic for bound instances
    Given a bound instance
    When a file download URL is requested
    Then Cloud traffic is reported before returning the URL

  @objects/copy-file @api
  Scenario: A file is copied
    Given a file
    When it is copied
    Then a new file is created from the source via S3

  @objects/copy-folder @api
  Scenario: A folder is copied
    Given a folder
    When it is copied
    Then the folder tree is duplicated

  @objects/create-conflict @api
  Scenario: A duplicate folder name conflicts
    Given an existing folder name
    When a folder with the same name is created
    Then the API responds 409 NAME_CONFLICT

  @objects/create-conflict-rename @api
  Scenario: onConflict=rename auto-renames on create
    Given an existing folder name
    When a folder is created with onConflict=rename
    Then it succeeds with an auto-renamed folder

  @objects/rename-conflict @api
  Scenario: Renaming into a taken name conflicts
    Given a sibling with the target name
    When an object is renamed to it
    Then the API responds 409 NAME_CONFLICT

  @objects/move-conflict @api
  Scenario: Moving into a collision conflicts
    Given a destination with a colliding name
    When an object is moved without onConflict
    Then the API responds 409

  @objects/restore-conflict @api
  Scenario: Restoring into a taken name conflicts
    Given a trashed object whose name is now taken
    When it is restored
    Then the API responds 409

  @objects/transfer-copy @api
  Scenario: A file copies into an editable team space
    Given a team space the user can edit
    When a file is copied into it
    Then the copy is created there

  @objects/transfer-move @api
  Scenario: A file moves into a team space
    Given a team space the user can edit
    When a file is moved into it
    Then the source is deleted and its quota released

  @objects/transfer-folder @api
  Scenario: A folder transfers recursively
    Given a folder
    When it is transferred into a target space
    Then it is copied recursively

  @objects/transfer-permission @api
  Scenario: Transfer requires target membership
    Given a team the user is not a member of
    When a transfer is attempted
    Then it is rejected

  @objects/transfer-quota @api
  Scenario: Transfer respects the target quota
    Given a target space whose quota is exceeded
    When a transfer is attempted
    Then it is rejected

  @objects/transfer-same-space @api
  Scenario: Transfer to the same space is rejected
    Given a source and target that are the same space
    When a transfer is attempted
    Then it is rejected
