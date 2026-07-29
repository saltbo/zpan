# Ordinary File Workflows

Use generated Restish OpenAPI commands for ordinary ZPan operations. Run
`restish api sync zpan` before relying on operation names from an older local
connection.

## List and Inspect

Use a reader-capable profile for browse and inspect operations:

```sh
restish --rsh-profile reader zpan list-objects --parent root --page-size 50
restish --rsh-profile reader zpan get-object obj_123
restish --rsh-profile reader zpan get-user-quota user_123
restish --rsh-profile reader zpan get-storage-usage
```

Keep list limits explicit and summarize IDs, names, paths, sizes, and relevant
URLs. Do not dump unbounded trees.

## Create Folders, Move, Copy, and Rename

Use `file-manager` for object mutations:

```sh
restish --rsh-profile file-manager zpan create-object 'name: releases, parent: root, type: folder, dirtype: 1'
restish --rsh-profile file-manager zpan update-object obj_123 'name: release.zip, onConflict: fail'
restish --rsh-profile file-manager zpan transfer-object obj_123 'mode: move, targetOrgId: org_123, targetParent: folder_456'
restish --rsh-profile file-manager zpan copy-object obj_123 'parent: folder_456, onConflict: fail'
```

Before writes, confirm the workspace and target folder. Before overwrite or
replace behavior, confirm the conflict policy.

## Delete and Purge

Soft delete requires `objects:delete`:

```sh
restish --rsh-profile file-manager zpan delete-object obj_123
```

Confirm destructive intent before soft delete. Permanent trash purge is more
destructive, must be confirmed separately, and is outside the v2.9 Agent
OAuth/API-key profile templates because it requires `objects:purge` on an
authorized human/operator surface:

```sh
restish --rsh-profile operator zpan purge-trash-object obj_123
```

Do not instruct a `file-manager`, `publisher`, `reader`, or `ci` profile to
purge. Return deleted or purged object IDs and any quota effect reported by the
API.

## Public Sharing

Use `publisher` for public shares:

```sh
restish --rsh-profile publisher zpan create-share 'matterId: obj_123, kind: landing, private: false'
restish --rsh-profile publisher zpan list-shares --page-size 50
restish --rsh-profile publisher zpan revoke-share share_token_123 'status: revoked'
```

Confirm before creating public shares. Summaries may include share IDs, public
URLs, expiry, and revocation state, but should not include credentials.

## Tasks

Use generated task operations for status checks:

```sh
restish --rsh-profile file-manager zpan list-download-tasks --page-size 25
restish --rsh-profile file-manager zpan get-download-task task_123
restish --rsh-profile file-manager zpan list-download-task-events task_123
```

Summarize state, progress, and errors. Keep event output bounded.
