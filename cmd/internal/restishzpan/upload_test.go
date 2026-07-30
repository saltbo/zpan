package restishzpan

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rest-sh/restish/v2/plugin"
)

type fakeHost struct {
	spec      *plugin.APISpecResponseMsg
	specErr   error
	requests  []plugin.HTTPRequestMsg
	responses []*plugin.HTTPResponseMsg
	body      any
	mu        sync.Mutex
}

func (h *fakeHost) FetchAPISpecContext(_ context.Context, api, profile string) (*plugin.APISpecResponseMsg, error) {
	if h.specErr != nil {
		return nil, h.specErr
	}
	if h.spec == nil {
		return &plugin.APISpecResponseMsg{Name: api, Profile: profile, Operations: validOps()}, nil
	}
	return h.spec, nil
}

func (h *fakeHost) Do(req *plugin.HTTPRequestMsg) (*plugin.HTTPResponseMsg, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.requests = append(h.requests, *req)
	if len(h.responses) == 0 {
		return nil, errors.New("unexpected request")
	}
	resp := h.responses[0]
	h.responses = h.responses[1:]
	return resp, nil
}

func (h *fakeHost) Response(_ int, _ map[string][]string, body any) error {
	h.body = body
	return nil
}

func (h *fakeHost) Progress(string) error { return nil }
func (h *fakeHost) Warn(string) error     { return nil }

type fakeStorage struct {
	failFirst bool
	alwaysErr error
	active    int
	maxActive int
	mu        sync.Mutex
	seen      map[int]string
}

func (s *fakeStorage) PutPart(ctx context.Context, part uploadPart, body io.Reader, size int64) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	s.mu.Lock()
	if s.seen == nil {
		s.seen = map[int]string{}
	}
	s.active++
	if s.active > s.maxActive {
		s.maxActive = s.active
	}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.active--
		s.mu.Unlock()
	}()
	data, err := io.ReadAll(body)
	if err != nil {
		return "", err
	}
	if int64(len(data)) != size {
		return "", errors.New("size mismatch")
	}
	if s.alwaysErr != nil {
		return "", s.alwaysErr
	}
	if s.failFirst {
		s.failFirst = false
		return "", storageStatusError{status: 403}
	}
	s.mu.Lock()
	s.seen[part.PartNumber] = string(data)
	s.mu.Unlock()
	return `"` + "etag-" + string(rune('0'+part.PartNumber)) + `"`, nil
}

func TestParseOptions(t *testing.T) {
	opts, err := parseOptions([]string{"--api", "zpan", "--profile", "ci", "--conflict", "rename", "--concurrency", "2", "--parent", "folder", "file.txt", "name.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.API != "zpan" || opts.Profile != "ci" || opts.Conflict != "rename" || opts.Concurrency != 2 || opts.Parent != "folder" || opts.Name != "name.txt" {
		t.Fatalf("unexpected opts: %#v", opts)
	}
	if _, err := parseOptions([]string{"--conflict", "merge", "file.txt"}); err == nil {
		t.Fatal("expected invalid conflict to fail")
	}
	if _, err := parseOptions([]string{"--concurrency", "0", "file.txt"}); err == nil {
		t.Fatal("expected invalid concurrency to fail")
	}
	opts, err = parseOptions([]string{"--folder", "nested", "file.txt", "child/"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.Parent != "nested" || opts.Name != "file.txt" {
		t.Fatalf("unexpected folder parse: %#v", opts)
	}
}

func TestFetchOperationsValidatesContract(t *testing.T) {
	_, err := fetchOperations(context.Background(), &fakeHost{specErr: errors.New("spec failed")}, "zpan", "")
	if err == nil || !strings.Contains(err.Error(), "spec failed") {
		t.Fatalf("expected spec error, got %v", err)
	}
	_, err = fetchOperations(context.Background(), &fakeHost{spec: &plugin.APISpecResponseMsg{Error: "host spec failed"}}, "zpan", "")
	if err == nil || !strings.Contains(err.Error(), "host spec failed") {
		t.Fatalf("expected host spec error, got %v", err)
	}
	_, err = fetchOperations(context.Background(), &fakeHost{spec: &plugin.APISpecResponseMsg{
		Operations: []plugin.APIOperation{{ID: opCreate, Method: "POST", Path: "/api/objects", HasBody: true}},
	}}, "zpan", "")
	if err == nil || !strings.Contains(err.Error(), "missing required operation") {
		t.Fatalf("expected missing operation error, got %v", err)
	}
	_, err = fetchOperations(context.Background(), &fakeHost{}, "zpan", "")
	if err != nil {
		t.Fatal(err)
	}
	restishCommandOps := validOps()
	restishCommandOps[0].ID = "create-object"
	restishCommandOps[1].ID = "presign-object-upload-parts"
	restishCommandOps[2].ID = "complete-object-upload"
	restishCommandOps[3].ID = "abort-object-upload"
	gotOps, err := fetchOperations(context.Background(), &fakeHost{spec: &plugin.APISpecResponseMsg{Operations: restishCommandOps}}, "zpan", "")
	if err != nil {
		t.Fatalf("expected Restish command operation aliases to validate: %v", err)
	}
	if gotOps.Create.ID != "create-object" || gotOps.Presign.ID != "presign-object-upload-parts" || gotOps.Complete.ID != "complete-object-upload" || gotOps.Abort.ID != "abort-object-upload" {
		t.Fatalf("unexpected aliased operations: %#v", gotOps)
	}
	badMethod := validOps()
	badMethod[0].Method = "GET"
	_, err = fetchOperations(context.Background(), &fakeHost{spec: &plugin.APISpecResponseMsg{Operations: badMethod}}, "zpan", "")
	if err == nil || !strings.Contains(err.Error(), "uses GET") {
		t.Fatalf("expected method error, got %v", err)
	}
	badSchema := validOps()
	badSchema[0].RequestSchema = map[string]any{}
	_, err = fetchOperations(context.Background(), &fakeHost{spec: &plugin.APISpecResponseMsg{Operations: badSchema}}, "zpan", "")
	if err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("expected schema error, got %v", err)
	}
	badPartsSchema := validOps()
	badPartsSchema[1].RequestSchema = map[string]any{}
	_, err = fetchOperations(context.Background(), &fakeHost{spec: &plugin.APISpecResponseMsg{Operations: badPartsSchema}}, "zpan", "")
	if err == nil || !strings.Contains(err.Error(), "partNumbers") {
		t.Fatalf("expected presign schema error, got %v", err)
	}
	badParams := validOps()
	badParams[2].Parameters = nil
	_, err = fetchOperations(context.Background(), &fakeHost{spec: &plugin.APISpecResponseMsg{Operations: badParams}}, "zpan", "")
	if err == nil || !strings.Contains(err.Error(), "path parameter") {
		t.Fatalf("expected path param error, got %v", err)
	}
}

func TestFetchOperationsSpecErrors(t *testing.T) {
	_, err := fetchOperations(context.Background(), &fakeHost{spec: &plugin.APISpecResponseMsg{Error: "bad spec"}}, "zpan", "")
	if err == nil || !strings.Contains(err.Error(), "bad spec") {
		t.Fatalf("expected spec error, got %v", err)
	}

	badMethodOps := validOps()
	badMethodOps[0].Method = "GET"
	_, err = fetchOperations(context.Background(), &fakeHost{spec: &plugin.APISpecResponseMsg{Operations: badMethodOps}}, "zpan", "")
	if err == nil || !strings.Contains(err.Error(), "want POST") {
		t.Fatalf("expected method validation error, got %v", err)
	}
}

func TestSchemaValidationHelpers(t *testing.T) {
	if !schemaHasProperty(map[string]any{
		"allOf": []any{
			map[string]any{"properties": map[string]any{"name": map[string]any{}}},
		},
	}, "name") {
		t.Fatal("expected nested property to be found")
	}
	if schemaHasProperty(nil, "missing") {
		t.Fatal("nil schema should not contain properties")
	}
	if err := requirePathParams(plugin.APIOperation{Parameters: []plugin.APIParam{{Name: "id", In: "path", Required: true}}}, "id", "uploadSessionId"); err == nil {
		t.Fatal("expected missing path parameter to fail")
	}
	if err := validateCreateOperation(plugin.APIOperation{ID: opCreate, HasBody: false}); err == nil {
		t.Fatal("expected missing create body to fail")
	}
	if err := validatePartsOperation(plugin.APIOperation{ID: opPresign, HasBody: false}, "partNumbers"); err == nil {
		t.Fatal("expected missing parts body to fail")
	}
}

func TestCheckpointSaveModeAndNoURLLeak(t *testing.T) {
	dir := t.TempDir()
	store, err := newCheckpointStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	cp := checkpoint{
		Version:       checkpointVersion,
		API:           "zpan",
		SourcePath:    "/tmp/file",
		FileSize:      3,
		ModTimeUnixNS: 1,
		ObjectID:      "obj",
		SessionID:     "sess",
		Mode:          "multipart",
		PartSize:      2,
		PartCount:     2,
		Parts:         map[int]string{1: "etag"},
	}
	path := filepath.Join(dir, "cp.json")
	if err := store.save(path, cp); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"https://", "Authorization", "Cookie", "secret"} {
		if strings.Contains(string(data), forbidden) {
			t.Fatalf("checkpoint leaked %q: %s", forbidden, data)
		}
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("mode = %o, want 0600", got)
		}
	}
}

