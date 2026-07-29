package restishzpan

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCheckpointStoreRoundTripAndDefaults(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	store, err := newCheckpointStore("")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(store.dir, "restish-zpan") {
		t.Fatalf("unexpected default dir: %s", store.dir)
	}

	path := filepath.Join(store.dir, "cp.json")
	if err := store.save(path, checkpoint{Version: checkpointVersion}); err != nil {
		t.Fatal(err)
	}
	cp, err := store.load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cp.Parts == nil || len(cp.Parts) != 0 {
		t.Fatalf("expected empty parts map, got %#v", cp.Parts)
	}
	if cp.UpdatedAt.IsZero() {
		t.Fatal("expected UpdatedAt to be set")
	}
}

func TestCheckpointStoreLoadAndRemoveErrors(t *testing.T) {
	store, err := newCheckpointStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	invalidVersionPath := filepath.Join(store.dir, "invalid-version.json")
	if err := os.WriteFile(invalidVersionPath, []byte(`{"version":2}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.load(invalidVersionPath); err == nil || !strings.Contains(err.Error(), "unsupported checkpoint version") {
		t.Fatalf("expected version error, got %v", err)
	}

	invalidJSONPath := filepath.Join(store.dir, "invalid-json.json")
	if err := os.WriteFile(invalidJSONPath, []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.load(invalidJSONPath); err == nil {
		t.Fatal("expected invalid json to fail")
	}

	if err := store.remove(filepath.Join(store.dir, "missing.json")); err != nil {
		t.Fatalf("remove missing file: %v", err)
	}
}

func TestCheckpointCompletedPartsAreSorted(t *testing.T) {
	parts := checkpoint{
		Parts: map[int]string{2: "etag-2", 1: "etag-1"},
	}.completedParts()
	if len(parts) != 2 || parts[0].PartNumber != 1 || parts[1].PartNumber != 2 {
		t.Fatalf("unexpected parts: %#v", parts)
	}
}

func TestValidateAbortCheckpointIdentity(t *testing.T) {
	src := fileIdentity{Path: "/tmp/source.bin"}
	opts := uploadOptions{API: "zpan", Profile: "ci", Parent: "folder", Name: "source.bin", Conflict: "fail"}
	cp := checkpoint{API: "zpan", Profile: "ci", SourcePath: src.Path, Parent: "folder", Name: "source.bin", Conflict: "rename"}

	if err := validateAbortCheckpoint(cp, opts, src); err != nil {
		t.Fatalf("expected abort validation to ignore conflict and file metadata, got %v", err)
	}
	if err := validateAbortCheckpoint(cp, uploadOptions{API: "other", Profile: "ci", Parent: "folder", Name: "source.bin"}, src); err == nil || !strings.Contains(err.Error(), "api/profile") {
		t.Fatalf("expected api/profile error, got %v", err)
	}
	if err := validateAbortCheckpoint(cp, opts, fileIdentity{Path: "/tmp/other.bin"}); err == nil || !strings.Contains(err.Error(), "checkpoint source changed") {
		t.Fatalf("expected source error, got %v", err)
	}
	if err := validateAbortCheckpoint(cp, uploadOptions{API: "zpan", Profile: "ci", Parent: "other", Name: "source.bin"}, src); err == nil || !strings.Contains(err.Error(), "destination differs") {
		t.Fatalf("expected destination error, got %v", err)
	}
}

func TestNewCheckpointCopiesUploadMetadata(t *testing.T) {
	uploadID := "upload-1"
	cp := newCheckpoint(
		uploadOptions{API: "zpan", Profile: "ci", Parent: "folder", Name: "file.txt", Conflict: "rename"},
		fileIdentity{Path: "/tmp/file.txt", Size: 5, ModTime: time.Unix(1, 0)},
		matterResult{ID: "obj"},
		uploadInstructions{SessionID: "sess", UploadID: &uploadID, Mode: "multipart", PartSize: 2, PartCount: 3},
	)
	if cp.API != "zpan" || cp.Profile != "ci" || cp.ObjectID != "obj" || cp.SessionID != "sess" || cp.Mode != "multipart" {
		t.Fatalf("unexpected checkpoint: %#v", cp)
	}
	if cp.UploadID == nil || *cp.UploadID != uploadID {
		t.Fatalf("unexpected upload id: %#v", cp.UploadID)
	}
}
