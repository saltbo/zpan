package engine

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"testing"
	"time"

	"github.com/saltbo/zpan/cmd/internal/client"
)

func liveTask(id, sourceType, sourceURI, name string) client.DownloadTask {
	return client.DownloadTask{
		ID: id,
		Spec: client.DownloadTaskSpec{
			Source:      client.DownloadTaskSource{Type: sourceType, URI: sourceURI},
			Destination: client.DownloadTaskDestination{Name: name},
			Labels:      client.DownloadTaskLabels{Tags: []string{}},
		},
	}
}

func TestLiveDownloadThreeSourceTypes(t *testing.T) {
	if os.Getenv("LIVE_DOWNLOAD_VERIFY") != "1" {
		t.Skip("set LIVE_DOWNLOAD_VERIFY=1 to run live HTTP/magnet/torrent URL downloads")
	}
	aria2c, err := exec.LookPath("aria2c")
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	root := t.TempDir()
	seedDir := filepath.Join(root, "seed")
	if err := os.MkdirAll(seedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	fixtureName := "zpan-live-fixture.txt"
	fixtureBytes := bytes.Repeat([]byte("zpan remote download live verification\n"), 4096)
	fixturePath := filepath.Join(seedDir, fixtureName)
	if err := os.WriteFile(fixturePath, fixtureBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	httpServer := httptest.NewServer(http.FileServer(http.Dir(seedDir)))
	defer httpServer.Close()

	tracker := newLocalTracker()
	trackerServer := httptest.NewServer(tracker)
	defer trackerServer.Close()

	torrentBytes, infoHash := makeSingleFileTorrent(t, fixtureName, fixtureBytes, trackerServer.URL+"/announce", httpServer.URL+"/")
	torrentServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-bittorrent")
		_, _ = w.Write(torrentBytes)
	}))
	defer torrentServer.Close()

	torrentPath := filepath.Join(root, "fixture.torrent")
	if err := os.WriteFile(torrentPath, torrentBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	seederPort, err := freePort()
	if err != nil {
		t.Fatal(err)
	}
	seeder := exec.Command(
		aria2c,
		"--check-integrity=true",
		"--seed-ratio=1000",
		"--seed-time=120",
		"--bt-stop-timeout=120",
		"--enable-dht=false",
		"--enable-peer-exchange=false",
		fmt.Sprintf("--listen-port=%d", seederPort),
		"--dir="+seedDir,
		torrentPath,
	)
	seeder.Stdout = os.Stdout
	seeder.Stderr = os.Stderr
	if err := seeder.Start(); err != nil {
		t.Fatal(err)
	}
	defer stopProcess(seeder)
	if err := tracker.waitForPeer(20 * time.Second); err != nil {
		t.Fatal(err)
	}

	rpcPort, err := freePort()
	if err != nil {
		t.Fatal(err)
	}
	ariaRPC := exec.Command(
		aria2c,
		"--enable-rpc=true",
		"--rpc-listen-all=false",
		fmt.Sprintf("--rpc-listen-port=%d", rpcPort),
		"--rpc-allow-origin-all=true",
		"--enable-dht=false",
		"--enable-peer-exchange=false",
		"--seed-time=0",
		"--bt-stop-timeout=120",
		"--dir="+filepath.Join(root, "rpc-default"),
	)
	ariaRPC.Stdout = os.Stdout
	ariaRPC.Stderr = os.Stderr
	if err := ariaRPC.Start(); err != nil {
		t.Fatal(err)
	}
	defer stopProcess(ariaRPC)
	if err := waitTCP("127.0.0.1", rpcPort, 10*time.Second); err != nil {
		t.Fatal(err)
	}

	httpResult := runLiveDownload(
		t,
		ctx,
		HTTP{Dir: filepath.Join(root, "http")},
		liveTask("live-http", "http", httpServer.URL+"/"+fixtureName, "http-fixture.txt"),
	)
	magnetURL := fmt.Sprintf(
		"magnet:?xt=urn:btih:%s&dn=%s&tr=%s",
		hex.EncodeToString(infoHash),
		url.QueryEscape(fixtureName),
		url.QueryEscape(trackerServer.URL+"/announce"),
	)
	magnetResult := runLiveDownload(
		t,
		ctx,
		Aria2{URL: fmt.Sprintf("ws://127.0.0.1:%d/jsonrpc", rpcPort), Dir: filepath.Join(root, "magnet")},
		liveTask("live-magnet", "magnet", magnetURL, "magnet-fixture.txt"),
	)
	torrentResult := runLiveDownload(
		t,
		ctx,
		Aria2{URL: fmt.Sprintf("ws://127.0.0.1:%d/jsonrpc", rpcPort), Dir: filepath.Join(root, "torrent-url")},
		liveTask("live-torrent-url", "torrent_url", torrentServer.URL+"/fixture.torrent", "torrent-url-fixture.txt"),
	)

	assertSameContent(t, httpResult.Path, fixtureName, fixtureBytes)
	assertSameContent(t, magnetResult.Path, fixtureName, fixtureBytes)
	assertSameContent(t, torrentResult.Path, fixtureName, fixtureBytes)
	t.Logf("HTTP result: %s (%d bytes)", httpResult.Path, httpResult.Size)
	t.Logf("magnet result: %s (%d bytes)", magnetResult.Path, magnetResult.Size)
	t.Logf("torrent_url result: %s (%d bytes)", torrentResult.Path, torrentResult.Size)
}