func TestResumeRejectsChangedFile(t *testing.T) {
	src := fileIdentity{Path: "/tmp/file", Size: 10, ModTime: time.Unix(1, 0)}
	cp := checkpoint{API: "zpan", SourcePath: src.Path, FileSize: src.Size, ModTimeUnixNS: src.ModTime.UnixNano(), Parent: "", Name: "file", Conflict: "fail"}
	pathChanged := cp
	pathChanged.SourcePath = "/tmp/other-file"
	err := validateCheckpoint(pathChanged, uploadOptions{API: "zpan", Name: "file", Conflict: "fail"}, src)
	if err == nil || !strings.Contains(err.Error(), "checkpoint source changed") {
		t.Fatalf("expected source mismatch error, got %v", err)
	}
	changed := src
	changed.Size = 11
	err = validateCheckpoint(cp, uploadOptions{API: "zpan", Name: "file", Conflict: "fail"}, changed)
	if err == nil || !strings.Contains(err.Error(), "source file changed") {
		t.Fatalf("expected changed file error, got %v", err)
	}
}

func TestValidateCheckpointRejectsChangedCommandContext(t *testing.T) {
	src := fileIdentity{Path: "/tmp/file", Size: 10, ModTime: time.Unix(1, 0)}
	cp := checkpoint{API: "zpan", Profile: "ci", SourcePath: src.Path, FileSize: src.Size, ModTimeUnixNS: src.ModTime.UnixNano(), Parent: "a", Name: "file", Conflict: "fail"}
	if err := validateCheckpoint(cp, uploadOptions{API: "other", Profile: "ci", Parent: "a", Name: "file", Conflict: "fail"}, src); err == nil {
		t.Fatal("expected api/profile mismatch")
	}
	if err := validateCheckpoint(cp, uploadOptions{API: "zpan", Profile: "ci", Parent: "b", Name: "file", Conflict: "fail"}, src); err == nil {
		t.Fatal("expected destination mismatch")
	}
}

func TestRunReturnsParseErrorBeforeHostUse(t *testing.T) {
	err := Run(nil, nil, &fakeHost{})
	if err == nil || !strings.Contains(err.Error(), "usage: restish zpan-upload") {
		t.Fatalf("expected usage error, got %v", err)
	}
}

