package qbittorrent

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/autobrr/go-qbittorrent"
	"github.com/saltbo/zpan/internal/downloader"
)

func downloadTask(id, sourceType, sourceURI string) downloader.DownloadTask {
	return downloader.DownloadTask{ID: id, Source: downloader.Source{Type: sourceType, URI: sourceURI}, Labels: downloader.Labels{Tags: []string{}}}
}

func downloadTaskWithName(id, sourceType, sourceURI, name string) downloader.DownloadTask {
	task := downloadTask(id, sourceType, sourceURI)
	task.Destination.Name = name
	return task
}

func TestQBittorrentStartArgsWritesManagedListenPort(t *testing.T) {
	stateDir := t.TempDir()
	downloadDir := t.TempDir()
	args, err := (QBittorrent{
		URL:        "http://127.0.0.1:8080",
		Dir:        downloadDir,
		StateDir:   stateDir,
		ListenPort: 51413,
		BtTrackers: "udp://custom.example:1337/announce,udp://custom2.example:1337/announce",
	}).startArgs("/usr/bin/qbittorrent-nox")
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--profile="+filepath.Join(stateDir, "qbittorrent")) {
		t.Fatalf("expected managed profile, got %v", args)
	}
	if !strings.Contains(joined, "--webui-port=8080") {
		t.Fatalf("expected webui port, got %v", args)
	}
	content, err := os.ReadFile(filepath.Join(stateDir, "qbittorrent", "qBittorrent", "config", "qBittorrent.conf"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	if !strings.Contains(text, `Connection\PortRangeMin=51413`) {
		t.Fatalf("expected custom listen port, got:\n%s", text)
	}
	if !strings.Contains(text, `Downloads\SavePath=`+filepath.ToSlash(downloadDir)+`/`) {
		t.Fatalf("expected custom download dir, got:\n%s", text)
	}
	if !strings.Contains(text, `BitTorrent\DHT=true`) ||
		!strings.Contains(text, `BitTorrent\PeX=true`) ||
		!strings.Contains(text, `Session\AddTrackersEnabled=true`) ||
		!strings.Contains(text, `Session\AddTrackers=udp://custom.example:1337/announce\nudp://custom2.example:1337/announce`) {
		t.Fatalf("expected managed BT discovery config, got:\n%s", text)
	}
}

func TestQBittorrentStartArgsWithoutManagedProfile(t *testing.T) {
	args, err := (QBittorrent{URL: "http://127.0.0.1:9090"}).startArgs("/usr/bin/qbittorrent")
	if err != nil {
		t.Fatal(err)
	}
	if len(args) != 0 {
		t.Fatalf("expected no args without state dir and nox binary, got %v", args)
	}
	if _, err := (QBittorrent{URL: "://bad-url"}).startArgs("/usr/bin/qbittorrent-nox"); err == nil {
		t.Fatal("expected invalid URL error")
	}
	if got := listenPortString(0); got != "6881" {
		t.Fatalf("expected default listen port, got %q", got)
	}
	if got := listenPortString(51413); got != "51413" {
		t.Fatalf("expected custom listen port, got %q", got)
	}
}

func TestQBittorrentConstructorAndMetadata(t *testing.T) {
	cfg := downloader.Config{
		Engine:       "qbittorrent",
		DownloadDir:  t.TempDir(),
		StateDir:     t.TempDir(),
		BTListenPort: 51413,
		SeedEnabled:  true,
		QBittorrent: downloader.QBittorrentConfig{
			URL:      "http://127.0.0.1:8080",
			Username: "u",
			Password: "p",
		},
	}
	d, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	q := d.(*QBittorrent)
	if q.Name() != "qbittorrent" {
		t.Fatalf("unexpected name %q", q.Name())
	}
	if got := q.Capabilities().SourceTypes; len(got) != 3 || got[0] != "magnet" {
		t.Fatalf("unexpected capabilities %#v", got)
	}
	if !q.Managed || !q.RetainSeed || q.ListenPort != 51413 || q.Username != "u" || q.Password != "p" {
		t.Fatalf("unexpected constructed downloader: %#v", q)
	}
	q.Managed = false
	if err := q.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := q.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !configured(downloader.Config{QBittorrent: downloader.QBittorrentConfig{Configured: true}}) {
		t.Fatal("expected configured qbit config")
	}
}

func TestQBittorrentStartAndCheckErrors(t *testing.T) {
	if err := (&QBittorrent{Managed: true}).Start(context.Background()); err == nil {
		t.Fatal("expected missing binary error")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusBadGateway)
	}))
	defer server.Close()
	if err := (QBittorrent{URL: server.URL}).Check(context.Background()); err == nil || !strings.Contains(err.Error(), "502") {
		t.Fatalf("expected bad gateway check error, got %v", err)
	}
	empty := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer empty.Close()
	if err := (QBittorrent{URL: empty.URL}).Check(context.Background()); err == nil || !strings.Contains(err.Error(), "did not return") {
		t.Fatalf("expected empty version error, got %v", err)
	}
}

