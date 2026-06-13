Feature: WebDAV
  Users mount their drive over WebDAV (Class 2) using an API key via Basic Auth.
  The endpoint speaks PROPFIND/PROPPATCH/GET/PUT/MKCOL/MOVE/COPY/DELETE/LOCK/UNLOCK,
  scoped to the user's org, metering served traffic and enforcing quota + locks.

  @webdav/auth @api
  Scenario: WebDAV requires a valid API key
    Given missing or insufficient API keys and a session cookie
    When a WebDAV request is made
    Then it is rejected and the session cookie is not accepted

  @webdav/auth-key-scope @api
  Scenario: Org-bound image-hosting keys are rejected
    Given an org-bound image-hosting API key
    When it is used for WebDAV Basic Auth
    Then it is rejected

  @webdav/propfind @api
  Scenario: PROPFIND lists the hierarchy
    Given a mounted drive
    When PROPFIND is issued
    Then the mount root, workspace root, and folder children are listed

  @webdav/propfind-workspaces @api
  Scenario: PROPFIND hides non-member workspaces
    Given several workspaces
    When PROPFIND lists the mount root
    Then only member workspaces are shown

  @webdav/propfind-modes @api
  Scenario: PROPFIND supports its query modes
    Given a resource
    When PROPFIND uses prop, propname, allprop, and explicit depths
    Then each mode is honored and depth infinity is rejected

  @webdav/proppatch @api
  Scenario: PROPPATCH manages dead properties
    Given a resource
    When dead properties are set and removed via PROPPATCH
    Then later PROPFIND reflects the change

  @webdav/get @api
  Scenario: GET and HEAD serve a file
    Given a file
    When GET and HEAD are issued
    Then GET returns bytes and HEAD returns coherent headers

  @webdav/get-traffic @api
  Scenario: GET meters traffic, HEAD does not
    Given a file
    When GET and HEAD are issued
    Then only GET consumes WebDAV traffic

  @webdav/get-range @api
  Scenario: GET supports byte ranges
    Given a file
    When a range request is made
    Then valid ranges are served and invalid ranges rejected

  @webdav/etag-preconditions @api
  Scenario: GET honors ETag preconditions
    Given a file
    When conditional requests use ETag
    Then preconditions are honored and the ETag changes after overwrite

  @webdav/options @api
  Scenario: OPTIONS advertises DAV methods
    Given the endpoint
    When OPTIONS is issued
    Then the supported DAV methods are advertised

  @webdav/put-create @api
  Scenario: PUT creates a file
    Given a writable path
    When PUT writes bytes
    Then a file matter is created through the configured storage

  @webdav/put-update @api
  Scenario: PUT updates a file and rejects collection writes
    Given an existing file and a collection
    When PUT targets each
    Then the file is updated and the collection write is rejected

  @webdav/put-rollback @api
  Scenario: A failed PUT rolls back its quota reservation
    Given a storage write that fails
    When PUT is attempted
    Then the quota reservation is rolled back

  @webdav/mkcol @api
  Scenario: MKCOL creates a folder
    Given a writable parent
    When MKCOL is issued
    Then a folder matter is created

  @webdav/mkcol-guards @api
  Scenario: MKCOL guards existing targets and missing parents
    Given an existing target or a missing parent
    When MKCOL is issued
    Then it is rejected

  @webdav/org-scope @api
  Scenario: Mutations stay within org scope and DELETE trashes
    Given resources across orgs
    When MOVE, COPY, and DELETE are issued
    Then they stay within the org and DELETE trashes instead of purging

  @webdav/copy-recursive @api
  Scenario: COPY recurses and rejects copying into a descendant
    Given a collection
    When COPY is issued
    Then it copies recursively and rejects copying into its own descendant

  @webdav/move-descendants @api
  Scenario: MOVE keeps descendant paths consistent
    Given a collection
    When MOVE is issued
    Then descendant paths stay consistent and descendant moves are rejected

  @webdav/move-overwrite @api
  Scenario: MOVE honors the Overwrite header
    Given an existing destination
    When MOVE is issued with Overwrite
    Then the header is honored

  @webdav/copy-rollback @api
  Scenario: A failed COPY rolls back its quota reservation
    Given a storage copy that fails
    When COPY is attempted
    Then the quota reservation is rolled back

  @webdav/lock-preconditions @api
  Scenario: Write methods enforce If and lock preconditions
    Given a locked resource
    When a write method is issued
    Then If and lock preconditions are enforced before mutation

  @webdav/lock-unlock @api
  Scenario: LOCK and UNLOCK manage Class 2 locks
    Given a resource
    When LOCK and UNLOCK are issued
    Then Class 2 lock state is exposed and write tokens enforced

  @webdav/path-validation @api
  Scenario: Malformed paths are rejected
    Given a path with traversal, empty segments, or encoded separators
    When any method is issued
    Then it is rejected