func TestParseOptionsAdditionalErrorsAndDestinationForms(t *testing.T) {
	if _, err := parseOptions([]string{"--api", "", "file.txt"}); err == nil || !strings.Contains(err.Error(), "--api") {
		t.Fatalf("expected api error, got %v", err)
	}
	if _, err := parseOptions([]string{"--concurrency", "0", "file.txt"}); err == nil || !strings.Contains(err.Error(), "concurrency") {
		t.Fatalf("expected concurrency error, got %v", err)
	}
	if _, err := parseOptions([]string{"--bad", "file.txt"}); err == nil {
		t.Fatal("expected bad flag to fail")
	}
	opts, err := parseOptions([]string{"--parent", "explicit", "file.txt", "folder/"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.Parent != "explicit" || opts.Name != "file.txt" {
		t.Fatalf("unexpected explicit parent opts: %#v", opts)
	}
	parent, name := splitDestination("", "fallback")
	if parent != "" || name != "fallback" {
		t.Fatalf("unexpected empty destination parent=%q name=%q", parent, name)
	}
}

func TestStatSourceRejectsDirectoryAndMissingFile(t *testing.T) {
	if _, err := statSource(t.TempDir()); err == nil || !strings.Contains(err.Error(), "source must be a file") {
		t.Fatalf("expected directory error, got %v", err)
	}
	if _, err := statSource(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("expected missing file error")
	}
}

func TestPrepareUploadResumeLoadsCheckpoint(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	opts := uploadOptions{API: "zpan", Source: source, Name: "file.bin", Conflict: "fail", Resume: true, CheckpointDir: dir}
	store, err := newCheckpointStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	want := checkpoint{Version: checkpointVersion, API: opts.API, SourcePath: src.Path, FileSize: src.Size, ModTimeUnixNS: src.ModTime.UnixNano(), ObjectID: "obj", SessionID: "sess", Mode: "multipart", PartSize: 2, PartCount: 2, Name: opts.Name, Conflict: opts.Conflict, Parts: map[int]string{}}
	if err := store.save(store.path(opts, src), want); err != nil {
		t.Fatal(err)
	}
	got, initial, err := prepareUpload(context.Background(), opts, &fakeHost{}, store, store.path(opts, src), src, operationSet{})
	if err != nil {
		t.Fatal(err)
	}
	if got.ObjectID != "obj" || len(initial) != 0 {
		t.Fatalf("unexpected resume checkpoint=%#v initial=%#v", got, initial)
	}
}

func TestPrepareUploadFailsWithoutUploadInstructions(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 201, Body: map[string]any{"id": "folder", "name": "folder"}}}}
	_, _, err = prepareUpload(context.Background(), uploadOptions{API: "zpan", Source: source, Name: "file.bin", Conflict: "fail"}, host, checkpointStore{dir: dir}, filepath.Join(dir, "cp.json"), src, operationSet{Create: validOps()[0]})
	if err == nil || !strings.Contains(err.Error(), "upload instructions") {
		t.Fatalf("expected upload instructions error, got %v", err)
	}
}

