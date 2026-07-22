import { downloadTaskEventSchema } from '@shared/schemas'
import type { DownloadTaskEvent } from '@shared/types'

export function parseDownloadTaskEvents(value: string): DownloadTaskEvent[] {
  return downloadTaskEventSchema.array().parse(JSON.parse(value))
}

export function downloadTaskEventTimestampSql(eventValue: string): string {
  return `CAST(json_extract(${eventValue}, '$.occurredAt') AS INTEGER)`
}

export function downloadTaskTerminalEventPredicate(eventValue: string): string {
  return `json_type(${eventValue}, '$.type') = 'text'
    AND json_extract(${eventValue}, '$.type') = 'status_changed'
    AND json_type(${eventValue}, '$.occurredAt') = 'integer'
    AND json_extract(${eventValue}, '$.occurredAt') >= 0
    AND json_type(${eventValue}, '$.attempt') = 'integer'
    AND json_extract(${eventValue}, '$.attempt') >= 1
    AND json_type(${eventValue}, '$.to') = 'text'
    AND json_extract(${eventValue}, '$.to') IN ('completed', 'failed', 'canceled')
    AND json_type(${eventValue}, '$.category') = 'text'
    AND length(json_extract(${eventValue}, '$.category')) > 0`
}

export function validDownloadTaskEventPredicate(eventValue: string): string {
  return `COALESCE((
    json_type(${eventValue}, '$.type') = 'text'
    AND json_extract(${eventValue}, '$.type') IN (
      'status_changed', 'error_reported', 'cleanup_requested', 'cleanup_completed'
    )
    AND json_type(${eventValue}, '$.id') = 'text'
    AND length(json_extract(${eventValue}, '$.id')) > 0
    AND json_type(${eventValue}, '$.occurredAt') = 'integer'
    AND json_extract(${eventValue}, '$.occurredAt') >= 0
    AND json_type(${eventValue}, '$.attempt') = 'integer'
    AND json_extract(${eventValue}, '$.attempt') >= 1
    AND json_type(${eventValue}, '$.category') = 'text'
    AND length(json_extract(${eventValue}, '$.category')) > 0
    AND COALESCE(json_type(${eventValue}, '$.downloaderId') IN ('text', 'null'), 0) = 1
    AND COALESCE(json_type(${eventValue}, '$.transferredBytes') IN ('integer', 'null'), 0) = 1
    AND COALESCE(json_extract(${eventValue}, '$.transferredBytes') >= 0, 1)
    AND json_type(${eventValue}, '$.billedBytes') = 'integer'
    AND json_extract(${eventValue}, '$.billedBytes') >= 0
    AND COALESCE(json_type(${eventValue}, '$.errorCode') IN ('text', 'null'), 0) = 1
    AND COALESCE(json_type(${eventValue}, '$.errorMessage') IN ('text', 'null'), 0) = 1
    AND COALESCE(json_type(${eventValue}, '$.reason') IN ('text', 'null'), 0) = 1
    AND COALESCE(length(json_extract(${eventValue}, '$.reason')) > 0, 1)
    AND (
      (
        json_extract(${eventValue}, '$.type') = 'status_changed'
        AND COALESCE(
          json_type(${eventValue}, '$.from') = 'null'
          OR (
            json_type(${eventValue}, '$.from') = 'text'
            AND json_extract(${eventValue}, '$.from') IN (
              'queued', 'assigned', 'downloading', 'suspended', 'pausing', 'paused',
              'interrupted', 'uploading', 'canceling', 'completed', 'failed', 'canceled'
            )
          ),
          0
        ) = 1
        AND json_type(${eventValue}, '$.to') = 'text'
        AND json_extract(${eventValue}, '$.to') IN (
          'queued', 'assigned', 'downloading', 'suspended', 'pausing', 'paused',
          'interrupted', 'uploading', 'canceling', 'completed', 'failed', 'canceled'
        )
      )
      OR (
        json_extract(${eventValue}, '$.type') = 'error_reported'
        AND json_type(${eventValue}, '$.errorMessage') = 'text'
        AND length(json_extract(${eventValue}, '$.errorMessage')) > 0
      )
      OR json_extract(${eventValue}, '$.type') IN ('cleanup_requested', 'cleanup_completed')
    )
  ), 0) = 1`
}