func TestQBittorrentCheckUsesWebAPIVersion(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/app/version" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte("5.0.0"))
	}))
	defer server.Close()

	if err := (QBittorrent{URL: server.URL, Dir: t.TempDir()}).Check(context.Background()); err != nil {
		t.Fatal(err)
	}
}

// authQBittorrent mimics a qBittorrent with WebUI authentication: app/version
// answers 403 without a session cookie or the API key.
func authQBittorrent(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			if err := r.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if r.PostForm.Get("username") != "admin" || r.PostForm.Get("password") != "secret" {
				_, _ = w.Write([]byte("Fails."))
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session", Path: "/"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/app/version":
			cookie, _ := r.Cookie("SID")
			if r.Header.Get("Authorization") != "Bearer api-key" && (cookie == nil || cookie.Value != "session") {
				http.Error(w, "Forbidden", http.StatusForbidden)
				return
			}
			_, _ = w.Write([]byte("v5.1.0"))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func TestQBittorrentCheckWithoutCredentialsFailsOnAuthenticatedWebUI(t *testing.T) {
	server := authQBittorrent(t)
	err := (QBittorrent{URL: server.URL}).Check(context.Background())
	if err == nil || !strings.Contains(err.Error(), "without credentials") {
		t.Fatalf("expected unauthenticated check error, got %v", err)
	}
}

func TestQBittorrentCheckSignsInWithUsernameAndPassword(t *testing.T) {
	server := authQBittorrent(t)
	if err := (QBittorrent{URL: server.URL, Username: "admin", Password: "secret"}).Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := (QBittorrent{URL: server.URL, Username: "admin", Password: "wrong"}).Check(context.Background()); err == nil {
		t.Fatal("expected bad credentials error")
	}
}

func TestQBittorrentCheckUsesAPIKey(t *testing.T) {
	server := authQBittorrent(t)
	d, err := New(downloader.Config{QBittorrent: downloader.QBittorrentConfig{URL: server.URL, APIKey: "api-key", Configured: true}})
	if err != nil {
		t.Fatal(err)
	}
	q := d.(*QBittorrent)
	if q.Managed || q.APIKey != "api-key" {
		t.Fatalf("expected external qbittorrent with api key, got %#v", q)
	}
	if err := q.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := (QBittorrent{URL: server.URL, APIKey: "wrong"}).Check(context.Background()); err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("expected 403 with a wrong api key, got %v", err)
	}
}

func TestQBittorrentHTTPDelegatesToBuiltin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "11")
		_, _ = w.Write([]byte("hello qbit!"))
	}))
	defer server.Close()

	result, err := (QBittorrent{URL: "http://127.0.0.1:1", Dir: t.TempDir()}).Download(
		context.Background(),
		downloadTask("task-1", "http", server.URL+"/file.txt"),
		func(update downloader.ProgressUpdate) error { return nil },
	)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello qbit!" {
		t.Fatalf("unexpected file content: %q", string(data))
	}
}

func TestQBittorrentAddOptionsPassThroughTaskClassification(t *testing.T) {
	task := downloadTaskWithName("task-1", "magnet", "magnet:?xt=urn:btih:abc", "fixture")
	task.Labels.Category = "movies"
	task.Labels.Tags = []string{"4k", "private"}
	options := (QBittorrent{BtTrackers: "udp://tracker.example:1337/announce"}).qbittorrentAddOptions(task, "/tmp/zpan/task-1", qbittorrentTrackingTag("task-1"))

	if options["category"] != "movies" {
		t.Fatalf("expected task category, got %q", options["category"])
	}
	if options["tags"] != "ztid=task-1,4k,private" {
		t.Fatalf("expected tracking and task tags, got %q", options["tags"])
	}
	if options["rename"] != "fixture" {
		t.Fatalf("expected rename option, got %q", options["rename"])
	}
	if options["trackers"] != "udp://tracker.example:1337/announce" {
		t.Fatalf("expected trackers option, got %q", options["trackers"])
	}
}