func TestPrepareUploadCreateAndSaveErrors(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = prepareUpload(context.Background(), uploadOptions{API: "zpan", Source: source, Name: "file.bin", Conflict: "fail"}, &fakeHost{}, checkpointStore{dir: dir}, filepath.Join(dir, "cp.json"), src, operationSet{Create: validOps()[0]})
	if err == nil || !strings.Contains(err.Error(), "unexpected request") {
		t.Fatalf("expected delegated request error, got %v", err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 201, Body: map[string]any{
		"id": "obj", "name": "file.bin",
		"upload": map[string]any{
			"sessionId": "sess", "uploadId": nil, "mode": "single", "partSize": float64(3), "partCount": float64(1),
			"expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
			"requiredHeaders": map[string]any{},
			"parts":           []any{map[string]any{"partNumber": float64(1), "url": "https://storage.test/part", "expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "headers": map[string]any{}}},
		},
	}}}}
	_, _, err = prepareUpload(context.Background(), uploadOptions{API: "zpan", Source: source, Name: "file.bin", Conflict: "fail"}, host, checkpointStore{dir: filepath.Join(dir, "missing")}, filepath.Join(dir, "missing", "cp.json"), src, operationSet{Create: validOps()[0]})
	if err == nil {
		t.Fatal("expected checkpoint save error")
	}
}

func TestSingleUploadUsesInitialPresignedURLAndDelegatedControlPlane(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.txt")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{
		{
			Status: 201,
			Body: map[string]any{
				"id": "obj", "name": "file.txt", "size": float64(3),
				"upload": map[string]any{
					"sessionId": "sess", "uploadId": nil, "mode": "single", "partSize": float64(3), "partCount": float64(1),
					"expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
					"requiredHeaders": map[string]any{"content-type": "text/plain"},
					"parts":           []any{map[string]any{"partNumber": float64(1), "url": "https://storage.test/part", "expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "headers": map[string]any{"content-type": "text/plain"}}},
				},
			},
		},
		{Status: 200, Body: map[string]any{"id": "obj", "name": "file.txt", "status": "active"}},
	}}
	storage := &fakeStorage{}
	err := runWithStorage(context.Background(), uploadOptions{API: "zpan", Source: source, Name: "file.txt", Conflict: "fail", Concurrency: 1, CheckpointDir: dir}, host, storage)
	if err != nil {
		t.Fatal(err)
	}
	if len(host.requests) != 2 {
		t.Fatalf("requests = %d, want 2", len(host.requests))
	}
	if host.requests[0].URI != "zpan/api/objects" || host.requests[1].URI != "zpan/api/objects/obj/uploads/sess/completions" {
		t.Fatalf("unexpected delegated URIs: %#v", host.requests)
	}
	if storage.seen[1] != "abc" {
		t.Fatalf("uploaded body = %q", storage.seen[1])
	}
}

func TestRunWithStoragePreservesCheckpointOnCompleteFailure(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.txt")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{
		{
			Status: 201,
			Body: map[string]any{
				"id": "obj", "name": "file.txt", "size": float64(3),
				"upload": map[string]any{
					"sessionId": "sess", "uploadId": nil, "mode": "single", "partSize": float64(3), "partCount": float64(1),
					"expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
					"requiredHeaders": map[string]any{},
					"parts":           []any{map[string]any{"partNumber": float64(1), "url": "https://storage.test/part", "expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "headers": map[string]any{}}},
				},
			},
		},
		{Status: 409, Body: map[string]any{"error": "conflict"}},
	}}
	opts := uploadOptions{API: "zpan", Source: source, Name: "file.txt", Conflict: "fail", Concurrency: 1, CheckpointDir: dir}
	err := runWithStorage(context.Background(), opts, host, &fakeStorage{})
	if err == nil || !strings.Contains(err.Error(), "HTTP 409") {
		t.Fatalf("expected complete failure, got %v", err)
	}
	src, statErr := statSource(source)
	if statErr != nil {
		t.Fatal(statErr)
	}
	if _, statErr := os.Stat((checkpointStore{dir: dir}).path(opts, src)); statErr != nil {
		t.Fatalf("expected checkpoint to remain: %v", statErr)
	}
}

func TestRunWithStorageFetchSpecError(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.txt")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := runWithStorage(context.Background(), uploadOptions{API: "zpan", Source: source, Name: "file.txt", Conflict: "fail", Concurrency: 1, CheckpointDir: dir}, &fakeHost{specErr: errors.New("spec failed")}, &fakeStorage{})
	if err == nil || !strings.Contains(err.Error(), "spec failed") {
		t.Fatalf("expected spec error, got %v", err)
	}
}

func TestMultipartResumeResignsMissingPartsAndBoundsConcurrency(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abcdef"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	src := fileIdentity{Path: source, Size: info.Size(), ModTime: info.ModTime()}
	opts := uploadOptions{API: "zpan", Source: source, Name: "file.bin", Conflict: "fail", Concurrency: 2, Resume: true, CheckpointDir: dir}
	store, err := newCheckpointStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	cp := checkpoint{
		Version:       checkpointVersion,
		API:           opts.API,
		SourcePath:    src.Path,
		FileSize:      src.Size,
		ModTimeUnixNS: src.ModTime.UnixNano(),
		ObjectID:      "obj",
		SessionID:     "sess",
		Mode:          "multipart",
		PartSize:      2,
		PartCount:     3,
		Name:          opts.Name,
		Conflict:      opts.Conflict,
		Parts:         map[int]string{1: "etag-1"},
	}
	if err := store.save(store.path(opts, src), cp); err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{
		{Status: 200, Body: map[string]any{
			"uploadId": "mp", "mode": "multipart", "partSize": float64(2), "partCount": float64(3),
			"presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
			"requiredHeaders":    map[string]any{},
			"parts": []any{
				map[string]any{"partNumber": float64(2), "url": "https://storage.test/2", "expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "headers": map[string]any{}},
				map[string]any{"partNumber": float64(3), "url": "https://storage.test/3", "expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "headers": map[string]any{}},
			},
		}},
		{Status: 200, Body: map[string]any{"id": "obj", "name": "file.bin", "status": "active"}},
	}}
	storage := &fakeStorage{}
	if err := runWithStorage(context.Background(), opts, host, storage); err != nil {
		t.Fatal(err)
	}
	if storage.maxActive > 2 {
		t.Fatalf("max concurrency = %d, want <= 2", storage.maxActive)
	}
	if storage.seen[2] != "cd" || storage.seen[3] != "ef" {
		t.Fatalf("unexpected part bodies: %#v", storage.seen)
	}
}

func TestUploadMissingPartsNoopsWhenComplete(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	cp := checkpoint{PartCount: 1, PartSize: 3, Parts: map[int]string{1: "etag"}}
	err = uploadMissingParts(context.Background(), uploadOptions{API: "zpan", Concurrency: 1}, &fakeHost{}, &fakeStorage{}, checkpointStore{dir: dir}, filepath.Join(dir, "cp.json"), src, operationSet{}, &cp, nil)
	if err != nil {
		t.Fatal(err)
	}
}

func TestUploadMissingPartsReturnsStorageError(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	cp := checkpoint{Mode: "single", PartCount: 1, PartSize: 3, Parts: map[int]string{}}
	err = uploadMissingParts(context.Background(), uploadOptions{API: "zpan", Concurrency: 1}, &fakeHost{}, &fakeStorage{alwaysErr: storageStatusError{status: 500}}, checkpointStore{dir: dir}, filepath.Join(dir, "cp.json"), src, operationSet{}, &cp, []uploadPart{{PartNumber: 1, URL: "https://storage.test/1", ExpiresAt: time.Now().Add(time.Hour).Format(time.RFC3339)}})
	if err == nil || !strings.Contains(err.Error(), "HTTP 500") {
		t.Fatalf("expected storage error, got %v", err)
	}
}

func TestUploadMissingPartsResumesSingleUploadWithResign(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	cp := checkpoint{
		Version:       checkpointVersion,
		API:           "zpan",
		SourcePath:    src.Path,
		FileSize:      src.Size,
		ModTimeUnixNS: src.ModTime.UnixNano(),
		ObjectID:      "obj",
		SessionID:     "sess",
		Mode:          "single",
		PartSize:      3,
		PartCount:     1,
		Name:          "file.bin",
		Conflict:      "fail",
		Parts:         map[int]string{},
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 200, Body: map[string]any{
		"uploadId": nil, "mode": "single", "partSize": float64(3), "partCount": float64(1),
		"presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
		"requiredHeaders":    map[string]any{"content-type": "application/octet-stream"},
		"parts": []any{map[string]any{
			"partNumber": float64(1),
			"url":        "https://storage.test/single",
			"expiresAt":  time.Now().Add(time.Hour).Format(time.RFC3339),
			"headers":    map[string]any{"content-type": "application/octet-stream"},
		}},
	}}}}
	storage := &fakeStorage{}
	path := filepath.Join(dir, "cp.json")

	err = uploadMissingParts(context.Background(), uploadOptions{API: "zpan", Concurrency: 1}, host, storage, checkpointStore{dir: dir}, path, src, operationSet{Presign: validOps()[1]}, &cp, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(host.requests) != 1 || host.requests[0].URI != "zpan/api/objects/obj/uploads/sess/parts" {
		t.Fatalf("expected single re-sign request, got %#v", host.requests)
	}
	body := host.requests[0].Body.(map[string]any)
	if got := body["partNumbers"].([]int); len(got) != 1 || got[0] != 1 {
		t.Fatalf("unexpected re-sign body: %#v", body)
	}
	if cp.Parts[1] == "" || storage.seen[1] != "abc" {
		t.Fatalf("expected checkpoint etag and uploaded bytes, cp=%#v seen=%#v", cp.Parts, storage.seen)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "https://storage.test") {
		t.Fatalf("checkpoint stored presigned URL: %s", data)
	}
}

func TestPutPartWithRetryResignsAfterExpiredURL(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 200, Body: map[string]any{
		"uploadId": "mp", "mode": "multipart", "partSize": float64(3), "partCount": float64(1),
		"presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
		"requiredHeaders":    map[string]any{},
		"parts":              []any{map[string]any{"partNumber": float64(1), "url": "https://storage.test/new", "expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "headers": map[string]any{}}},
	}}}}
	storage := &fakeStorage{}
	etag, err := putPartWithRetry(context.Background(), uploadOptions{API: "zpan"}, host, storage, operationSet{Presign: validOps()[1]}, checkpoint{Mode: "multipart", ObjectID: "obj", SessionID: "sess", PartSize: 3, PartCount: 1}, src, uploadPart{PartNumber: 1, URL: "https://storage.test/old", ExpiresAt: time.Now().Add(-time.Minute).Format(time.RFC3339)})
	if err != nil {
		t.Fatal(err)
	}
	if etag == "" || len(host.requests) != 1 {
		t.Fatalf("expected re-sign and etag, etag=%q requests=%d", etag, len(host.requests))
	}
}

