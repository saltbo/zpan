package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/config"
)

// infoDict is a bencoded v1 info dictionary of a multi-file torrent; the piece
// hashes are filler, since the fake server does not verify them.
func infoDict(name string, files map[string]int) []byte {
	var b strings.Builder
	b.WriteString("d5:filesl")
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}
	slices.Sort(paths)
	for _, p := range paths {
		fmt.Fprintf(&b, "d6:lengthi%de4:pathl", files[p])
		for _, segment := range strings.Split(p, "/") {
			fmt.Fprintf(&b, "%d:%s", len(segment), segment)
		}
		b.WriteString("ee")
	}
	fmt.Fprintf(&b, "e4:name%d:%s12:piece lengthi16384e6:pieces20:%se", len(name), name, strings.Repeat("x", 20))
	return []byte(b.String())
}

func torrentFile(info []byte) []byte {
	return append(append([]byte("d8:announce3:udp4:info"), info...), 'e')
}

// metadataEngine is an engine whose metadata resolves after `pending` calls.
type metadataEngine struct {
	*recordingEngine
	mu       sync.Mutex
	metadata []byte
	pending  int
	// partial calls return a .torrent cut short, as one still being written.
	partial int
	err     error
	calls   int
}

func (e *metadataEngine) TorrentMetadata(context.Context, DownloadTask) ([]byte, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.calls++
	if e.err != nil {
		return nil, e.err
	}
	if e.pending > 0 {
		e.pending--
		return nil, ErrTorrentMetadataPending
	}
	if e.partial > 0 {
		e.partial--
		return e.metadata[:len(e.metadata)/2], nil
	}
	return e.metadata, nil
}

// fastRetries makes the metadata and part retries immediate for a test.
func fastRetries(t *testing.T) {
	metadata, part := metadataRetryDelay, partRetryDelay
	metadataRetryDelay, partRetryDelay = time.Millisecond, time.Millisecond
	t.Cleanup(func() { metadataRetryDelay, partRetryDelay = metadata, part })
}

// cacheServer fakes the torrent cache API over the recording API: presigned
// uploads land in its bucket by key.
type cacheServer struct {
	*recordingAPI
	mu           sync.Mutex
	url          string
	outcome      string
	files        []client.TorrentFile
	name         string
	registered   [][]byte
	bucket       map[string]string
	completed    []string
	layouts      []json.RawMessage
	completions  [][]client.TorrentFile
	refuseLayout int
	aborted      []string
	registerErr  error
	// failPuts presigned PUTs answer 500 before they succeed; -1 fails all.
	failPuts int
	puts     int
	uploadID *string
}

func newCacheServer(t *testing.T, outcome string, name string, files []client.TorrentFile) *cacheServer {
	s := &cacheServer{recordingAPI: &recordingAPI{}, outcome: outcome, name: name, files: files, bucket: map[string]string{}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		defer s.mu.Unlock()
		s.puts++
		if s.failPuts != 0 {
			if s.failPuts > 0 {
				s.failPuts--
			}
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		s.bucket[strings.TrimPrefix(r.URL.Path, "/")] = string(data)
		w.Header().Set("ETag", `"etag"`)
	}))
	t.Cleanup(server.Close)
	s.url = server.URL
	return s
}

func (s *cacheServer) RegisterTaskTorrent(_ context.Context, _ string, _ string, info []byte) (client.TorrentRegistration, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.registered = append(s.registered, info)
	if s.registerErr != nil {
		return client.TorrentRegistration{}, s.registerErr
	}
	return client.TorrentRegistration{Outcome: s.outcome, InfoHash: "abc", Name: s.name, Files: s.files}, nil
}

func (s *cacheServer) upload(key string, size int64) client.TorrentUpload {
	return client.TorrentUpload{UploadID: s.uploadID, PartSize: size, Parts: []client.TorrentUploadPart{{PartNumber: 1, URL: s.url + "/" + key, Length: size}}}
}

func (s *cacheServer) CreateTorrentFileUpload(_ context.Context, _ string, _ string, fileIdx int) (client.TorrentUpload, error) {
	for _, file := range s.files {
		if file.FileIdx == fileIdx {
			return s.upload(fmt.Sprintf("file/%d", fileIdx), file.Size), nil
		}
	}
	return client.TorrentUpload{}, errors.New("no such file")
}