func TestQBittorrentAddOptionsDefaultsCategory(t *testing.T) {
	options := (QBittorrent{BtTrackers: "udp://tracker.example:1337/announce"}).qbittorrentAddOptions(downloader.DownloadTask{ID: "task-1"}, "/tmp/zpan/task-1", qbittorrentTrackingTag("task-1"))
	if options["category"] != "zpan" {
		t.Fatalf("expected default category, got %q", options["category"])
	}
	if options["tags"] != "ztid=task-1" {
		t.Fatalf("expected tracking tag, got %q", options["tags"])
	}
}

func TestQBittorrentAddOptionsIgnoresTorrentTaskName(t *testing.T) {
	options := (QBittorrent{BtTrackers: "udp://tracker.example:1337/announce"}).qbittorrentAddOptions(
		downloadTaskWithName("task-1", "magnet", "magnet:?xt=urn:btih:abc", "movie.torrent"),
		"/tmp/zpan/task-1",
		qbittorrentTrackingTag("task-1"),
	)
	if _, ok := options["rename"]; ok {
		t.Fatalf("expected torrent task name to be ignored, got rename=%q", options["rename"])
	}
}

func TestQBittorrentTaskState(t *testing.T) {
	if got := qbittorrentTaskState(qbittorrent.Torrent{
		State:      qbittorrent.TorrentState("stalledUP"),
		Progress:   1,
		AmountLeft: 0,
		TotalSize:  100,
	}); got != downloader.TaskStateCompleted {
		t.Fatalf("expected seeding torrent to be completed, got %s", got)
	}
	if got := qbittorrentTaskState(qbittorrent.Torrent{
		State:      qbittorrent.TorrentState("downloading"),
		Progress:   0.5,
		AmountLeft: 50,
		TotalSize:  100,
	}); got != downloader.TaskStateDownloading {
		t.Fatalf("expected partial torrent to be downloading, got %s", got)
	}
	if got := qbittorrentTaskState(qbittorrent.Torrent{
		State:      qbittorrent.TorrentState("missingFiles"),
		Progress:   0.5,
		AmountLeft: 50,
		TotalSize:  100,
	}); got != downloader.TaskStateFailed {
		t.Fatalf("expected missing files torrent to be failed, got %s", got)
	}
}

func TestQBittorrentPhaseVariants(t *testing.T) {
	tests := map[string]string{
		"metaDL":       "metadata",
		"stalledUP":    "seeding",
		"uploading":    "seeding",
		"missingFiles": "error",
		"error":        "error",
		"pausedDL":     "downloading",
		"downloading":  "downloading",
	}
	for state, want := range tests {
		if got := qbittorrentPhase(state); got != want {
			t.Fatalf("expected phase %q for %q, got %q", want, state, got)
		}
	}
}

func TestQBittorrentTrackersMapsTorrentTrackersAndLimits(t *testing.T) {
	trackers := make([]qbittorrent.TorrentTracker, 0, 25)
	for i := 0; i < 25; i++ {
		trackers = append(trackers, qbittorrent.TorrentTracker{
			Url:         fmt.Sprintf("udp://tracker-%02d/announce", i),
			Status:      qbittorrent.TrackerStatus(i),
			NumPeers:    i + 1,
			NumSeeds:    i + 2,
			NumLeechers: i + 3,
			Message:     "ok",
		})
	}
	out := qbittorrentTrackers(context.Background(), nil, qbittorrent.Torrent{Trackers: trackers})
	if len(out) != 20 {
		t.Fatalf("expected tracker limit 20, got %d", len(out))
	}
	if out[0].URL != "udp://tracker-00/announce" || out[0].Status != "0" || *out[0].Peers != 1 || *out[0].Seeds != 2 || *out[0].Leechers != 3 {
		t.Fatalf("unexpected first tracker: %#v", out[0])
	}
}

func TestQBittorrentTrackersLeaveOutUnknownCounts(t *testing.T) {
	out := qbittorrentTrackers(context.Background(), nil, qbittorrent.Torrent{Trackers: []qbittorrent.TorrentTracker{
		{Url: "udp://tracker/announce", NumPeers: -1, NumSeeds: -1, NumLeechers: 0},
	}})
	if out[0].Peers != nil || out[0].Seeds != nil || out[0].Leechers == nil || *out[0].Leechers != 0 {
		t.Fatalf("unexpected tracker: %#v", out[0])
	}
}