func TestPutPartWithRetryResignsSingleAfterExpiredURL(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 200, Body: map[string]any{
		"uploadId": nil, "mode": "single", "partSize": float64(3), "partCount": float64(1),
		"presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
		"requiredHeaders":    map[string]any{"content-type": "application/octet-stream"},
		"parts": []any{map[string]any{
			"partNumber": float64(1),
			"url":        "https://storage.test/new-single",
			"expiresAt":  time.Now().Add(time.Hour).Format(time.RFC3339),
			"headers":    map[string]any{"content-type": "application/octet-stream"},
		}},
	}}}}
	storage := &fakeStorage{}
	etag, err := putPartWithRetry(context.Background(), uploadOptions{API: "zpan"}, host, storage, operationSet{Presign: validOps()[1]}, checkpoint{
		Mode:      "single",
		ObjectID:  "obj",
		SessionID: "sess",
		PartSize:  3,
		PartCount: 1,
	}, src, uploadPart{
		PartNumber: 1,
		URL:        "https://storage.test/expired-single",
		ExpiresAt:  time.Now().Add(-time.Minute).Format(time.RFC3339),
		Headers:    map[string]string{"content-type": "application/octet-stream"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if etag == "" || len(host.requests) != 1 {
		t.Fatalf("expected single re-sign and etag, etag=%q requests=%d", etag, len(host.requests))
	}
	if got := storage.seen[1]; got != "abc" {
		t.Fatalf("expected uploaded bytes after re-sign, got %#v", storage.seen)
	}
}

func TestPutPartWithRetryErrors(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	_, err = putPartWithRetry(context.Background(), uploadOptions{API: "zpan"}, &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 200, Body: map[string]any{
		"uploadId": "mp", "mode": "multipart", "partSize": float64(3), "partCount": float64(1),
		"presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "requiredHeaders": map[string]any{}, "parts": []any{},
	}}}}, &fakeStorage{}, operationSet{Presign: validOps()[1]}, checkpoint{Mode: "multipart", ObjectID: "obj", SessionID: "sess", PartSize: 3, PartCount: 1}, src, uploadPart{PartNumber: 1})
	if err == nil || !strings.Contains(err.Error(), "missing part 1") {
		t.Fatalf("expected missing re-sign part error, got %v", err)
	}
	_, err = putPart(context.Background(), &fakeStorage{}, fileIdentity{Path: filepath.Join(dir, "missing"), Size: 1}, 1, uploadPart{PartNumber: 1})
	if err == nil {
		t.Fatal("expected missing source error")
	}
}

func TestResignPartsBatchesAtSchemaLimit(t *testing.T) {
	host := &fakeHost{}
	for batch := 0; batch < 3; batch++ {
		parts := []any{}
		start := batch*100 + 1
		end := min(start+100, 206)
		for partNumber := start; partNumber < end; partNumber++ {
			parts = append(parts, map[string]any{
				"partNumber": float64(partNumber),
				"url":        "https://storage.test/part",
				"expiresAt":  time.Now().Add(time.Hour).Format(time.RFC3339),
				"headers":    map[string]any{},
			})
		}
		host.responses = append(host.responses, &plugin.HTTPResponseMsg{Status: 200, Body: map[string]any{
			"uploadId": "mp", "mode": "multipart", "partSize": float64(1), "partCount": float64(205),
			"presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
			"requiredHeaders":    map[string]any{},
			"parts":              parts,
		}})
	}
	partNumbers := make([]int, 205)
	for i := range partNumbers {
		partNumbers[i] = i + 1
	}
	parts, err := resignParts(context.Background(), uploadOptions{API: "zpan"}, host, operationSet{Presign: validOps()[1]}, checkpoint{Mode: "multipart", ObjectID: "obj", SessionID: "sess"}, partNumbers)
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) != 205 || len(host.requests) != 3 {
		t.Fatalf("parts=%d requests=%d, want 205 parts in 3 requests", len(parts), len(host.requests))
	}
	for i, req := range host.requests {
		body := req.Body.(map[string]any)
		got := body["partNumbers"].([]int)
		if len(got) > 100 {
			t.Fatalf("batch %d has %d part numbers", i, len(got))
		}
	}
}

