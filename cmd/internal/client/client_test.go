package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func downloadTaskFixture(id string, status string) DownloadTask {
	return DownloadTask{
		ID: id,
		Spec: DownloadTaskSpec{
			Source:      DownloadTaskSource{Type: "http", URI: "https://example.com/file.bin"},
			Destination: DownloadTaskDestination{Name: "file.bin"},
			Labels:      DownloadTaskLabels{Tags: []string{}},
		},
		Status: DownloadTaskStatus{
			State: status,
			Assignment: &DownloadTaskAssignment{
				DownloaderID: "downloader-1",
				UploadToken:  "upload-token",
			},
			Progress: DownloadTaskProgress{
				Download: DownloadTaskTransferProgress{Bytes: 1024, BytesPerSecond: 10},
				Upload:   DownloadTaskTransferProgress{},
			},
		},
	}
}

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
		// POST /api/objects always returns 201 Created.
		w.WriteHeader(http.StatusCreated)
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

func TestDownloadTaskAccessors(t *testing.T) {
	totalBytes := int64(2048)
	runtime := &DownloadTaskRuntime{Engine: "http", Phase: "downloading"}
	task := downloadTaskFixture("task-1", "downloading")
	task.Spec.Source.Type = "bt"
	task.Spec.Source.URI = "magnet:?xt=urn:btih:test"
	task.Spec.Destination.Name = "movie.mkv"
	task.Spec.Destination.Folder = "folder-1"
	task.Spec.Labels.Category = "movies"
	task.Spec.Labels.Tags = []string{"uhd", "hdr"}
	task.Status.Attempt = 2
	task.Status.Progress.Download.TotalBytes = &totalBytes
	task.Status.Runtime = runtime

	if task.SourceType() != "bt" || task.SourceURI() != "magnet:?xt=urn:btih:test" {
		t.Fatalf("unexpected source accessors: %s %s", task.SourceType(), task.SourceURI())
	}
	if task.Name() != "movie.mkv" || task.TargetFolder() != "folder-1" {
		t.Fatalf("unexpected destination accessors: %s %s", task.Name(), task.TargetFolder())
	}
	if task.Category() != "movies" || !reflect.DeepEqual(task.Tags(), []string{"uhd", "hdr"}) {
		t.Fatalf("unexpected label accessors: %s %#v", task.Category(), task.Tags())
	}
	if task.State() != "downloading" || task.Attempt() != 2 || task.Runtime() != runtime {
		t.Fatalf("unexpected status accessors")
	}
	if task.UploadToken() != "upload-token" {
		t.Fatalf("unexpected upload token: %q", task.UploadToken())
	}
	task.Status.Assignment = nil
	if task.UploadToken() != "" {
		t.Fatalf("expected empty upload token without assignment, got %q", task.UploadToken())
	}
}

func TestHeartbeatUsesGeneratedRequestShape(t *testing.T) {
	var body map[string]any
	var auth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/downloads/downloaders/me/heartbeats" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		auth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":                                 "downloader-1",
			"name":                               "node-a",
			"engine":                             "http",
			"status":                             "online",
			"enabled":                            true,
			"version":                            "v1",
			"hostname":                           "host-a",
			"platform":                           "darwin",
			"arch":                               "arm64",
			"capabilities":                       []string{"http"},
			"maxConcurrentTasks":                 2,
			"currentTasks":                       1,
			"downloadBps":                        100,
			"uploadBps":                          20,
			"freeDiskBytes":                      4096,
			"remoteDownloadCreditBillingEnabled": false,
			"remoteDownloadCreditPerUnit":        0,
			"remoteDownloadCreditUnitBytes":      0,
			"createdAt":                          "2026-01-01T00:00:00Z",
			"createdBy":                          "user-1",
			"updatedAt":                          "2026-01-01T00:00:00Z",
			"nextPollAfterSeconds":               7,
			"assignments":                        []DownloadTask{downloadTaskFixture("task-assigned", "assigned")},
			"controls":                           []DownloadTask{downloadTaskFixture("task-pausing", "pausing")},
		})
	}))
	defer server.Close()

	result, err := mustClient(t, server.URL, "downloader-token").Heartbeat(context.Background(), Heartbeat{
		Version:            "v1",
		Hostname:           "host-a",
		Platform:           "darwin",
		Arch:               "arm64",
		Engine:             "http",
		Capabilities:       []string{"http"},
		MaxConcurrentTasks: 2,
		CurrentTasks:       1,
		DownloadBps:        100,
		UploadBps:          20,
		FreeDiskBytes:      4096,
	})
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer downloader-token" {
		t.Fatalf("unexpected auth header: %q", auth)
	}
	if body["engine"] != "http" || body["hostname"] != "host-a" || body["freeDiskBytes"] != float64(4096) {
		t.Fatalf("unexpected heartbeat body: %#v", body)
	}
	if result.NextPollAfterSeconds != 7 || len(result.Assignments) != 1 || result.Assignments[0].ID != "task-assigned" {
		t.Fatalf("unexpected heartbeat assignments: %#v", result)
	}
	if len(result.Controls) != 1 || result.Controls[0].ID != "task-pausing" {
		t.Fatalf("unexpected heartbeat controls: %#v", result)
	}
}

