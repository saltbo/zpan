package downloader

import (
	"context"
	"errors"
	"testing"
)

func TestCallAPIRetriesTransientErrors(t *testing.T) {
	attempts := 0

	err := callAPI(context.Background(), nil, "test", func(context.Context) error {
		attempts++
		if attempts < 3 {
			return errors.New("503 Service Unavailable")
		}
		return nil
	})

	if err != nil {
		t.Fatalf("expected retry to succeed, got %v", err)
	}
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
}

func TestCallAPIDoesNotRetryApplicationErrors(t *testing.T) {
	attempts := 0

	err := callAPI(context.Background(), nil, "test", func(context.Context) error {
		attempts++
		return errors.New("Task is paused")
	})

	if err == nil {
		t.Fatal("expected application error")
	}
	if attempts != 1 {
		t.Fatalf("expected 1 attempt, got %d", attempts)
	}
}