func TestLiveQBittorrentDownloadTorrentURL(t *testing.T) {
	if os.Getenv("LIVE_DOWNLOAD_VERIFY") != "1" {
		t.Skip("set LIVE_DOWNLOAD_VERIFY=1 to run live qBittorrent downloads")
	}
	qbittorrentBinary, err := findQBittorrentForTest()
	if err != nil {
		t.Skip("qBittorrent is not installed")
	}
	aria2c, err := exec.LookPath("aria2c")
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	root := t.TempDir()
	seedDir := filepath.Join(root, "seed")
	if err := os.MkdirAll(seedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	fixtureName := "zpan-qbit-fixture.txt"
	fixtureBytes := bytes.Repeat([]byte("zpan qbit live verification\n"), 4096)
	fixturePath := filepath.Join(seedDir, fixtureName)
	if err := os.WriteFile(fixturePath, fixtureBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	httpServer := httptest.NewServer(http.FileServer(http.Dir(seedDir)))
	defer httpServer.Close()

	tracker := newLocalTracker()
	trackerServer := httptest.NewServer(tracker)
	defer trackerServer.Close()

	torrentBytes, _ := makeSingleFileTorrent(t, fixtureName, fixtureBytes, trackerServer.URL+"/announce", httpServer.URL+"/")
	torrentServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-bittorrent")
		_, _ = w.Write(torrentBytes)
	}))
	defer torrentServer.Close()

	torrentPath := filepath.Join(root, "fixture.torrent")
	if err := os.WriteFile(torrentPath, torrentBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	seederPort, err := freePort()
	if err != nil {
		t.Fatal(err)
	}
	seeder := exec.Command(
		aria2c,
		"--check-integrity=true",
		"--seed-ratio=1000",
		"--seed-time=120",
		"--bt-stop-timeout=120",
		"--enable-dht=false",
		"--enable-peer-exchange=false",
		fmt.Sprintf("--listen-port=%d", seederPort),
		"--dir="+seedDir,
		torrentPath,
	)
	seeder.Stdout = os.Stdout
	seeder.Stderr = os.Stderr
	if err := seeder.Start(); err != nil {
		t.Fatal(err)
	}
	defer stopProcess(seeder)
	if err := tracker.waitForPeer(20 * time.Second); err != nil {
		t.Fatal(err)
	}

	webUIPort, err := freePort()
	if err != nil {
		t.Fatal(err)
	}
	qbit := startQBittorrentForTest(t, ctx, qbittorrentBinary, filepath.Join(root, "qbit-profile"), webUIPort)
	defer stopProcess(qbit)

	result := runLiveDownload(t, ctx, QBittorrent{
		URL: "http://127.0.0.1:" + strconv.Itoa(webUIPort),
		Dir: filepath.Join(root, "qbit-downloads"),
	}, liveTask("live-qbit-torrent-url", "torrent_url", torrentServer.URL+"/fixture.torrent", "qbit-fixture.txt"))

	assertSameContent(t, result.Path, fixtureName, fixtureBytes)
	t.Logf("qBittorrent torrent_url result: %s (%d bytes)", result.Path, result.Size)
}