func TestAssignedTasksFetchesRunnableStatuses(t *testing.T) {
	var status string
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/downloads/tasks" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		requests++
		w.Header().Set("Content-Type", "application/json")
		status = r.URL.Query().Get("status")
		_ = json.NewEncoder(w).Encode(Page[DownloadTask]{
			Items: []DownloadTask{downloadTaskFixture("task-assigned", "assigned")},
		})
	}))
	defer server.Close()

	tasks, err := mustClient(t, server.URL, "token").AssignedTasks(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if requests != 1 {
		t.Fatalf("expected one request, got %d", requests)
	}
	expected := "assigned,downloading,interrupted,uploading"
	if status != expected {
		t.Fatalf("expected status query %q, got %q", expected, status)
	}
	if len(tasks) != 1 {
		t.Fatalf("expected one task, got %d", len(tasks))
	}
}

func TestAssignedControlTasksFetchesControlStatuses(t *testing.T) {
	var status string
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		status = r.URL.Query().Get("status")
		_ = json.NewEncoder(w).Encode(Page[DownloadTask]{Items: []DownloadTask{}})
	}))
	defer server.Close()

	if _, err := mustClient(t, server.URL, "token").AssignedControlTasks(context.Background()); err != nil {
		t.Fatal(err)
	}
	if requests != 1 {
		t.Fatalf("expected one request, got %d", requests)
	}
	expected := "pausing,canceling,suspended"
	if status != expected {
		t.Fatalf("expected status query %q, got %q", expected, status)
	}
}

func TestLocalResultTasksFetchesRetryableStatuses(t *testing.T) {
	var status string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("assignedTo") != "me" {
			t.Fatalf("expected assignedTo=me, got %q", r.URL.Query().Get("assignedTo"))
		}
		status = r.URL.Query().Get("status")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(Page[DownloadTask]{Items: []DownloadTask{downloadTaskFixture("task-1", "failed")}})
	}))
	defer server.Close()

	tasks, err := mustClient(t, server.URL, "token").LocalResultTasks(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	expected := "assigned,downloading,interrupted,uploading,pausing,paused,suspended,failed"
	if status != expected {
		t.Fatalf("expected status query %q, got %q", expected, status)
	}
	if len(tasks) != 1 || tasks[0].ID != "task-1" {
		t.Fatalf("unexpected tasks: %#v", tasks)
	}
}

func TestSeedingTasksFiltersCompletedSeedingPhase(t *testing.T) {
	var status string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status = r.URL.Query().Get("status")
		w.Header().Set("Content-Type", "application/json")
		seeding := downloadTaskFixture("seed-1", "completed")
		seeding.Status.Runtime = &DownloadTaskRuntime{Phase: "seeding"}
		plain := downloadTaskFixture("done-1", "completed")
		plain.Status.Runtime = &DownloadTaskRuntime{Phase: "completed"}
		_ = json.NewEncoder(w).Encode(Page[DownloadTask]{Items: []DownloadTask{seeding, plain}})
	}))
	defer server.Close()

	tasks, err := mustClient(t, server.URL, "token").SeedingTasks(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status != "completed" {
		t.Fatalf("expected status=completed query, got %q", status)
	}
	if len(tasks) != 1 || tasks[0].ID != "seed-1" {
		t.Fatalf("expected only the seeding-phase task, got %v", tasks)
	}
}