func TestQBittorrentTagHelpers(t *testing.T) {
	if !torrentHasTag("one, ztid=task-1 ,two", qbittorrentTrackingTag("task-1")) {
		t.Fatal("expected tracking tag match")
	}
	if torrentHasTag("one,two", qbittorrentTrackingTag("task-1")) {
		t.Fatal("did not expect missing tracking tag match")
	}
	if !isQBittorrentErrorState(qbittorrent.TorrentState("missingFiles")) {
		t.Fatal("expected missingFiles to be an error state")
	}
	if isQBittorrentErrorState(qbittorrent.TorrentState("downloading")) {
		t.Fatal("did not expect downloading to be an error state")
	}
}

func TestQBittorrentDetailOmitsSeedingETA(t *testing.T) {
	detail := qbittorrentDetail(context.Background(), nil, qbittorrent.Torrent{
		State:      qbittorrent.TorrentState("stalledUP"),
		ETA:        3600,
		Progress:   1,
		AmountLeft: 0,
		TotalSize:  100,
	}, nil)

	if detail.Phase != "seeding" {
		t.Fatalf("expected seeding phase, got %s", detail.Phase)
	}
	if detail.ETASeconds != nil {
		t.Fatalf("expected seeding detail without ETA, got %#v", detail.ETASeconds)
	}
}

// fakeQBittorrent answers the Web API calls TorrentMetadata and
// CanExportTorrentMetadata make.
func fakeQBittorrent(t *testing.T, webAPIVersion string, exportStatus int, state string) (*httptest.Server, *int) {
	t.Helper()
	versionCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/auth/login":
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "sid"})
			_, _ = w.Write([]byte("Ok."))
		case "/api/v2/app/webapiVersion":
			versionCalls++
			_, _ = w.Write([]byte(webAPIVersion))
		case "/api/v2/torrents/info":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `[{"hash":"abc","state":%q,"tags":"zpan-task-task-1"}]`, state)
		case "/api/v2/torrents/export":
			w.WriteHeader(exportStatus)
			if exportStatus == http.StatusOK {
				_, _ = w.Write([]byte("d4:infod4:name1:aee"))
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return server, &versionCalls
}

func TestQBittorrentTorrentMetadataTellsPendingFromUnsupported(t *testing.T) {
	task := downloadTask("task-1", "magnet", "magnet:?xt=urn:btih:abc")
	for name, tc := range map[string]struct {
		status  int
		state   string
		pending bool
		ok      bool
	}{
		"exported":         {status: http.StatusOK, state: "downloading", ok: true},
		"metadata pending": {status: http.StatusConflict, state: "downloading", pending: true},
		"fetching":         {status: http.StatusOK, state: "metaDL", pending: true},
		"no export":        {status: http.StatusNotFound, state: "downloading"},
		"server error":     {status: http.StatusInternalServerError, state: "downloading"},
	} {
		t.Run(name, func(t *testing.T) {
			server, _ := fakeQBittorrent(t, "2.11.2", tc.status, tc.state)
			q := QBittorrent{URL: server.URL, Dir: t.TempDir()}
			data, err := q.TorrentMetadata(context.Background(), task)
			switch {
			case tc.ok:
				if err != nil || string(data) != "d4:infod4:name1:aee" {
					t.Fatalf("data = %q, %v", data, err)
				}
			case tc.pending:
				if !errors.Is(err, downloader.ErrTorrentMetadataPending) {
					t.Fatalf("err = %v, want pending", err)
				}
			default:
				if err == nil || errors.Is(err, downloader.ErrTorrentMetadataPending) {
					t.Fatalf("err = %v, want a failure that is not pending", err)
				}
			}
		})
	}
}

func TestQBittorrentReportsExportOnlyFromWebAPI2814(t *testing.T) {
	for version, want := range map[string]bool{"2.8.14": true, "2.11.2": true, "v3.0": true, "2.8.13": false, "2.8": false, "x": false} {
		server, calls := fakeQBittorrent(t, version, http.StatusOK, "downloading")
		q := QBittorrent{URL: server.URL, export: &exportSupport{}}
		if got := q.CanExportTorrentMetadata(context.Background()); got != want {
			t.Errorf("version %s: export = %v, want %v", version, got, want)
		}
		// The answer is remembered.
		q.CanExportTorrentMetadata(context.Background())
		if *calls != 1 {
			t.Errorf("version %s: probed %d times", version, *calls)
		}
	}
	unreachable := QBittorrent{URL: "http://127.0.0.1:1", export: &exportSupport{}}
	if unreachable.CanExportTorrentMetadata(context.Background()) || unreachable.export.known {
		t.Fatal("an unreachable qBittorrent was remembered as able to export")
	}
}
