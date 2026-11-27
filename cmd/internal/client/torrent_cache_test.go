package client

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTorrentCacheCallsUseTheCacheAPI(t *testing.T) {
	var calls []string
	bodies := map[string]map[string]any{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer upload-token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		call := r.Method + " " + r.URL.Path
		calls = append(calls, call)
		data, _ := io.ReadAll(r.Body)
		if len(data) > 0 {
			var body map[string]any
			_ = json.Unmarshal(data, &body)
			bodies[call] = body
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/uploads"):
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"uploadId":"up","partSize":4,"expiresAt":"x","parts":[{"partNumber":1,"url":"u","offset":0,"length":4}]}`))
		case r.URL.Path == "/api/downloads/tasks/t1/torrent":
			_, _ = w.Write([]byte(`{"outcome":"fill","infoHash":"abc","name":"Show","files":[{"fileIdx":0,"path":"a.mkv","size":4}]}`))
		case strings.HasSuffix(r.URL.Path, "/torrent/completions"):
			_, _ = w.Write([]byte(`{"id":"t1","status":{"state":"completed"}}`))
		case strings.HasSuffix(r.URL.Path, "/torrent/layout"):
			_, _ = w.Write([]byte(`{"entries":1}`))
		default:
			_, _ = w.Write([]byte(`{"fileIdx":0,"n":0,"size":4}`))
		}
	}))
	defer server.Close()
	c := mustClient(t, server.URL, "token")
	ctx := context.Background()

	registration, err := c.RegisterTaskTorrent(ctx, "upload-token", "t1", []byte("d4:infoe"))
	if err != nil || registration.Outcome != TorrentOutcomeFill || registration.Files[0].Path != "a.mkv" {
		t.Fatalf("registration = %#v, %v", registration, err)
	}
	upload, err := c.CreateTorrentFileUpload(ctx, "upload-token", "t1", 0)
	if err != nil || *upload.UploadID != "up" || upload.Parts[0].Length != 4 {
		t.Fatalf("upload = %#v, %v", upload, err)
	}
	if err := c.CompleteTorrentFileUpload(ctx, "upload-token", "t1", 0, upload.UploadID, []CompletedObjectUploadPart{{PartNumber: 1, ETag: "e"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.CreateTorrentSidecarUpload(ctx, "upload-token", "t1", 3, 4); err != nil {
		t.Fatal(err)
	}
	if err := c.CompleteTorrentSidecarUpload(ctx, "upload-token", "t1", 3); err != nil {
		t.Fatal(err)
	}
	if err := c.PutTaskTorrentLayout(ctx, "upload-token", "t1", map[string]any{"version": 1}); err != nil {
		t.Fatal(err)
	}
	task, err := c.CompleteTaskTorrent(ctx, "upload-token", "t1", registration.Files)
	if err != nil || task.State() != "completed" {
		t.Fatalf("task = %#v, %v", task, err)
	}

	want := []string{
		"PUT /api/downloads/tasks/t1/torrent",
		"POST /api/downloads/tasks/t1/torrent/files/0/uploads",
		"POST /api/downloads/tasks/t1/torrent/files/0/completions",
		"POST /api/downloads/tasks/t1/torrent/sidecars/3/uploads",
		"POST /api/downloads/tasks/t1/torrent/sidecars/3/completions",
		"PUT /api/downloads/tasks/t1/torrent/layout",
		"POST /api/downloads/tasks/t1/torrent/completions",
	}
	if strings.Join(calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls =\n%s", strings.Join(calls, "\n"))
	}
	if bodies[want[0]]["info"] != base64.StdEncoding.EncodeToString([]byte("d4:infoe")) {
		t.Fatalf("register body = %v", bodies[want[0]])
	}
	if parts := bodies[want[2]]["parts"].([]any); len(parts) != 1 {
		t.Fatalf("completion body = %v", bodies[want[2]])
	}
	if bodies[want[3]]["size"] != float64(4) {
		t.Fatalf("sidecar body = %v", bodies[want[3]])
	}
	if files := bodies[want[6]]["files"].([]any); len(files) != 1 {
		t.Fatalf("complete body = %v", bodies[want[6]])
	}
}

func TestTorrentCacheErrorsCarryTheStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid"}`))
	}))
	defer server.Close()
	_, err := mustClient(t, server.URL, "token").RegisterTaskTorrent(context.Background(), "upload-token", "t1", []byte("d4:infoe"))
	if !IsStatus(err, http.StatusBadRequest) || IsConflict(err) {
		t.Fatalf("err = %v", err)
	}
}

func TestTorrentCacheAssignment(t *testing.T) {
	var task DownloadTask
	if err := json.Unmarshal([]byte(`{"id":"t","status":{"assignment":{"downloaderId":"d","torrentCache":true}}}`), &task); err != nil {
		t.Fatal(err)
	}
	if !task.TorrentCache() || (DownloadTask{}).TorrentCache() {
		t.Fatal("torrentCache not read from the assignment")
	}
}