func TestDeviceAuthClientMethods(t *testing.T) {
	var codeBody map[string]any
	var tokenBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/auth/device/code":
			if err := json.NewDecoder(r.Body).Decode(&codeBody); err != nil {
				t.Fatal(err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":               "device-1",
				"user_code":                 "ABCD-EFGH",
				"verification_uri":          "https://zpan.test/device",
				"verification_uri_complete": "https://zpan.test/device?user_code=ABCD-EFGH",
				"expires_in":                600,
				"interval":                  5,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/auth/device/token":
			if err := json.NewDecoder(r.Body).Decode(&tokenBody); err != nil {
				t.Fatal(err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "access-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
				"scope":        "downloader:register",
			})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	api := mustClient(t, server.URL, "")
	code, err := api.RequestDeviceCode(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if codeBody["client_id"] != "zpan-cli" || codeBody["scope"] != "downloader:register" {
		t.Fatalf("unexpected device code body: %#v", codeBody)
	}
	if code.DeviceCode != "device-1" || code.UserCode != "ABCD-EFGH" || code.ExpiresIn != 600 || code.Interval != 5 {
		t.Fatalf("unexpected device code: %#v", code)
	}

	token, err := api.PollDeviceToken(context.Background(), "device-1")
	if err != nil {
		t.Fatal(err)
	}
	if tokenBody["client_id"] != "zpan-cli" || tokenBody["device_code"] != "device-1" {
		t.Fatalf("unexpected device token body: %#v", tokenBody)
	}
	if tokenBody["grant_type"] != "urn:ietf:params:oauth:grant-type:device_code" {
		t.Fatalf("unexpected grant type: %#v", tokenBody)
	}
	if token.AccessToken != "access-token" || token.TokenType != "Bearer" || token.ExpiresIn != 3600 || token.Scope != "downloader:register" {
		t.Fatalf("unexpected device token: %#v", token)
	}
}

func TestCreateDownloaderUsesHeartbeatRequestShape(t *testing.T) {
	var body map[string]any
	var auth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/downloads/downloaders" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		auth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"downloader": map[string]any{
				"id":      "downloader-1",
				"name":    "node-a",
				"engine":  "http",
				"status":  "online",
				"enabled": true,
			},
			"token": "downloader-token",
		})
	}))
	defer server.Close()

	out, err := mustClient(t, server.URL, "").CreateDownloader(context.Background(), "access-token", CreateDownloaderRequest{
		Name: "node-a",
		Heartbeat: Heartbeat{
			Version:            "v1",
			Hostname:           "host-a",
			Platform:           "darwin",
			Arch:               "arm64",
			Engine:             "http",
			Capabilities:       []string{"http"},
			MaxConcurrentTasks: 2,
			CurrentTasks:       1,
			DownloadBps:        100,
			UploadBps:          20,
			FreeDiskBytes:      4096,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer access-token" {
		t.Fatalf("unexpected auth header: %q", auth)
	}
	if body["name"] != "node-a" {
		t.Fatalf("unexpected create downloader body: %#v", body)
	}
	heartbeat, ok := body["heartbeat"].(map[string]any)
	if !ok || heartbeat["engine"] != "http" || heartbeat["downloadBps"] != float64(100) {
		t.Fatalf("unexpected heartbeat body: %#v", body)
	}
	if out.Downloader.ID != "downloader-1" || out.Token != "downloader-token" {
		t.Fatalf("unexpected create downloader response: %#v", out)
	}
}

func TestUpdateTaskUsesGeneratedRequestShape(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/api/downloads/tasks/task-1" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(downloadTaskFixture("task-1", "downloading"))
	}))
	defer server.Close()

	downloadedBytes := int64(1024)
	totalBytes := int64(2048)
	etaSeconds := int64(30)
	task, err := mustClient(t, server.URL, "token").UpdateTask(context.Background(), "task-1", TaskPatch{
		Status: "downloading",
		Progress: &DownloadTaskProgressPatch{
			Download: &DownloadTaskTransferProgress{Bytes: downloadedBytes, TotalBytes: &totalBytes},
		},
		Runtime: &DownloadTaskRuntime{
			Engine:     "http",
			Phase:      "downloading",
			ETASeconds: &etaSeconds,
			Files:      []DownloadTaskFile{{Path: "file.bin", Size: 2048, CompletedBytes: &downloadedBytes}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if task.ID != "task-1" || task.State() != "downloading" {
		t.Fatalf("unexpected task: %#v", task)
	}
	if body["status"] != "downloading" {
		t.Fatalf("unexpected patch body: %#v", body)
	}
	progress, ok := body["progress"].(map[string]any)
	if !ok {
		t.Fatalf("unexpected progress body: %#v", body["progress"])
	}
	download, ok := progress["download"].(map[string]any)
	if !ok || download["bytes"] != float64(1024) || download["totalBytes"] != float64(2048) {
		t.Fatalf("unexpected progress body: %#v", body["progress"])
	}
	runtime, ok := body["runtime"].(map[string]any)
	if !ok || runtime["engine"] != "http" || runtime["phase"] != "downloading" || runtime["etaSeconds"] != float64(30) {
		t.Fatalf("unexpected runtime body: %#v", body["runtime"])
	}
}

func TestMultipartUploadSessionClientMethods(t *testing.T) {
	var presignBody map[string]any
	var completeBody map[string]any
	var abortCalled bool
	var deleteCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
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
		case r.Method == http.MethodPost && r.URL.Path == "/api/objects/object-1/uploads/session-1/completions":
			if err := json.NewDecoder(r.Body).Decode(&completeBody); err != nil {
				t.Fatal(err)
			}
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":   "object-1",
				"name": "movie.mkv",
			})
		case r.Method == http.MethodDelete && r.URL.Path == "/api/objects/object-1/uploads/session-1":
			abortCalled = true
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodDelete && r.URL.Path == "/api/objects/root-folder":
			deleteCalled = true
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	api := mustClient(t, server.URL, "token")
	parts, err := api.PresignObjectUploadParts(context.Background(), "upload-token", "object-1", "session-1", []int{1, 2})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(parts, []PresignedObjectUploadPart{{PartNumber: 1, URL: "https://s3/part-1"}, {PartNumber: 2, URL: "https://s3/part-2"}}) {
		t.Fatalf("unexpected presigned parts: %#v", parts)
	}
	err = api.CompleteObjectUpload(context.Background(), "upload-token", "object-1", "session-1", []CompletedObjectUploadPart{{PartNumber: 1, ETag: `"etag-1"`}})
	if err != nil {
		t.Fatal(err)
	}
	err = api.AbortObjectUploadSession(context.Background(), "upload-token", "object-1", "session-1")
	if err != nil {
		t.Fatal(err)
	}
	err = api.DeleteObject(context.Background(), "upload-token", "root-folder")
	if err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(presignBody["partNumbers"], []any{float64(1), float64(2)}) {
		t.Fatalf("expected presign part numbers, got %#v", presignBody)
	}
	completeParts, ok := completeBody["parts"].([]any)
	if !ok || len(completeParts) != 1 {
		t.Fatalf("unexpected complete body: %#v", completeBody)
	}
	part, ok := completeParts[0].(map[string]any)
	if !ok || part["partNumber"] != float64(1) || part["etag"] != `"etag-1"` {
		t.Fatalf("unexpected complete part: %#v", completeBody)
	}
	if !abortCalled {
		t.Fatalf("abort was not called")
	}
	if !deleteCalled {
		t.Fatalf("delete object was not called")
	}
}

func TestCreateObjectMapsUploadInstructions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":   "object-1",
			"name": "movie.mkv",
			"upload": map[string]any{
				"sessionId": "session-1",
				"partSize":  1024,
				"urls":      []string{"https://s3/part-1"},
			},
		})
	}))
	defer server.Close()

	draft, err := mustClient(t, server.URL, "token").CreateObject(context.Background(), "upload-token", "movie.mkv", 1024, "")
	if err != nil {
		t.Fatal(err)
	}
	if draft.Upload == nil {
		t.Fatalf("expected upload instructions: %#v", draft)
	}
	if draft.Upload.SessionID != "session-1" || draft.Upload.PartSize != 1024 || !reflect.DeepEqual(draft.Upload.URLs, []string{"https://s3/part-1"}) {
		t.Fatalf("unexpected upload instructions: %#v", draft.Upload)
	}
}

