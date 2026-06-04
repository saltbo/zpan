package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateObjectUsesRenameConflictStrategy(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/objects" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		_ = json.NewEncoder(w).Encode(ObjectDraft{ID: "object-1", Name: "movie (1).mkv"})
	}))
	defer server.Close()

	_, err := New(server.URL, "token").CreateObject(context.Background(), "upload-token", "movie.mkv", 1024, "Downloads")
	if err != nil {
		t.Fatal(err)
	}
	if body["onConflict"] != "rename" {
		t.Fatalf("expected onConflict rename, got %#v", body["onConflict"])
	}
}

func TestConfirmObjectUsesRenameConflictStrategy(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/objects/object-1" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		_ = json.NewEncoder(w).Encode(ObjectDraft{ID: "object-1", Name: "movie (1).mkv"})
	}))
	defer server.Close()

	if err := New(server.URL, "token").ConfirmObject(context.Background(), "upload-token", "object-1"); err != nil {
		t.Fatal(err)
	}
	if body["action"] != "confirm" {
		t.Fatalf("expected confirm action, got %#v", body["action"])
	}
	if body["onConflict"] != "rename" {
		t.Fatalf("expected onConflict rename, got %#v", body["onConflict"])
	}
}