func TestResignPartsRequiresRequestedPartDescriptors(t *testing.T) {
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 200, Body: map[string]any{
		"uploadId": "mp", "mode": "multipart", "partSize": float64(1), "partCount": float64(2),
		"presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
		"requiredHeaders":    map[string]any{},
		"parts":              []any{map[string]any{"partNumber": float64(1), "url": "https://storage.test/1", "expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "headers": map[string]any{}}},
	}}}}
	_, err := resignParts(context.Background(), uploadOptions{API: "zpan"}, host, operationSet{Presign: validOps()[1]}, checkpoint{Mode: "multipart", ObjectID: "obj", SessionID: "sess"}, []int{1, 2})
	if err == nil || !strings.Contains(err.Error(), "missing part 2") {
		t.Fatalf("expected missing part error, got %v", err)
	}
}

func TestResignAndCompleteErrors(t *testing.T) {
	_, err := resignParts(context.Background(), uploadOptions{API: "zpan"}, &fakeHost{}, operationSet{Presign: validOps()[1]}, checkpoint{Mode: "multipart", ObjectID: "obj", SessionID: "sess"}, []int{1})
	if err == nil || !strings.Contains(err.Error(), "unexpected request") {
		t.Fatalf("expected delegated request error, got %v", err)
	}
	_, err = completeUpload(context.Background(), uploadOptions{API: "zpan"}, &fakeHost{}, operationSet{}, checkpoint{PartCount: 2, Parts: map[int]string{1: "etag"}})
	if err == nil || !strings.Contains(err.Error(), "cannot complete") {
		t.Fatalf("expected incomplete error, got %v", err)
	}
	_, err = completeUpload(context.Background(), uploadOptions{API: "zpan"}, &fakeHost{}, operationSet{Complete: validOps()[2]}, checkpoint{ObjectID: "obj", SessionID: "sess", PartCount: 1, Parts: map[int]string{1: "etag"}})
	if err == nil || !strings.Contains(err.Error(), "unexpected request") {
		t.Fatalf("expected complete request error, got %v", err)
	}
}

func TestAbortCheckpointErrors(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	opts := uploadOptions{API: "zpan", Source: source, Name: "file.bin", Conflict: "fail", Abort: true, CheckpointDir: dir}
	store, err := newCheckpointStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	err = abortCheckpoint(context.Background(), opts, &fakeHost{}, store, store.path(opts, src), src, operationSet{})
	if err == nil || !strings.Contains(err.Error(), "no checkpoint found") {
		t.Fatalf("expected missing checkpoint error, got %v", err)
	}
	cp := checkpoint{Version: checkpointVersion, API: opts.API, SourcePath: src.Path, FileSize: src.Size, ModTimeUnixNS: src.ModTime.UnixNano(), ObjectID: "obj", SessionID: "sess", Mode: "multipart", PartSize: 2, PartCount: 2, Name: opts.Name, Conflict: opts.Conflict, Parts: map[int]string{}}
	path := store.path(opts, src)
	if err := store.save(path, cp); err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 500, Body: map[string]any{"error": "bad"}}}}
	err = abortCheckpoint(context.Background(), opts, host, store, path, src, operationSet{Abort: validOps()[3]})
	if err == nil || !strings.Contains(err.Error(), "HTTP 500") {
		t.Fatalf("expected abort status error, got %v", err)
	}
	wrongDestination := opts
	wrongDestination.Name = "other.bin"
	err = abortCheckpoint(context.Background(), wrongDestination, &fakeHost{}, store, path, src, operationSet{Abort: validOps()[3]})
	if err == nil || !strings.Contains(err.Error(), "checkpoint destination differs") {
		t.Fatalf("expected checkpoint validation error, got %v", err)
	}
}

func TestAbortUsesDelegatedDeleteAndRemovesCheckpoint(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	src := fileIdentity{Path: source, Size: info.Size(), ModTime: info.ModTime()}
	opts := uploadOptions{API: "zpan", Source: source, Name: "file.bin", Conflict: "fail", Abort: true, CheckpointDir: dir}
	store, err := newCheckpointStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	cp := checkpoint{
		Version:       checkpointVersion,
		API:           opts.API,
		SourcePath:    src.Path,
		FileSize:      src.Size,
		ModTimeUnixNS: src.ModTime.UnixNano(),
		ObjectID:      "obj",
		SessionID:     "sess",
		Mode:          "multipart",
		PartSize:      2,
		PartCount:     2,
		Name:          opts.Name,
		Conflict:      opts.Conflict,
		Parts:         map[int]string{},
	}
	path := store.path(opts, src)
	if err := store.save(path, cp); err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 204}}}
	if err := runWithStorage(context.Background(), opts, host, &fakeStorage{}); err != nil {
		t.Fatal(err)
	}
	if len(host.requests) != 1 || host.requests[0].Method != "DELETE" || host.requests[0].URI != "zpan/api/objects/obj/uploads/sess" {
		t.Fatalf("unexpected abort request: %#v", host.requests)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("checkpoint still exists: %v", err)
	}
}

func TestAbortAcceptsSuccessBody(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	opts := uploadOptions{API: "zpan", Source: source, Name: "file.bin", Conflict: "fail", Abort: true, CheckpointDir: dir}
	store, err := newCheckpointStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	cp := checkpoint{
		Version:       checkpointVersion,
		API:           opts.API,
		SourcePath:    src.Path,
		FileSize:      src.Size,
		ModTimeUnixNS: src.ModTime.UnixNano(),
		ObjectID:      "obj",
		SessionID:     "sess",
		Mode:          "single",
		PartSize:      3,
		PartCount:     1,
		Name:          opts.Name,
		Conflict:      opts.Conflict,
		Parts:         map[int]string{},
	}
	path := store.path(opts, src)
	if err := store.save(path, cp); err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 200, Body: map[string]any{"aborted": true}}}}
	if err := abortCheckpoint(context.Background(), opts, host, store, path, src, operationSet{Abort: validOps()[3]}); err != nil {
		t.Fatal(err)
	}
	if host.body == nil {
		t.Fatal("expected abort response body")
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("checkpoint still exists: %v", err)
	}
}