func TestCreateFolderUsesFolderMatterShape(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/objects" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(ObjectDraft{ID: "folder-1", Name: "Movies"})
	}))
	defer server.Close()

	folder, err := mustClient(t, server.URL, "token").CreateFolder(context.Background(), "upload-token", "Movies", "parent-1")
	if err != nil {
		t.Fatal(err)
	}
	if folder.ID != "folder-1" || folder.Name != "Movies" {
		t.Fatalf("unexpected folder draft: %#v", folder)
	}
	if body["name"] != "Movies" || body["parent"] != "parent-1" || body["dirtype"] != float64(dirTypeUserFolder) || body["type"] != "folder" {
		t.Fatalf("unexpected folder body: %#v", body)
	}
	if body["size"] != float64(0) || body["onConflict"] != "rename" {
		t.Fatalf("unexpected folder defaults: %#v", body)
	}
}

func TestClientErrorResponsesIncludeProblemBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"message":"not authorized"}`, http.StatusUnauthorized)
	}))
	defer server.Close()

	_, err := mustClient(t, server.URL, "token").AssignedTasks(context.Background())
	if err == nil {
		t.Fatal("expected assigned tasks error")
	}
	if !strings.Contains(err.Error(), "GET /api/downloads/tasks failed") || !strings.Contains(err.Error(), "not authorized") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestClientResponseAndConversionHelpers(t *testing.T) {
	if (TaskPatch{Status: "failed"}).State() != "failed" {
		t.Fatal("unexpected task patch state")
	}
	if derefString(nil) != "" {
		t.Fatal("nil string pointer should dereference to empty string")
	}
	if derefFloatToInt(nil) != 0 {
		t.Fatal("nil float pointer should dereference to zero")
	}
	if responseError(nil) != "empty response body" {
		t.Fatalf("unexpected empty response error")
	}
	if responseError([]byte(`{"error":"bad request"}`)) != "bad request" {
		t.Fatalf("unexpected json error response")
	}
	if responseError([]byte(" plain text ")) != "plain text" {
		t.Fatalf("unexpected text error response")
	}
	if _, err := downloadTaskFromOpenAPI(make(chan int)); err == nil {
		t.Fatal("expected single task conversion error")
	}
	if _, err := downloadTasksFromOpenAPI(make(chan int)); err == nil {
		t.Fatal("expected task list conversion error")
	}
}

func TestClientEmptyResponseBranches(t *testing.T) {
	tests := []struct {
		name string
		call func(*Client) error
	}{
		{
			name: "heartbeat",
			call: func(api *Client) error {
				_, err := api.Heartbeat(context.Background(), Heartbeat{Engine: "http"})
				return err
			},
		},
		{
			name: "device code",
			call: func(api *Client) error {
				_, err := api.RequestDeviceCode(context.Background())
				return err
			},
		},
		{
			name: "device token",
			call: func(api *Client) error {
				_, err := api.PollDeviceToken(context.Background(), "device-1")
				return err
			},
		},
		{
			name: "create downloader",
			call: func(api *Client) error {
				_, err := api.CreateDownloader(context.Background(), "access-token", CreateDownloaderRequest{Heartbeat: Heartbeat{Engine: "http"}})
				return err
			},
		},
		{
			name: "update task",
			call: func(api *Client) error {
				_, err := api.UpdateTask(context.Background(), "task-1", TaskPatch{Status: "failed"})
				return err
			},
		},
		{
			name: "create object",
			call: func(api *Client) error {
				_, err := api.CreateObject(context.Background(), "upload-token", "file.bin", 1, "")
				return err
			},
		},
		{
			name: "presign parts",
			call: func(api *Client) error {
				_, err := api.PresignObjectUploadParts(context.Background(), "upload-token", "object-1", "session-1", []int{1})
				return err
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tt.name == "create downloader" {
					w.WriteHeader(http.StatusCreated)
					return
				}
				w.WriteHeader(http.StatusOK)
			}))
			defer server.Close()

			err := tt.call(mustClient(t, server.URL, "token"))
			if err == nil {
				t.Fatal("expected empty response error")
			}
			if !strings.Contains(err.Error(), "empty response") {
				t.Fatalf("unexpected error: %v", err)
			}
		})
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