func (s *cacheServer) AbortTorrentFileUpload(_ context.Context, _ string, _ string, fileIdx int, uploadID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.aborted = append(s.aborted, fmt.Sprintf("file/%d %s", fileIdx, uploadID))
	return nil
}

func (s *cacheServer) CompleteTorrentFileUpload(_ context.Context, _ string, _ string, fileIdx int, _ *string, _ []client.CompletedObjectUploadPart) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.completed = append(s.completed, fmt.Sprintf("file/%d", fileIdx))
	return nil
}

func (s *cacheServer) CreateTorrentSidecarUpload(_ context.Context, _ string, _ string, n int, size int64) (client.TorrentUpload, error) {
	return s.upload(fmt.Sprintf("x/%d", n), size), nil
}

func (s *cacheServer) CompleteTorrentSidecarUpload(_ context.Context, _ string, _ string, n int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.completed = append(s.completed, fmt.Sprintf("x/%d", n))
	return nil
}

func (s *cacheServer) PutTaskTorrentLayout(_ context.Context, _ string, _ string, layout any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.refuseLayout > 0 {
		s.refuseLayout--
		return &client.StatusError{Status: http.StatusBadRequest, Message: "invalid"}
	}
	data, _ := json.Marshal(layout)
	s.layouts = append(s.layouts, data)
	return nil
}

func (s *cacheServer) CompleteTaskTorrent(_ context.Context, _ string, _ string, files []client.TorrentFile) (client.DownloadTask, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.completions = append(s.completions, files)
	return client.DownloadTask{}, nil
}

func cacheTask(id string) client.DownloadTask {
	task := clientTaskWithUploadToken(id, "assigned")
	task.Spec.Source.URI = "magnet:?xt=urn:btih:abc"
	task.Status.Assignment.TorrentCache = true
	return task
}