func TestAbortDoesNotRequireCurrentSourceFile(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	opts := uploadOptions{API: "zpan", Source: source, Name: "file.bin", Conflict: "fail", Abort: true, CheckpointDir: dir}
	store, err := newCheckpointStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	path := store.path(opts, src)
	cp := checkpoint{
		Version:       checkpointVersion,
		API:           opts.API,
		SourcePath:    src.Path,
		FileSize:      src.Size,
		ModTimeUnixNS: src.ModTime.UnixNano(),
		ObjectID:      "obj",
		SessionID:     "sess",
		Mode:          "multipart",
		PartSize:      2,
		PartCount:     2,
		Name:          opts.Name,
		Conflict:      opts.Conflict,
		Parts:         map[int]string{},
	}
	if err := store.save(path, cp); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(source); err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 204}}}
	if err := runWithStorage(context.Background(), opts, host, &fakeStorage{}); err != nil {
		t.Fatal(err)
	}
	if len(host.requests) != 1 || host.requests[0].Method != "DELETE" {
		t.Fatalf("unexpected abort request: %#v", host.requests)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("checkpoint still exists: %v", err)
	}
}

func TestAbortIgnoresChangedSourceFile(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := statSource(source)
	if err != nil {
		t.Fatal(err)
	}
	opts := uploadOptions{API: "zpan", Source: source, Name: "file.bin", Conflict: "fail", Abort: true, CheckpointDir: dir}
	store, err := newCheckpointStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	path := store.path(opts, src)
	cp := checkpoint{
		Version:       checkpointVersion,
		API:           opts.API,
		SourcePath:    src.Path,
		FileSize:      src.Size,
		ModTimeUnixNS: src.ModTime.UnixNano(),
		ObjectID:      "obj",
		SessionID:     "sess",
		Mode:          "multipart",
		PartSize:      2,
		PartCount:     2,
		Name:          opts.Name,
		Conflict:      opts.Conflict,
		Parts:         map[int]string{},
	}
	if err := store.save(path, cp); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("changed contents"), 0o600); err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 204}}}
	if err := runWithStorage(context.Background(), opts, host, &fakeStorage{}); err != nil {
		t.Fatal(err)
	}
	if len(host.requests) != 1 || host.requests[0].URI != "zpan/api/objects/obj/uploads/sess" {
		t.Fatalf("unexpected abort request: %#v", host.requests)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("checkpoint still exists: %v", err)
	}
}

func TestRunRejectsInvalidArgs(t *testing.T) {
	if err := Run(nil, []string{}, &fakeHost{}); err == nil || !strings.Contains(err.Error(), "usage: restish zpan-upload") {
		t.Fatalf("expected usage error, got %v", err)
	}
}

func TestRunReturnsHelp(t *testing.T) {
	host := &fakeHost{}
	if err := Run(nil, []string{"--help"}, host); err != nil {
		t.Fatal(err)
	}
	body, ok := host.body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected help body: %#v", host.body)
	}
	examples := strings.Join(body["examples"].([]string), "\n")
	if !strings.Contains(examples, "RSH_PROFILE=file-manager") || !strings.Contains(examples, "--profile file-manager") {
		t.Fatalf("help examples do not select profiles: %q", examples)
	}
	if len(host.requests) != 0 {
		t.Fatalf("help should not make delegated requests: %#v", host.requests)
	}
}

func TestRunWithStorageRejectsMissingSource(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing.bin")
	err := runWithStorage(context.Background(), uploadOptions{API: "zpan", Source: missing, Name: "missing.bin", Conflict: "fail", Concurrency: 1}, &fakeHost{}, &fakeStorage{})
	if err == nil || !strings.Contains(err.Error(), "missing.bin") {
		t.Fatalf("expected missing source error, got %v", err)
	}
}

func TestCurrentPartsAndCompleteUploadErrors(t *testing.T) {
	ops := operationSet{Presign: validOps()[1], Complete: validOps()[2]}
	opts := uploadOptions{API: "zpan"}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{{Status: 200, Body: map[string]any{
		"uploadId": nil, "mode": "single", "partSize": float64(3), "partCount": float64(1),
		"presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
		"requiredHeaders":    map[string]any{},
		"parts":              []any{map[string]any{"partNumber": float64(1), "url": "https://storage.test/1", "expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "headers": map[string]any{}}},
	}}}}
	parts, err := currentParts(context.Background(), opts, host, ops, checkpoint{Mode: "single", ObjectID: "obj", SessionID: "sess", PartCount: 1}, []int{1}, nil)
	if err != nil || len(parts) != 1 || parts[0].URL == "" {
		t.Fatalf("expected re-signed single part, got parts=%#v err=%v", parts, err)
	}
	_, err = currentParts(context.Background(), opts, &fakeHost{}, ops, checkpoint{}, []int{2}, []uploadPart{{PartNumber: 1}})
	if err == nil || !strings.Contains(err.Error(), "part 2") {
		t.Fatalf("expected missing initial part error, got %v", err)
	}
	_, err = completeUpload(context.Background(), opts, &fakeHost{}, ops, checkpoint{PartCount: 2, Parts: map[int]string{1: "etag"}})
	if err == nil || !strings.Contains(err.Error(), "cannot complete") {
		t.Fatalf("expected incomplete upload error, got %v", err)
	}
}

func TestPutPartWithRetryResignsMultipart(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abcd"), 0o600); err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{
		{Status: 200, Body: map[string]any{
			"uploadId": "mp", "mode": "multipart", "partSize": float64(2), "partCount": float64(2),
			"presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
			"requiredHeaders":    map[string]any{},
			"parts": []any{
				map[string]any{"partNumber": float64(1), "url": "https://storage.test/1b", "expiresAt": time.Now().Add(time.Hour).Format(time.RFC3339), "headers": map[string]any{}},
			},
		}},
	}}
	storage := &fakeStorage{failFirst: true}
	etag, err := putPartWithRetry(context.Background(), uploadOptions{API: "zpan"}, host, storage, operationSet{Presign: validOps()[1]}, checkpoint{
		ObjectID:  "obj",
		SessionID: "sess",
		Mode:      "multipart",
		PartSize:  2,
		PartCount: 2,
	}, fileIdentity{Path: source, Size: 4}, uploadPart{PartNumber: 1, URL: "https://storage.test/1", ExpiresAt: time.Now().Add(time.Hour).Format(time.RFC3339)})
	if err != nil {
		t.Fatal(err)
	}
	if etag == "" {
		t.Fatal("expected etag after retry")
	}
	if len(host.requests) != 1 || !strings.Contains(host.requests[0].URI, "/uploads/sess/parts") {
		t.Fatalf("expected re-sign request, got %#v", host.requests)
	}
}

