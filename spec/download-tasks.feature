Feature: Remote download tasks
  Users queue remote downloads (HTTP/magnet) that external downloader agents claim
  via device login, run, and upload back through the standard object-upload API.
  Tasks are assigned by heartbeat/capacity; the free plan caps downloader count.

  @download-tasks/register-downloader @api
  Scenario: A downloader registers via device login
    Given a device-login flow
    When a downloader registers
    Then it is registered through BetterAuth device login

  @download-tasks/ssrf-guard @api
  Scenario: Internal-host source URLs are rejected
    Given a source URL targeting an internal host
    When a download task is created
    Then it is rejected

  @download-tasks/magnet-validation @api
  Scenario: Non-magnet magnet tasks are rejected
    Given a magnet task whose URI is not a magnet link
    When it is created
    Then it is rejected

  @download-tasks/delete-downloader-requeues @api
  Scenario: Deleting a downloader requeues its tasks
    Given a downloader with unfinished tasks
    When it is deleted
    Then its unfinished tasks return to the queue

  @download-tasks/stale-no-assign @api
  Scenario: Stale downloaders get no new tasks
    Given a downloader with a stale heartbeat
    When tasks are assigned
    Then it receives no new tasks

  @download-tasks/capacity-queue @api
  Scenario: Tasks stay queued when downloaders are full
    Given matching downloaders at capacity
    When tasks await assignment
    Then they remain queued

  @download-tasks/stale-offline @api
  Scenario: Stale downloaders show offline
    Given a downloader with a stale heartbeat
    When an admin lists downloaders
    Then it is reported offline

  @download-tasks/reassign-on-heartbeat @api
  Scenario: Live heartbeat reassigns stale tasks
    Given unfinished tasks on a stale downloader
    When a live heartbeat arrives
    Then the tasks are reassigned

  @download-tasks/stale-resolves-canceling @api
  Scenario: Stale downloader's canceling task settles to canceled
    Given a canceling task on a stale downloader
    When stale recovery runs
    Then the task settles to canceled

  @download-tasks/billing-suspend-gate @api
  Scenario: A task with no credits is suspended before downloading
    Given a downloader with credit billing and no remaining credits
    When it marks an assigned task downloading
    Then the task is suspended with a reason and no bytes are pulled

  @download-tasks/upload-flow @api
  Scenario: A completed remote download uploads via the object API
    Given an assigned task
    When the downloader uploads the result
    Then it flows through the standard object upload API

  @download-tasks/cloud-usage-idempotency @api
  Scenario: Cloud usage ids differ from local idempotency keys
    Given a remote download usage event
    When it is recorded
    Then Cloud usage event ids may differ from local idempotency keys

  @download-tasks/runtime-reports @api
  Scenario: Runtime reports snapshot while progress stays patchable
    Given a running downloader
    When it reports runtime state
    Then reports are stored as snapshots and progress remains patchable

  @download-tasks/upload-session-failure @api
  Scenario: Upload session creation failures are surfaced
    Given multipart upload session creation fails
    When the downloader uploads
    Then the storage failure details are returned

  @download-tasks/upload-completion-failure @api
  Scenario: Upload completion failures are surfaced
    Given multipart upload completion fails
    When the downloader completes upload
    Then the storage failure details are returned

  @download-tasks/normalize-target @api
  Scenario: Target folder paths are normalized
    Given a download task with a target folder
    When it is created
    Then the target folder path is normalized

  @download-tasks/user-actions @api
  Scenario: User actions reach the downloader via polling
    Given a running task
    When the user submits an action
    Then it is delivered through the downloader polling state

  @download-tasks/recover-interrupted @api
  Scenario: Downloaders recover interrupted tasks but not user-paused ones
    Given interrupted and user-paused tasks
    When the assigned downloader recovers
    Then interrupted tasks resume but user-paused tasks do not

  @download-tasks/checkpoint-on-retry @api
  Scenario: Upload retries preserve the download checkpoint
    Given an upload failure after download completed
    When the upload is retried
    Then the completed download checkpoint is preserved

  @download-tasks/transitional-actions @api
  Scenario: Pause and cancel use transitional states
    Given a downloading task
    When it is paused or cancelled
    Then transitional states are used

  @download-tasks/reject-invalid-pause @api
  Scenario: Pause is rejected for billing-paused and uploading tasks
    Given a billing-paused or uploading task
    When pause is requested
    Then it is rejected

  @download-tasks/reject-invalid-action @api
  Scenario: Invalid task actions are rejected
    Given a task
    When an invalid action is requested
    Then it is rejected

  @download-tasks/sort-filter @api
  Scenario: Tasks sort and filter server-side
    Given many tasks
    When they are listed with sort and filter
    Then the server returns them sorted and filtered

  @download-tasks/free-limit @api
  Scenario: The free plan caps downloaders
    Given one downloader on the free plan
    When a second registers
    Then the API responds 402

  @download-tasks/unlimited-entitlement @api
  Scenario: The unlimited entitlement lifts the downloader cap
    Given the downloaders_unlimited entitlement
    When additional downloaders register
    Then they are allowed
