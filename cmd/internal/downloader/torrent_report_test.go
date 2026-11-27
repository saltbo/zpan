package downloader

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/config"
	"github.com/saltbo/zpan/pkg/torrentmeta"
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

func torrentTask(id string) client.DownloadTask {
	task := clientTaskWithUploadToken(id, "assigned")
	task.Spec.Source.URI = "magnet:?xt=urn:btih:abc"
	task.Spec.Destination.Folder = "Downloads"
	return task
}

func reportRunner(api apiClient, engine Downloader) *TaskRunner {
	w := NewTaskRunnerWithAPI(config.Config{MaxConcurrentTasks: 1}, api)
	w.logger = discardLogger()
	w.downloader = NewManagerWithDownloader(engine)
	return w
}

// uploadedTorrentPaths maps each uploaded file's drive path to the torrentPath
// it was created with.
func uploadedTorrentPaths(d *fakeDrive) map[string]string {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := map[string]string{}
	for _, entry := range d.entries {
		if !entry.folder {
			out[joinObjectPath(entry.parent, entry.name)] = entry.torrentPath
		}
	}
	return out
}

func statusPatches(patches []client.TaskPatch) []string {
	var states []string
	for _, patch := range patches {
		if state := patch.State(); state != "" {
			states = append(states, state)
		}
	}
	return states
}

// [spec: torrents/downloader-fills-torrent]
func TestDownloaderReportsTheTorrentAndUploadsItThroughTheObjectAPI(t *testing.T) {
	info := infoDict("Show", map[string]int{"a.mkv": 5, "sub/b.srt": 3})
	drive := newFakeDrive(t)
	dir := t.TempDir()
	// The metadata resolves while the download runs; the engine named the
	// root folder after the requested name.
	engine := &metadataEngine{recordingEngine: &recordingEngine{}, metadata: torrentFile(info), pending: 1}
	result := download(t, dir, "Requested", map[string]string{"a.mkv": "video", "sub/b.srt": "srt"})
	engine.downloadFunc = func(_ context.Context, _ DownloadTask, progress ProgressReporter) (Result, error) {
		_ = progress(ProgressUpdate{Downloaded: 1})
		return result, nil
	}
	w := reportRunner(drive, engine)

	if heartbeat := w.heartbeat(); slices.Contains(heartbeat.Capabilities, "torrent-cache") {
		t.Fatalf("capabilities = %v", heartbeat.Capabilities)
	}
	w.process(context.Background(), torrentTask("task-1"))

	if len(drive.reported) != 1 || string(drive.reported[0]) != string(info) {
		t.Fatalf("reported = %q", drive.reported)
	}
	if got := uploadedTorrentPaths(drive); !maps.Equal(got, map[string]string{
		"Downloads/Requested/a.mkv":     "a.mkv",
		"Downloads/Requested/sub/b.srt": "sub/b.srt",
	}) {
		t.Fatalf("uploaded = %v", got)
	}
	if entry := drive.entry("Downloads/Requested/a.mkv"); entry.content != "video" {
		t.Fatalf("content = %q", entry.content)
	}
	// The downloader completes the task itself, as any upload.
	lastPatchWithStatus(t, drive.patches, "completed")
}

// A scraped torrent keeps the scraper's layout: each file of the torrent is
// uploaded at its scraped name with its path inside the torrent, and the
// sidecars the scraper wrote go up as ordinary files.
func TestScrapedTorrentUploadsCarryTorrentPaths(t *testing.T) {
	drive := newFakeDrive(t)
	drive.add("", "Movies", true, "")
	video := "Breaking.Bad.S01E02.mkv"
	plan := showPlan(t, t.TempDir(), video)
	paths := map[string]string{filepath.Clean(plan.Files[0].LocalPath): "Season 1/bb.s01e02.mkv"}

	if _, err := NewUploader(drive, nil).Upload(context.Background(), discardLogger(), planTask(), Result{Plan: &plan, TorrentPaths: paths}); err != nil {
		t.Fatal(err)
	}
	uploaded := uploadedTorrentPaths(drive)
	videoPath := "Movies/" + plan.Folder + "/" + plan.Files[0].Path
	if uploaded[videoPath] != "Season 1/bb.s01e02.mkv" {
		t.Fatalf("uploaded = %v", uploaded)
	}
	for drivePath, torrentPath := range uploaded {
		if drivePath != videoPath && torrentPath != "" {
			t.Fatalf("sidecar %s carried torrentPath %q", drivePath, torrentPath)
		}
	}
}

