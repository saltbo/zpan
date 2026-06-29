package qbittorrent

import (
	"context"
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