func TestPutPartWithRetryResignsSingleAfterStorage403(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{responses: []*plugin.HTTPResponseMsg{
		{Status: 200, Body: map[string]any{
			"uploadId": nil, "mode": "single", "partSize": float64(3), "partCount": float64(1),
			"presignedExpiresAt": time.Now().Add(time.Hour).Format(time.RFC3339),
			"requiredHeaders":    map[string]any{"content-type": "application/octet-stream"},
			"parts": []any{
				map[string]any{
					"partNumber": float64(1),
					"url":        "https://storage.test/1b",
					"expiresAt":  time.Now().Add(time.Hour).Format(time.RFC3339),
					"headers":    map[string]any{"content-type": "application/octet-stream"},
				},
			},
		}},
	}}
	storage := &fakeStorage{failFirst: true}
	etag, err := putPartWithRetry(context.Background(), uploadOptions{API: "zpan"}, host, storage, operationSet{Presign: validOps()[1]}, checkpoint{
		ObjectID:  "obj",
		SessionID: "sess",
		Mode:      "single",
		PartSize:  3,
		PartCount: 1,
	}, fileIdentity{Path: source, Size: 3}, uploadPart{
		PartNumber: 1,
		URL:        "https://storage.test/1",
		ExpiresAt:  time.Now().Add(time.Hour).Format(time.RFC3339),
		Headers:    map[string]string{"content-type": "application/octet-stream"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if etag == "" {
		t.Fatal("expected etag after retry")
	}
	if len(host.requests) != 1 || !strings.Contains(host.requests[0].URI, "/uploads/sess/parts") {
		t.Fatalf("expected single re-sign request, got %#v", host.requests)
	}
	body := host.requests[0].Body.(map[string]any)
	if got := body["partNumbers"].([]int); len(got) != 1 || got[0] != 1 {
		t.Fatalf("unexpected re-sign body: %#v", body)
	}
	if storage.seen[1] != "abc" {
		t.Fatalf("expected retried bytes to upload, got %#v", storage.seen)
	}
}

func TestAbortCheckpointMissingState(t *testing.T) {
	dir := t.TempDir()
	store, err := newCheckpointStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(dir, "file.bin")
	if err := os.WriteFile(source, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	err = abortCheckpoint(context.Background(), uploadOptions{API: "zpan", Source: source, Name: "file.bin", Conflict: "fail"}, &fakeHost{}, store, filepath.Join(dir, "missing.json"), fileIdentity{
		Path: source, Size: info.Size(), ModTime: info.ModTime(),
	}, operationSet{Abort: validOps()[3]})
	if err == nil || !strings.Contains(err.Error(), "no checkpoint found") {
		t.Fatalf("expected missing checkpoint error, got %v", err)
	}
}

func TestStatSourceAndPartRangeHelpers(t *testing.T) {
	dir := t.TempDir()
	if _, err := statSource(dir); err == nil || !strings.Contains(err.Error(), "source must be a file") {
		t.Fatalf("expected directory error, got %v", err)
	}
	offset, size := partRange(0, 10, 1)
	if offset != 0 || size != 0 {
		t.Fatalf("unexpected zero-length range: %d %d", offset, size)
	}
	offset, size = partRange(5, 4, 2)
	if offset != 4 || size != 1 {
		t.Fatalf("unexpected final range: %d %d", offset, size)
	}
	if got := expandUploadPath("/api/objects/{id}/uploads/{uploadSessionId}", checkpoint{ObjectID: "obj", SessionID: "sess"}); got != "/api/objects/obj/uploads/sess" {
		t.Fatalf("unexpected expanded path: %s", got)
	}
}

func validOps() []plugin.APIOperation {
	return []plugin.APIOperation{
		{
			ID:            opCreate,
			Method:        "POST",
			Path:          "/api/objects",
			HasBody:       true,
			RequestSchema: map[string]any{"properties": map[string]any{"name": map[string]any{}, "type": map[string]any{}, "size": map[string]any{}, "parent": map[string]any{}, "onConflict": map[string]any{}}},
		},
		{
			ID:            opPresign,
			Method:        "POST",
			Path:          "/api/objects/{id}/uploads/{uploadSessionId}/parts",
			HasBody:       true,
			RequestSchema: map[string]any{"properties": map[string]any{"partNumbers": map[string]any{}}},
			Parameters:    uploadParams(),
		},
		{
			ID:            opComplete,
			Method:        "POST",
			Path:          "/api/objects/{id}/uploads/{uploadSessionId}/completions",
			HasBody:       true,
			RequestSchema: map[string]any{"properties": map[string]any{"parts": map[string]any{}}},
			Parameters:    uploadParams(),
		},
		{ID: opAbort, Method: "DELETE", Path: "/api/objects/{id}/uploads/{uploadSessionId}", Parameters: uploadParams()},
	}
}

func uploadParams() []plugin.APIParam {
	return []plugin.APIParam{
		{Name: "id", In: "path", Required: true},
		{Name: "uploadSessionId", In: "path", Required: true},
	}
}
