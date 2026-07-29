# Ordinary File Workflows

Use generated Restish OpenAPI commands for ordinary ZPan operations. Run
`restish api sync zpan` before relying on operation names from an older local
connection.

## List and Inspect

Use a reader-capable profile for browse and inspect operations:

```sh
restish --rsh-profile reader zpan listObjects --parent root --limit 50
restish --rsh-profile reader zpan getObject obj_123
restish --rsh-profile reader zpan getUserQuota
restish --rsh-profile reader zpan getStorageUsage
```

Keep list limits explicit and summarize IDs, names, paths, sizes, and relevant
URLs. Do not dump unbounded trees.

## Create Folders, Move, Copy, and Rename

Use `file-manager` for object mutations:

```sh
restish --rsh-profile file-manager zpan createObject --name releases --type folder --parent root --dirtype 1
restish --rsh-profile file-manager zpan updateObject obj_123 --name release.zip
restish --rsh-profile file-manager zpan transferObject obj_123 --parent folder_456
restish --rsh-profile file-manager zpan copyObject obj_123 --parent folder_456
```

Before writes, confirm the workspace and target folder. Before overwrite or
replace behavior, confirm the conflict policy.

## Delete and Purge

Soft delete requires `objects:delete`:

```sh
restish --rsh-profile file-manager zpan deleteObject obj_123
```

Confirm destructive intent before soft delete. Permanent trash purge is more
destructive and must be confirmed separately:

```sh
restish --rsh-profile file-manager zpan purgeTrashObject obj_123
```

Return deleted or purged object IDs and any quota effect reported by the API.

## Public Sharing

Use `publisher` for public shares:

```sh
restish --rsh-profile publisher zpan createShare --objectId obj_123
restish --rsh-profile publisher zpan listShares --limit 50
restish --rsh-profile publisher zpan revokeShare share_123
```

Confirm before creating public shares. Summaries may include share IDs, public
URLs, expiry, and revocation state, but should not include credentials.

## Tasks

Use generated task operations for status checks:

```sh
restish --rsh-profile file-manager zpan listDownloadTasks --limit 25
restish --rsh-profile file-manager zpan getDownloadTask task_123
restish --rsh-profile file-manager zpan listDownloadTaskEvents task_123 --limit 50
```

Summarize state, progress, and errors. Keep event output bounded.