func TestTaskSettledByTheServerDropsItsDownload(t *testing.T) {
	for name, configure := range map[string]func(*fakeDrive){
		"completed by instant transfer": func(d *fakeDrive) { d.reportState = "completed" },
		"joined another download":       func(d *fakeDrive) { d.reportState = "queued" },
		"no longer assigned": func(d *fakeDrive) {
			d.reportErr = &client.StatusError{Status: http.StatusForbidden, Message: "Forbidden"}
		},
	} {
		t.Run(name, func(t *testing.T) {
			drive := newFakeDrive(t)
			configure(drive)
			engine := &metadataEngine{recordingEngine: &recordingEngine{}, metadata: infoDict("Show", map[string]int{"a.mkv": 5})}
			engine.downloadFunc = func(ctx context.Context, _ DownloadTask, progress ProgressReporter) (Result, error) {
				_ = progress(ProgressUpdate{Downloaded: 1})
				<-ctx.Done()
				return Result{}, ctx.Err()
			}
			w := reportRunner(drive, engine)
			task := torrentTask("task-1")
			ctx, ok := w.startTask(context.Background(), task.ID)
			if !ok {
				t.Fatal("task did not start")
			}

			w.process(ctx, task)

			if engine.resetCalls != 1 {
				t.Fatalf("reset calls = %d", engine.resetCalls)
			}
			if states := statusPatches(drive.patches); !slices.Equal(states, []string{"downloading"}) {
				t.Fatalf("the downloader changed a settled task: %v", states)
			}
			if paths := drive.paths(); len(paths) != 0 {
				t.Fatalf("uploaded = %v", paths)
			}
		})
	}
}

// A task the server settles once the download finished leaves nothing behind
// either.
func TestTaskSettledAfterTheDownloadUploadsNothing(t *testing.T) {
	drive := newFakeDrive(t)
	drive.reportState = "completed"
	engine := &metadataEngine{recordingEngine: &recordingEngine{}, metadata: infoDict("Show", map[string]int{"a.mkv": 5})}
	engine.downloadResult = download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video"})

	reportRunner(drive, engine).process(context.Background(), torrentTask("task-1"))

	if len(drive.reported) != 1 || len(drive.paths()) != 0 || engine.resetCalls != 1 {
		t.Fatalf("reported = %d, uploaded = %v, resets = %d", len(drive.reported), drive.paths(), engine.resetCalls)
	}
}

