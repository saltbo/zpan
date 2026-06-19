package worker

import (
	"context"
	"fmt"
	"time"

	"github.com/saltbo/zpan/cmd/internal/client"
)

const apiRetryAttempts = 3

func (w *Worker) updateTask(ctx context.Context, id string, patch client.TaskPatch) (client.DownloadTask, error) {
	var task client.DownloadTask
	err := w.callAPI(ctx, "update task", func(ctx context.Context) error {
		var err error
		task, err = w.api.UpdateTask(ctx, id, patch)
		return err
	})
	return task, err
}

func (w *Worker) createFolder(ctx context.Context, token string, name string, parent string) (client.ObjectDraft, error) {
	var draft client.ObjectDraft
	err := w.callAPI(ctx, "create folder", func(ctx context.Context) error {
		var err error
		draft, err = w.api.CreateFolder(ctx, token, name, parent)
		return err
	})
	return draft, err
}

func (w *Worker) createObject(ctx context.Context, token string, name string, size int64, parent string) (client.ObjectDraft, error) {
	var draft client.ObjectDraft
	err := w.callAPI(ctx, "create object", func(ctx context.Context) error {
		var err error
		draft, err = w.api.CreateObject(ctx, token, name, size, parent)
		return err
	})
	return draft, err
}

func (w *Worker) completeObjectUpload(ctx context.Context, token string, id string, sessionID string, parts []client.CompletedObjectUploadPart) error {
	return w.callAPI(ctx, "complete upload", func(ctx context.Context) error {
		return w.api.CompleteObjectUpload(ctx, token, id, sessionID, parts)
	})
}

func (w *Worker) abortObjectUploadSession(ctx context.Context, token string, id string, sessionID string) error {
	return w.callAPI(ctx, "abort multipart upload session", func(ctx context.Context) error {
		return w.api.AbortObjectUploadSession(ctx, token, id, sessionID)
	})
}

func (w *Worker) callAPI(ctx context.Context, operation string, call func(context.Context) error) error {
	var last error
	for attempt := 1; attempt <= apiRetryAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := call(ctx); err != nil {
			last = err
			if attempt == apiRetryAttempts || !isRetryableAPIError(err) {
				return err
			}
			delay := time.Duration(attempt) * 500 * time.Millisecond
			w.logger.Warn("retrying downloader api call", "operation", operation, "attempt", attempt, "delay", delay.String(), "error", err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}
			continue
		}
		return nil
	}
	return fmt.Errorf("%s failed: %w", operation, last)
}

func isRetryableAPIError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return containsAny(message,
		"connection refused",
		"connection reset",
		"connection is shut down",
		"timeout",
		"temporary failure",
		"Too Many Requests",
		"Bad Gateway",
		"Service Unavailable",
		"Gateway Timeout",
	)
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if needle != "" && contains(value, needle) {
			return true
		}
	}
	return false
}

func contains(value string, needle string) bool {
	if len(needle) > len(value) {
		return false
	}
	for i := 0; i <= len(value)-len(needle); i++ {
		if value[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
