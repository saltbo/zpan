# 2. Matters record the download task that created them

Status: accepted (2026-11-27). Delivered in #710.

## Decision

A matter created with a download task's upload token stores that task's id in `matters.created_by_task_id`. A task's token may delete a file only when that column names its own task. The delete purges the file instead of trashing it. A task's token never deletes a folder.

## Why

- One downloader runs several tasks at once, so the creator device and the time of assignment cannot tell two tasks apart. Only the task id can.
- A file a failed task uploaded was never handed to the user. In the trash it would still count against their quota.
- Another task may have joined a folder this task created. Trashing the folder would trash that task's files too.

## Consequences

- A failed upload leaves its folders behind, possibly empty.
- Files created before the column existed have no task id, so no task token can delete them.
- `PUT /api/objects/{id}/metadata/media` still decides ownership by device and assignment time. #711 tracks moving it to the task id.