// [spec: torrents/legacy-downloader-unchanged]
func TestTasksWithoutAReportUploadOrdinaryDriveFiles(t *testing.T) {
	for name, engine := range map[string]Downloader{
		"engine without metadata": &recordingEngine{},
		"refused report":          &metadataEngine{recordingEngine: &recordingEngine{}, metadata: infoDict("Show", map[string]int{"a.mkv": 5})},
	} {
		t.Run(name, func(t *testing.T) {
			drive := newFakeDrive(t)
			drive.reportErr = &client.StatusError{Status: http.StatusBadRequest, Message: "Torrent metadata is invalid"}
			result := download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video"})
			switch engine := engine.(type) {
			case *recordingEngine:
				engine.downloadResult = result
			case *metadataEngine:
				engine.downloadResult = result
			}

			reportRunner(drive, engine).process(context.Background(), torrentTask("task-1"))

			if got := uploadedTorrentPaths(drive); !maps.Equal(got, map[string]string{"Downloads/Show/a.mkv": ""}) {
				t.Fatalf("uploaded = %v", got)
			}
			lastPatchWithStatus(t, drive.patches, "completed")
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

func TestReportingFollowsTheEnginesExport(t *testing.T) {
	for canExport, want := range map[bool]bool{true: true, false: false} {
		engine := &probedEngine{metadataEngine: &metadataEngine{recordingEngine: &recordingEngine{}}, canExport: canExport}
		if got := reportRunner(newFakeDrive(t), engine).canReportTorrent(torrentTask("task-1")); got != want {
			t.Errorf("export %v: reports = %v", canExport, got)
		}
	}
	w := reportRunner(newFakeDrive(t), &metadataEngine{recordingEngine: &recordingEngine{}})
	if w.canReportTorrent(clientHTTPTask("task-1", "assigned", "https://example.com/a.mkv", "a.mkv")) {
		t.Fatal("reports an HTTP download")
	}
	if !w.canReportTorrent(torrentTask("task-1")) {
		t.Fatal("does not report a magnet download")
	}
}

// A task whose engine never hands over readable metadata (an old qBittorrent
// without torrents/export, a .torrent that stays unreadable) proceeds without
// reporting after the retry budget and uploads ordinary drive files.
func TestMetadataThatNeverBecomesReadableUploadsOrdinaryFiles(t *testing.T) {
	fastRetries(t)
	for name, engine := range map[string]*metadataEngine{
		"unreadable":  {metadata: []byte("not bencode")},
		"pending":     {pending: 1 << 30},
		"no export":   {err: errors.New("export torrent metadata: not found")},
		"cut forever": {metadata: torrentFile(infoDict("Show", map[string]int{"a.mkv": 5})), partial: 1 << 30},
	} {
		t.Run(name, func(t *testing.T) {
			drive := newFakeDrive(t)
			engine.recordingEngine = &recordingEngine{}
			engine.downloadResult = download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video"})
			w := reportRunner(drive, engine)

			w.process(context.Background(), torrentTask("task-1"))

			if len(drive.reported) != 0 {
				t.Fatalf("reported = %q", drive.reported)
			}
			if engine.calls != metadataAttempts {
				t.Fatalf("metadata read %d times, want %d", engine.calls, metadataAttempts)
			}
			if got := uploadedTorrentPaths(drive); !maps.Equal(got, map[string]string{"Downloads/Show/a.mkv": ""}) {
				t.Fatalf("uploaded = %v", got)
			}
		})
	}
}

// A .torrent read while aria2 is still writing it is retried, not taken as
// unreadable.
func TestPartlyWrittenMetadataIsRetried(t *testing.T) {
	fastRetries(t)
	info := infoDict("Show", map[string]int{"a.mkv": 5})
	drive := newFakeDrive(t)
	engine := &metadataEngine{recordingEngine: &recordingEngine{}, metadata: torrentFile(info), partial: 2}
	engine.downloadResult = download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video"})

	reportRunner(drive, engine).process(context.Background(), torrentTask("task-1"))

	if len(drive.reported) != 1 || string(drive.reported[0]) != string(info) {
		t.Fatalf("reported = %q", drive.reported)
	}
	if got := uploadedTorrentPaths(drive); got["Downloads/Show/a.mkv"] != "a.mkv" {
		t.Fatalf("uploaded = %v", got)
	}
}

// A download that does not hold the reported torrent's files uploads them as
// ordinary files; the server then keeps the torrent off the instance.
func TestDownloadMissingTheTorrentsFilesUploadsWithoutTorrentPaths(t *testing.T) {
	drive := newFakeDrive(t)
	engine := &metadataEngine{recordingEngine: &recordingEngine{}, metadata: infoDict("Show", map[string]int{"a.mkv": 5, "b.mkv": 5})}
	engine.downloadResult = download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video"})

	reportRunner(drive, engine).process(context.Background(), torrentTask("task-1"))

	if len(drive.reported) != 1 {
		t.Fatalf("reported = %d", len(drive.reported))
	}
	if got := uploadedTorrentPaths(drive); !maps.Equal(got, map[string]string{"Downloads/Show/a.mkv": ""}) {
		t.Fatalf("uploaded = %v", got)
	}
}

func TestFailedPartUploadsAreRetriedThenAborted(t *testing.T) {
	fastRetries(t)
	drive := newFakeDrive(t)
	drive.failPuts = partAttempts - 1
	engine := &recordingEngine{downloadResult: download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video"})}
	reportRunner(drive, engine).process(context.Background(), torrentTask("task-1"))
	if entry := drive.entry("Downloads/Show/a.mkv"); entry == nil || entry.content != "video" || len(drive.aborted) != 0 {
		t.Fatalf("entry = %+v, aborted = %v", entry, drive.aborted)
	}

	drive = newFakeDrive(t)
	drive.failPuts = -1
	engine = &recordingEngine{downloadResult: download(t, t.TempDir(), "Show", map[string]string{"a.mkv": "video"})}
	reportRunner(drive, engine).process(context.Background(), torrentTask("task-1"))
	if drive.puts != partAttempts {
		t.Fatalf("puts = %d, want %d", drive.puts, partAttempts)
	}
	if len(drive.aborted) != 1 {
		t.Fatalf("aborted = %v", drive.aborted)
	}
	lastPatchWithStatus(t, drive.patches, "failed")
}

func TestTorrentLocalFilesFindsFilesWhateverTheRootIsNamed(t *testing.T) {
	dir := t.TempDir()
	download(t, dir, "Renamed", map[string]string{"a.mkv": "video", "sub/b.srt": "srt"})
	if err := os.WriteFile(filepath.Join(dir, ".zpan-metadata.torrent"), []byte("d"), 0o644); err != nil {
		t.Fatal(err)
	}
	torrent := torrentmeta.Info{Name: "Show", Files: []torrentmeta.File{
		{Index: 0, Path: "a.mkv", Size: 5}, {Index: 1, Path: ".pad/1", Size: 1, Padding: true}, {Index: 2, Path: "sub/b.srt", Size: 3},
	}}
	// The result is the task folder holding the renamed root.
	locals, err := torrentLocalFiles(Result{Path: dir, IsDir: true}, torrent)
	if err != nil {
		t.Fatal(err)
	}
	if len(locals) != 2 || locals[0] != filepath.Join(dir, "Renamed", "a.mkv") || locals[2] != filepath.Join(dir, "Renamed", "sub", "b.srt") {
		t.Fatalf("locals = %v", locals)
	}
	torrent.Files[2].Size = 4
	if _, err := torrentLocalFiles(Result{Path: dir, IsDir: true}, torrent); err == nil {
		t.Fatal("a file of the wrong size matched")
	}
	// A torrent `a` holding `x` and `a/x`: the root is stripped exactly once,
	// and a .torrent file inside the torrent is one of its files.
	nested := t.TempDir()
	download(t, nested, "a", map[string]string{"x": "xx", "a/x": "axa", "inner.torrent": "torr"})
	torrent = torrentmeta.Info{Name: "a", Files: []torrentmeta.File{
		{Index: 0, Path: "x", Size: 2}, {Index: 1, Path: "a/x", Size: 3}, {Index: 2, Path: "inner.torrent", Size: 4},
	}}
	for _, root := range []string{nested, filepath.Join(nested, "a")} {
		locals, err = torrentLocalFiles(Result{Path: root, IsDir: true}, torrent)
		base := filepath.Join(nested, "a")
		if err != nil || locals[0] != filepath.Join(base, "x") || locals[1] != filepath.Join(base, "a", "x") || locals[2] != filepath.Join(base, "inner.torrent") {
			t.Fatalf("root %s: locals = %v, %v", root, locals, err)
		}
	}
	if _, err := torrentLocalFiles(Result{Path: nested, IsDir: true}, torrentmeta.Info{Name: "a", Files: []torrentmeta.File{{Path: "../x", Size: 2}}}); err == nil {
		t.Fatal("a path outside the download matched")
	}
	single := torrentmeta.Info{Name: "a.mkv", Files: []torrentmeta.File{{Index: 0, Path: "a.mkv", Size: 5}}}
	if locals, err := torrentLocalFiles(Result{Path: filepath.Join(dir, "Renamed")}, single); err == nil || locals != nil {
		t.Fatal("a directory matched a single-file torrent")
	}
}
