package downloader

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

const apiRetryAttempts = 3

func callAPI(ctx context.Context, logger *slog.Logger, operation string, call func(context.Context) error) error {
	if logger == nil {
		logger = slog.Default()
	}
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
			logger.Warn("retrying downloader api call", "operation", operation, "attempt", attempt, "delay", delay.String(), "error", err)
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
		if needle != "" && strings.Contains(value, needle) {
			return true
		}
	}
	return false
}