func runLiveDownload(t *testing.T, ctx context.Context, downloader Engine, task client.DownloadTask) Result {
	t.Helper()
	var lastDownloaded int64
	result, err := downloader.Download(ctx, task, func(downloaded int64, total *int64, bps int64, detail *client.DownloadTaskRuntime) error {
		if downloaded < lastDownloaded {
			t.Fatalf("download progress moved backwards: %d < %d", downloaded, lastDownloaded)
		}
		lastDownloaded = downloaded
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Size <= 0 {
		t.Fatalf("expected non-empty result for %s", task.SourceType())
	}
	if _, err := os.Stat(result.Path); err != nil {
		t.Fatal(err)
	}
	return result
}

func startQBittorrentForTest(t *testing.T, ctx context.Context, binary string, profileDir string, webUIPort int) *exec.Cmd {
	t.Helper()
	configDir := filepath.Join(profileDir, "qBittorrent", "config")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatal(err)
	}
	config := fmt.Sprintf(`[LegalNotice]
Accepted=true

[Preferences]
Downloads\SavePath=%s/
WebUI\Address=127.0.0.1
WebUI\AuthSubnetWhitelist=127.0.0.1
WebUI\AuthSubnetWhitelistEnabled=true
WebUI\LocalHostAuth=false
WebUI\Port=%d
`, filepath.ToSlash(filepath.Join(profileDir, "downloads")), webUIPort)
	if err := os.WriteFile(filepath.Join(configDir, "qBittorrent.conf"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command(binary, "--profile="+profileDir, "--webui-port="+strconv.Itoa(webUIPort))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	engine := QBittorrent{URL: "http://127.0.0.1:" + strconv.Itoa(webUIPort), Dir: t.TempDir()}
	deadline := time.Now().Add(30 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		checkCtx, cancel := context.WithTimeout(ctx, time.Second)
		err := engine.Check(checkCtx)
		cancel()
		if err == nil {
			return cmd
		}
		lastErr = err
		time.Sleep(500 * time.Millisecond)
	}
	stopProcess(cmd)
	t.Fatalf("timed out waiting for qBittorrent Web UI: %v", lastErr)
	return nil
}

func findQBittorrentForTest() (string, error) {
	for _, name := range []string{"qbittorrent-nox", "qbittorrent"} {
		path, err := exec.LookPath(name)
		if err == nil {
			return path, nil
		}
	}
	return "", os.ErrNotExist
}

func makeSingleFileTorrent(
	t *testing.T,
	name string,
	content []byte,
	announce string,
	webSeed string,
) ([]byte, []byte) {
	t.Helper()
	pieceHash := sha1.Sum(content)
	info := bencodeDict(map[string]any{
		"length":       len(content),
		"name":         name,
		"piece length": len(content),
		"pieces":       pieceHash[:],
	})
	infoHash := sha1.Sum(info)
	torrent := bencodeDict(map[string]any{
		"announce": announce,
		"info":     rawBencode(info),
		"url-list": webSeed,
	})
	return torrent, infoHash[:]
}

type rawBencode []byte

func bencodeDict(values map[string]any) []byte {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var out bytes.Buffer
	out.WriteByte('d')
	for _, key := range keys {
		out.Write(bencodeString([]byte(key)))
		out.Write(bencodeValue(values[key]))
	}
	out.WriteByte('e')
	return out.Bytes()
}

func bencodeValue(value any) []byte {
	switch v := value.(type) {
	case rawBencode:
		return []byte(v)
	case string:
		return bencodeString([]byte(v))
	case []byte:
		return bencodeString(v)
	case int:
		return []byte(fmt.Sprintf("i%de", v))
	default:
		panic(fmt.Sprintf("unsupported bencode value %T", value))
	}
}

func bencodeString(value []byte) []byte {
	return []byte(strconv.Itoa(len(value)) + ":" + string(value))
}

type localTracker struct {
	peerSeen chan struct{}
	peers    map[string][]byte
}

func newLocalTracker() *localTracker {
	return &localTracker{peerSeen: make(chan struct{}), peers: map[string][]byte{}}
}

func (t *localTracker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	peerID := query.Get("peer_id")
	port, _ := strconv.Atoi(query.Get("port"))
	if peerID != "" && port > 0 {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		if host == "::1" {
			host = "127.0.0.1"
		}
		t.peers[peerID] = compactPeer(host, port)
		select {
		case <-t.peerSeen:
		default:
			close(t.peerSeen)
		}
	}
	var peers []byte
	for id, peer := range t.peers {
		if id != peerID {
			peers = append(peers, peer...)
		}
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write(bencodeDict(map[string]any{"interval": 5, "peers": peers}))
}

func (t *localTracker) waitForPeer(timeout time.Duration) error {
	select {
	case <-t.peerSeen:
		return nil
	case <-time.After(timeout):
		return fmt.Errorf("timed out waiting for seeder announce")
	}
}

func compactPeer(host string, port int) []byte {
	ip := net.ParseIP(host).To4()
	if ip == nil {
		ip = net.ParseIP("127.0.0.1").To4()
	}
	return []byte{ip[0], ip[1], ip[2], ip[3], byte(port >> 8), byte(port)}
}

func assertSameContent(t *testing.T, path string, filename string, expected []byte) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.IsDir() {
		path = filepath.Join(path, filename)
	}
	actual, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, expected) {
		t.Fatalf("content mismatch for %s", path)
	}
}

func stopProcess(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	_ = cmd.Process.Signal(os.Interrupt)
	_, _ = cmd.Process.Wait()
}

func freePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func waitTCP(host string, port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), 500*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("timed out waiting for %s:%d", host, port)
}
