package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
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
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ObjectDraft{ID: "object-1", Name: "movie (1).mkv"})
	}))
	defer server.Close()

	_, err := mustClient(t, server.URL, "token").CreateObject(context.Background(), "upload-token", "movie.mkv", 1024, "Downloads")
	if err != nil {
		t.Fatal(err)
	}
	if body["onConflict"] != "rename" {
		t.Fatalf("expected onConflict rename, got %#v", body["onConflict"])
	}
}

func TestAssignedTasksFetchesRecoverableStatuses(t *testing.T) {
	var statuses []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/download-tasks" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		status := r.URL.Query().Get("status")
		statuses = append(statuses, status)
		_ = json.NewEncoder(w).Encode(Page[DownloadTask]{
			Items: []DownloadTask{{ID: "task-" + status, Status: status, UploadToken: "upload-token"}},
		})
	}))
	defer server.Close()

	tasks, err := mustClient(t, server.URL, "token").AssignedTasks(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(statuses)
	expected := []string{"assigned", "downloading", "interrupted", "uploading"}
	if !reflect.DeepEqual(statuses, expected) {
		t.Fatalf("expected recoverable statuses %v, got %v", expected, statuses)
	}
	if len(tasks) != 4 {
		t.Fatalf("expected four tasks, got %d", len(tasks))
	}
}

func TestUpdateTaskUsesGeneratedRequestShape(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/api/download-tasks/task-1" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(DownloadTask{
			ID:                   "task-1",
			SourceType:           "http",
			SourceURI:            "https://example.com/file.bin",
			Name:                 "file.bin",
			TargetFolder:         "",
			Tags:                 []string{},
			Status:               "downloading",
			DownloadedBytes:      1024,
			StorageUploadedBytes: 0,
			DownloadBps:          10,
			StorageUploadBps:     0,
		})
	}))
	defer server.Close()

	downloadedBytes := int64(1024)
	totalBytes := int64(2048)
	etaSeconds := int64(30)
	task, err := mustClient(t, server.URL, "token").UpdateTask(context.Background(), "task-1", TaskPatch{
		Status:          "downloading",
		DownloadedBytes: &downloadedBytes,
		TotalBytes:      &totalBytes,
		Detail: &DownloadTaskDetail{
			Engine:     "builtin",
			Phase:      "downloading",
			ETASeconds: &etaSeconds,
			Files:      []DownloadTaskFile{{Path: "file.bin", Size: 2048, CompletedBytes: &downloadedBytes}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if task.ID != "task-1" || task.Status != "downloading" {
		t.Fatalf("unexpected task: %#v", task)
	}
	if body["status"] != "downloading" || body["downloadedBytes"] != float64(1024) || body["totalBytes"] != float64(2048) {
		t.Fatalf("unexpected patch body: %#v", body)
	}
	detail, ok := body["detail"].(map[string]any)
	if !ok || detail["engine"] != "builtin" || detail["phase"] != "downloading" || detail["etaSeconds"] != float64(30) {
		t.Fatalf("unexpected detail body: %#v", body["detail"])
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

	if err := mustClient(t, server.URL, "token").ConfirmObject(context.Background(), "upload-token", "object-1"); err != nil {
		t.Fatal(err)
	}
	if body["action"] != "confirm" {
		t.Fatalf("expected confirm action, got %#v", body["action"])
	}
	if body["onConflict"] != "rename" {
		t.Fatalf("expected onConflict rename, got %#v", body["onConflict"])
	}
}

func TestMultipartUploadSessionClientMethods(t *testing.T) {
	var createBody map[string]any
	var presignBody map[string]any
	var completeBody map[string]any
	var abortBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/objects/object-1/uploads":
			if err := json.NewDecoder(r.Body).Decode(&createBody); err != nil {
				t.Fatal(err)
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":        "session-1",
				"objectId":  "object-1",
				"uploadId":  "upload-1",
				"partSize":  67108864,
				"status":    "active",
				"expiresAt": "2026-06-05T00:00:00Z",
				"createdAt": "2026-06-04T00:00:00Z",
				"updatedAt": "2026-06-04T00:00:00Z",
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/objects/object-1/uploads/session-1/parts":
			if err := json.NewDecoder(r.Body).Decode(&presignBody); err != nil {
				t.Fatal(err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"uploadId": "upload-1",
				"partSize": 67108864,
				"parts": []map[string]any{
					{"partNumber": 1, "url": "https://s3/part-1"},
					{"partNumber": 2, "url": "https://s3/part-2"},
				},
			})
		case r.Method == http.MethodPatch && r.URL.Path == "/api/objects/object-1/uploads/session-1":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["action"] == "complete" {
				completeBody = body
			} else {
				abortBody = body
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":        "session-1",
				"objectId":  "object-1",
				"uploadId":  "upload-1",
				"partSize":  67108864,
				"status":    "completed",
				"expiresAt": "2026-06-05T00:00:00Z",
				"createdAt": "2026-06-04T00:00:00Z",
				"updatedAt": "2026-06-04T00:00:00Z",
			})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	api := mustClient(t, server.URL, "token")
	session, err := api.CreateObjectUploadSession(context.Background(), "upload-token", "object-1", 64*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	if session.ID != "session-1" || session.PartSize != 64*1024*1024 {
		t.Fatalf("unexpected session: %#v", session)
	}
	parts, err := api.PresignObjectUploadParts(context.Background(), "upload-token", "object-1", "session-1", []int{1, 2})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(parts, []PresignedObjectUploadPart{{PartNumber: 1, URL: "https://s3/part-1"}, {PartNumber: 2, URL: "https://s3/part-2"}}) {
		t.Fatalf("unexpected presigned parts: %#v", parts)
	}
	err = api.CompleteObjectUploadSession(context.Background(), "upload-token", "object-1", "session-1", []CompletedObjectUploadPart{{PartNumber: 1, ETag: `"etag-1"`}})
	if err != nil {
		t.Fatal(err)
	}
	err = api.AbortObjectUploadSession(context.Background(), "upload-token", "object-1", "session-1")
	if err != nil {
		t.Fatal(err)
	}

	if createBody["partSize"] != float64(64*1024*1024) {
		t.Fatalf("expected create partSize, got %#v", createBody)
	}
	if !reflect.DeepEqual(presignBody["partNumbers"], []any{float64(1), float64(2)}) {
		t.Fatalf("expected presign part numbers, got %#v", presignBody)
	}
	if completeBody["action"] != "complete" || abortBody["action"] != "abort" {
		t.Fatalf("unexpected patch bodies: complete=%#v abort=%#v", completeBody, abortBody)
	}
}

func mustClient(t *testing.T, baseURL string, token string) *Client {
	t.Helper()
	api, err := New(baseURL, token)
	if err != nil {
		t.Fatal(err)
	}
	return api
}