// download writes the torrent's files under dir/<root> the way an engine leaves
// a finished multi-file download.
func download(t *testing.T, dir string, root string, files map[string]string) Result {
	t.Helper()
	for p, content := range files {
		full := filepath.Join(dir, root, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return Result{Path: filepath.Join(dir, root), Name: root, IsDir: true}
}

func cacheRunner(api apiClient, engine Downloader) *TaskRunner {
	w := NewTaskRunnerWithAPI(config.Config{MaxConcurrentTasks: 1}, api)
	w.logger = discardLogger()
	w.downloader = NewManagerWithDownloader(engine)
	return w
}

// [spec: torrent-cache/downloader-fills-cache]
func TestCapableDownloaderFillsTheCache(t *testing.T) {
	info := infoDict("Show", map[string]int{"a.mkv": 5, "sub/b.srt": 3})
	files := []client.TorrentFile{{FileIdx: 0, Path: "a.mkv", Size: 5}, {FileIdx: 1, Path: "sub/b.srt", Size: 3}}
	api := newCacheServer(t, client.TorrentOutcomeFill, "Show", files)
	dir := t.TempDir()
	// The metadata resolves while the download runs; the engine named the
	// root folder after the requested name.
	engine := &metadataEngine{recordingEngine: &recordingEngine{}, metadata: torrentFile(info), pending: 1}
	result := download(t, dir, "Requested", map[string]string{"a.mkv": "video", "sub/b.srt": "srt"})
	engine.downloadFunc = func(_ context.Context, _ DownloadTask, progress ProgressReporter) (Result, error) {
		_ = progress(ProgressUpdate{Downloaded: 1})
		return result, nil
	}
	w := cacheRunner(api, engine)

	if heartbeat := w.heartbeat(); !slices.Contains(heartbeat.Capabilities, TorrentCacheCapability) {
		t.Fatalf("capabilities = %v", heartbeat.Capabilities)
	}
	w.process(context.Background(), cacheTask("task-1"))

	if len(api.registered) != 1 || string(api.registered[0]) != string(info) {
		t.Fatalf("registered = %q", api.registered)
	}
	if api.bucket["file/0"] != "video" || api.bucket["file/1"] != "srt" {
		t.Fatalf("bucket = %v", api.bucket)
	}
	if len(api.completions) != 1 || len(api.completions[0]) != 2 {
		t.Fatalf("completions = %v", api.completions)
	}
	// No layout without scraping, and the server completes the task itself.
	if len(api.layouts) != 0 {
		t.Fatalf("layouts = %s", api.layouts)
	}
	if _, ok := findPatchWithStatus(api.patches, "completed"); ok {
		t.Fatalf("the downloader completed the task itself: %#v", api.patches)
	}
	if _, err := os.Stat(result.Path); !os.IsNotExist(err) {
		t.Fatalf("local download kept: %v", err)
	}
}

func TestTaskSettledByTheCacheDropsItsDownload(t *testing.T) {
	for _, outcome := range []string{client.TorrentOutcomeJoined, client.TorrentOutcomeCompleted} {
		t.Run(outcome, func(t *testing.T) {
			api := newCacheServer(t, outcome, "Show", nil)
			engine := &metadataEngine{recordingEngine: &recordingEngine{}, metadata: infoDict("Show", map[string]int{"a.mkv": 5})}
			engine.downloadFunc = func(ctx context.Context, _ DownloadTask, progress ProgressReporter) (Result, error) {
				_ = progress(ProgressUpdate{Downloaded: 1})
				<-ctx.Done()
				return Result{}, ctx.Err()
			}
			w := cacheRunner(api, engine)
			task := cacheTask("task-1")
			ctx, ok := w.startTask(context.Background(), task.ID)
			if !ok {
				t.Fatal("task did not start")
			}

			w.process(ctx, task)

			if engine.resetCalls != 1 {
				t.Fatalf("reset calls = %d", engine.resetCalls)
			}
			for _, patch := range api.patches {
				if state := patch.State(); state != "" && state != "downloading" {
					t.Fatalf("the downloader changed a settled task: %#v", patch)
				}
			}
			if len(api.completed) != 0 {
				t.Fatalf("uploaded = %v", api.completed)
			}
		})
	}
}

// [spec: torrent-cache/legacy-downloader-unchanged]
func TestDriveOutcomeAndTasksOutsideCacheModeUploadIntoTheDrive(t *testing.T) {
	for name, task := range map[string]client.DownloadTask{
		"drive outcome":  cacheTask("task-1"),
		"not cache mode": clientTaskWithUploadToken("task-1", "assigned"),
	} {
		t.Run(name, func(t *testing.T) {
			api := newCacheServer(t, client.TorrentOutcomeDrive, "Show", nil)
			api.createFolderErr = errors.New("drive upload")
			engine := &metadataEngine{recordingEngine: &recordingEngine{}, metadata: infoDict("Show", map[string]int{"a.mkv": 5})}
			engine.downloadResult = download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video", "b.mkv": "video"})
			w := cacheRunner(api, engine)

			w.process(context.Background(), task)

			failed := lastPatchWithStatus(t, api.patches, "failed")
			if failed.ErrorMessage == nil || !strings.Contains(*failed.ErrorMessage, "drive upload") {
				t.Fatalf("failed = %#v", failed)
			}
			if len(api.completed) != 0 {
				t.Fatalf("uploaded into the cache: %v", api.completed)
			}
		})
	}
}

// probedEngine is a metadata engine that may lack the export, like a
// qBittorrent older than 4.5.
type probedEngine struct {
	*metadataEngine
	canExport bool
}

func (e *probedEngine) CanExportTorrentMetadata(context.Context) bool { return e.canExport }

func TestCapabilityFollowsTheEnginesExport(t *testing.T) {
	api := newCacheServer(t, client.TorrentOutcomeFill, "", nil)
	for canExport, want := range map[bool]bool{true: true, false: false} {
		engine := &probedEngine{metadataEngine: &metadataEngine{recordingEngine: &recordingEngine{}}, canExport: canExport}
		if got := slices.Contains(cacheRunner(api, engine).heartbeat().Capabilities, TorrentCacheCapability); got != want {
			t.Errorf("export %v: reported torrent-cache = %v", canExport, got)
		}
	}
}

func TestDownloaderWithoutMetadataSupportDoesNotReportTheCapability(t *testing.T) {
	w := cacheRunner(newCacheServer(t, client.TorrentOutcomeFill, "", nil), &recordingEngine{})
	if slices.Contains(w.heartbeat().Capabilities, TorrentCacheCapability) {
		t.Fatal("reported torrent-cache without an engine that exports metadata")
	}
	w = cacheRunner(&recordingAPI{}, &metadataEngine{recordingEngine: &recordingEngine{}})
	if slices.Contains(w.heartbeat().Capabilities, TorrentCacheCapability) {
		t.Fatal("reported torrent-cache without an API client that speaks the cache API")
	}
}

// A cache-mode task whose engine never hands over readable metadata (an old
// qBittorrent without torrents/export, a .torrent that stays unreadable) gives
// up on the cache after the retry budget and uploads into the drive, though the
// server still has the task in cache mode.
func TestMetadataThatNeverBecomesReadableUploadsIntoTheDrive(t *testing.T) {
	fastRetries(t)
	for name, engine := range map[string]*metadataEngine{
		"unreadable":  {metadata: []byte("not bencode")},
		"pending":     {pending: 1 << 30},
		"no export":   {err: errors.New("export torrent metadata: not found")},
		"cut forever": {metadata: torrentFile(infoDict("Show", map[string]int{"a.mkv": 5})), partial: 1 << 30},
	} {
		t.Run(name, func(t *testing.T) {
			api := newCacheServer(t, client.TorrentOutcomeFill, "Show", nil)
			api.createFolderErr = errors.New("drive upload")
			engine.recordingEngine = &recordingEngine{}
			engine.downloadResult = download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video", "b.mkv": "video"})
			w := cacheRunner(api, engine)

			w.process(context.Background(), cacheTask("task-1"))

			if len(api.registered) != 0 {
				t.Fatalf("registered = %q", api.registered)
			}
			if engine.calls != metadataAttempts {
				t.Fatalf("metadata read %d times, want %d", engine.calls, metadataAttempts)
			}
			failed := lastPatchWithStatus(t, api.patches, "failed")
			if failed.ErrorMessage == nil || !strings.Contains(*failed.ErrorMessage, "drive upload") {
				t.Fatalf("did not upload into the drive: %#v", failed)
			}
		})
	}
}

// A .torrent read while aria2 is still writing it is retried, not taken as
// unreadable.
func TestPartlyWrittenMetadataIsRetried(t *testing.T) {
	fastRetries(t)
	info := infoDict("Show", map[string]int{"a.mkv": 5})
	files := []client.TorrentFile{{FileIdx: 0, Path: "a.mkv", Size: 5}}
	api := newCacheServer(t, client.TorrentOutcomeFill, "Show", files)
	engine := &metadataEngine{recordingEngine: &recordingEngine{}, metadata: torrentFile(info), partial: 2}
	engine.downloadResult = download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video"})
	w := cacheRunner(api, engine)

	w.process(context.Background(), cacheTask("task-1"))

	if len(api.registered) != 1 || string(api.registered[0]) != string(info) {
		t.Fatalf("registered = %q", api.registered)
	}
	if api.bucket["file/0"] != "video" || len(api.completions) != 1 {
		t.Fatalf("bucket = %v, completions = %v", api.bucket, api.completions)
	}
}

// A 409 on registration means the server released, joined or completed the
// task: it stops and leaves nothing behind, and nothing goes into the drive,
// which would be a second copy.
func TestConflictOnRegistrationStopsTheTask(t *testing.T) {
	api := newCacheServer(t, client.TorrentOutcomeFill, "Show", nil)
	api.registerErr = &client.StatusError{Status: http.StatusConflict, Message: "Task is not filling the torrent cache"}
	api.createFolderErr = errors.New("drive upload")
	engine := &metadataEngine{recordingEngine: &recordingEngine{}, metadata: infoDict("Show", map[string]int{"a.mkv": 5})}
	engine.downloadResult = download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video"})
	w := cacheRunner(api, engine)

	w.process(context.Background(), cacheTask("task-1"))

	if len(api.registered) != 1 {
		t.Fatalf("registered = %q", api.registered)
	}
	for _, patch := range api.patches {
		if state := patch.State(); state == "failed" || state == "completed" || state == "uploading" {
			t.Fatalf("the downloader changed a released task: %#v", patch)
		}
	}
	if len(api.createFolderDrafts) != 0 || len(api.completed) != 0 {
		t.Fatalf("uploaded: drive %v, cache %v", api.createFolderDrafts, api.completed)
	}
	// The engine removes the local download.
	if engine.resetCalls != 1 {
		t.Fatalf("reset calls = %d", engine.resetCalls)
	}
}

func TestFailedPartUploadsAreRetriedThenAborted(t *testing.T) {
	fastRetries(t)
	info := infoDict("Show", map[string]int{"a.mkv": 5})
	files := []client.TorrentFile{{FileIdx: 0, Path: "a.mkv", Size: 5}}
	uploadID := "mp-1"

	api := newCacheServer(t, client.TorrentOutcomeFill, "Show", files)
	api.uploadID = &uploadID
	api.failPuts = partAttempts - 1
	engine := &metadataEngine{recordingEngine: &recordingEngine{}, metadata: torrentFile(info)}
	engine.downloadResult = download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video"})
	cacheRunner(api, engine).process(context.Background(), cacheTask("task-1"))
	if api.bucket["file/0"] != "video" || len(api.completions) != 1 || len(api.aborted) != 0 {
		t.Fatalf("bucket = %v, completions = %v, aborted = %v", api.bucket, api.completions, api.aborted)
	}

	api = newCacheServer(t, client.TorrentOutcomeFill, "Show", files)
	api.uploadID = &uploadID
	api.failPuts = -1
	engine = &metadataEngine{recordingEngine: &recordingEngine{}, metadata: torrentFile(info)}
	engine.downloadResult = download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video"})
	cacheRunner(api, engine).process(context.Background(), cacheTask("task-1"))
	if api.puts != partAttempts {
		t.Fatalf("puts = %d, want %d", api.puts, partAttempts)
	}
	if len(api.aborted) != 1 || api.aborted[0] != "file/0 mp-1" {
		t.Fatalf("aborted = %v", api.aborted)
	}
	if len(api.completions) != 0 {
		t.Fatalf("completed after a failed upload: %v", api.completions)
	}
	lastPatchWithStatus(t, api.patches, "failed")
}

// [spec: torrent-cache/layout-replay]
func TestScrapedDownloadCachesItsLayout(t *testing.T) {
	dir := t.TempDir()
	video := "Breaking.Bad.S01E02.mkv"
	plan := showPlan(t, dir, video)
	videoLocal := plan.Files[0].LocalPath
	files := []client.TorrentFile{{FileIdx: 0, Path: video, Size: 5}}
	api := newCacheServer(t, client.TorrentOutcomeFill, video, files)
	uploader := NewUploader(api, nil)

	notices, err := uploader.uploadToCache(context.Background(), discardLogger(), cacheTask("task-1"),
		Result{Path: videoLocal, Name: video, Plan: &plan}, client.TorrentRegistration{Outcome: "fill", Name: video, Files: files})
	if err != nil || len(notices) != 0 {
		t.Fatalf("err = %v, notices = %v", err, notices)
	}
	if api.bucket["file/0"] != "video" {
		t.Fatalf("bucket = %v", api.bucket)
	}
	var layout struct {
		Entries []struct {
			Kind    string         `json:"kind"`
			Path    string         `json:"path"`
			FileIdx *int           `json:"fileIdx"`
			Sidecar *int           `json:"sidecar"`
			Video   string         `json:"video"`
			Media   map[string]any `json:"media"`
		} `json:"entries"`
	}
	if len(api.layouts) != 1 {
		t.Fatalf("layouts = %d", len(api.layouts))
	}
	if err := json.Unmarshal(api.layouts[0], &layout); err != nil {
		t.Fatal(err)
	}
	byPath := map[string]int{}
	for i, entry := range layout.Entries {
		byPath[entry.Path] = i
	}
	show := layout.Entries[byPath["Breaking Bad (2008)"]]
	if show.Kind != "folder" || show.Media["kind"] != "tvshow" || show.Media["poster"] != "Breaking Bad (2008)/poster.jpg" {
		t.Fatalf("show = %#v", show)
	}
	episode := layout.Entries[byPath["Breaking Bad (2008)/Season 01/"+video]]
	if episode.Kind != "torrent-file" || *episode.FileIdx != 0 || episode.Media["kind"] != "episode" ||
		episode.Media["still"] != "Breaking Bad (2008)/Season 01/Breaking.Bad.S01E02-thumb.jpg" {
		t.Fatalf("episode = %#v", episode)
	}
	nfo := layout.Entries[byPath["Breaking Bad (2008)/Season 01/Breaking.Bad.S01E02.nfo"]]
	if nfo.Kind != "sidecar" || nfo.Video != "Breaking Bad (2008)/Season 01/"+video {
		t.Fatalf("nfo = %#v", nfo)
	}
	tvshow := layout.Entries[byPath["Breaking Bad (2008)/tvshow.nfo"]]
	if tvshow.Kind != "sidecar" || tvshow.Video != "" || !strings.Contains(api.bucket[fmt.Sprintf("x/%d", *tvshow.Sidecar)], "<tvshow>") {
		t.Fatalf("tvshow = %#v, bucket = %v", tvshow, api.bucket)
	}
	if _, ok := byPath["Breaking Bad (2008)/Season 01"]; !ok {
		t.Fatal("season folder missing")
	}
	// Every sidecar went up before the layout named it.
	if got := len(api.completed); got != len(plan.Files) {
		t.Fatalf("completed uploads = %v", api.completed)
	}
}

func TestRefusedLayoutMediaKeepsTheFoldersAndSidecars(t *testing.T) {
	dir := t.TempDir()
	video := "Big.Buck.Bunny.mkv"
	plan := moviePlan(t, dir, video)
	files := []client.TorrentFile{{FileIdx: 0, Path: video, Size: 5}}
	api := newCacheServer(t, client.TorrentOutcomeFill, video, files)
	api.refuseLayout = 1

	notices, err := NewUploader(api, nil).uploadToCache(context.Background(), discardLogger(), cacheTask("task-1"),
		Result{Path: plan.Files[0].LocalPath, Name: video, Plan: &plan}, client.TorrentRegistration{Name: video, Files: files})
	if err != nil {
		t.Fatal(err)
	}
	if len(notices) != 1 || len(api.layouts) != 1 || strings.Contains(string(api.layouts[0]), `"media"`) {
		t.Fatalf("notices = %v, layouts = %s", notices, api.layouts)
	}
	if len(api.completions) != 1 {
		t.Fatal("torrent not completed")
	}
}

func TestTorrentLocalFilesFindsFilesWhateverTheRootIsNamed(t *testing.T) {
	dir := t.TempDir()
	download(t, dir, "Renamed", map[string]string{"a.mkv": "video", "sub/b.srt": "srt"})
	if err := os.WriteFile(filepath.Join(dir, ".zpan-metadata.torrent"), []byte("d"), 0o644); err != nil {
		t.Fatal(err)
	}
	registration := client.TorrentRegistration{Name: "Show", Files: []client.TorrentFile{
		{FileIdx: 0, Path: "a.mkv", Size: 5}, {FileIdx: 2, Path: "sub/b.srt", Size: 3},
	}}
	// The result is the task folder holding the renamed root.
	locals, err := torrentLocalFiles(Result{Path: dir, IsDir: true}, registration)
	if err != nil {
		t.Fatal(err)
	}
	if locals[0] != filepath.Join(dir, "Renamed", "a.mkv") || locals[2] != filepath.Join(dir, "Renamed", "sub", "b.srt") {
		t.Fatalf("locals = %v", locals)
	}
	registration.Files[1].Size = 4
	if _, err := torrentLocalFiles(Result{Path: dir, IsDir: true}, registration); err == nil {
		t.Fatal("a file of the wrong size matched")
	}
	// A torrent `a` holding `x` and `a/x`: the root is stripped exactly once,
	// and a .torrent file inside the torrent is one of its files.
	nested := t.TempDir()
	download(t, nested, "a", map[string]string{"x": "xx", "a/x": "axa", "inner.torrent": "torr"})
	registration = client.TorrentRegistration{Name: "a", Files: []client.TorrentFile{
		{FileIdx: 0, Path: "x", Size: 2}, {FileIdx: 1, Path: "a/x", Size: 3}, {FileIdx: 2, Path: "inner.torrent", Size: 4},
	}}
	for _, root := range []string{nested, filepath.Join(nested, "a")} {
		locals, err = torrentLocalFiles(Result{Path: root, IsDir: true}, registration)
		base := filepath.Join(nested, "a")
		if err != nil || locals[0] != filepath.Join(base, "x") || locals[1] != filepath.Join(base, "a", "x") || locals[2] != filepath.Join(base, "inner.torrent") {
			t.Fatalf("root %s: locals = %v, %v", root, locals, err)
		}
	}
	if _, err := torrentLocalFiles(Result{Path: nested, IsDir: true}, client.TorrentRegistration{Name: "a", Files: []client.TorrentFile{{Path: "../x", Size: 2}}}); err == nil {
		t.Fatal("a path outside the download matched")
	}
	single := client.TorrentRegistration{Name: "a.mkv", Files: []client.TorrentFile{{FileIdx: 0, Path: "a.mkv", Size: 5}}}
	if locals, err := torrentLocalFiles(Result{Path: filepath.Join(dir, "Renamed")}, single); err == nil || locals != nil {
		t.Fatal("a directory matched a single-file torrent")
	}
}
