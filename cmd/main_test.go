package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/saltbo/zpan/internal/client"
	"github.com/saltbo/zpan/internal/config"
	"github.com/spf13/cobra"
)

func TestRegistrationHeartbeatNormalizesAutoEngine(t *testing.T) {
	heartbeat := registrationHeartbeat(config.Config{Engine: "auto", MaxConcurrentTasks: 3})
	if heartbeat.Engine != "aria2" {
		t.Fatalf("expected default BT engine, got %q", heartbeat.Engine)
	}
	if len(heartbeat.Capabilities) != 4 || heartbeat.Capabilities[0] != "http" || heartbeat.Capabilities[1] != "magnet" || heartbeat.Capabilities[2] != "torrent" || heartbeat.Capabilities[3] != "torrent_url" {
		t.Fatalf("expected BT plus HTTP capabilities, got %#v", heartbeat.Capabilities)
	}
}

func TestRegistrationHeartbeatUsesConfiguredExternalEngine(t *testing.T) {
	heartbeat := registrationHeartbeat(config.Config{Engine: "auto", MaxConcurrentTasks: 2, Aria2Configured: true})
	if heartbeat.Engine != "aria2" {
		t.Fatalf("expected aria2 engine, got %q", heartbeat.Engine)
	}
}

func TestNormalizeRegistrationEngineBranches(t *testing.T) {
	tests := []struct {
		cfg  config.Config
		want string
	}{
		{cfg: config.Config{Engine: " HTTP "}, want: "http"},
		{cfg: config.Config{Engine: "qbittorrent"}, want: "qbittorrent"},
		{cfg: config.Config{Engine: "auto", QBittorrentConfigured: true}, want: "qbittorrent"},
		{cfg: config.Config{Engine: "unknown"}, want: "aria2"},
	}
	for _, tt := range tests {
		if got := normalizeRegistrationEngine(tt.cfg); got != tt.want {
			t.Fatalf("expected %q, got %q", tt.want, got)
		}
	}
}

func TestValidateConfiguredEngineRejectsUnknownEngine(t *testing.T) {
	if err := validateConfiguredEngine("bad-engine"); err == nil {
		t.Fatal("expected unsupported engine error")
	}
	for _, engine := range []string{"", "auto", "http", "aria2", "qbittorrent", " warning "} {
		if engine == " warning " {
			continue
		}
		if err := validateConfiguredEngine(engine); err != nil {
			t.Fatalf("expected valid engine %q: %v", engine, err)
		}
	}
}

func TestLogLevelPendingAuthNameAndCapabilitiesHelpers(t *testing.T) {
	for _, level := range []string{"debug", "info", "", "warn", "warning", "error", "bad"} {
		setLogLevel(level)
	}
	if !isPendingDeviceAuthError(assertError("authorization_pending")) {
		t.Fatal("authorization_pending should be pending")
	}
	if !isPendingDeviceAuthError(assertError("slow_down")) {
		t.Fatal("slow_down should be pending")
	}
	if isPendingDeviceAuthError(assertError("access_denied")) {
		t.Fatal("access_denied should not be pending")
	}
	if len(runtimeCapabilities("http")) != 1 || runtimeCapabilities("http")[0] != "http" {
		t.Fatalf("unexpected http capabilities")
	}
	if downloaderName() == "" {
		t.Fatal("downloader name should never be empty")
	}
}

func TestPollDeviceTokenStopsOnContextAndExpiry(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := pollDeviceToken(ctx, nil, client.DeviceCode{DeviceCode: "device-1", ExpiresIn: 60, Interval: 1}); err == nil {
		t.Fatal("expected canceled context error")
	}
	if _, err := pollDeviceToken(context.Background(), nil, client.DeviceCode{DeviceCode: "device-1", ExpiresIn: -1, Interval: 1}); err == nil {
		t.Fatal("expected expired device login")
	}
}

func TestRootCommandExposesDownloaderSubcommands(t *testing.T) {
	root := rootCommand()
	if root.Name() != "zpan" {
		t.Fatalf("expected root command zpan, got %q", root.Name())
	}
	for _, command := range rootCommand().Commands() {
		if command.Name() == "login" {
			t.Fatal("login command should not be exposed")
		}
		if command.Name() == "run" {
			t.Fatal("run command should not be exposed at root")
		}
	}
	downloader, _, err := root.Find([]string{"downloader", "up"})
	if err != nil {
		t.Fatal(err)
	}
	if downloader.Name() != "up" {
		t.Fatalf("expected downloader up command, got %q", downloader.Name())
	}
	config, _, err := root.Find([]string{"config", "init"})
	if err != nil {
		t.Fatal(err)
	}
	if config.Name() != "init" {
		t.Fatalf("expected root config init command, got %q", config.Name())
	}
	if config.Flags().Lookup("server-url") == nil {
		t.Fatal("expected config init --server-url flag")
	}
	if command, _, err := root.Find([]string{"downloader", "config"}); err == nil && command.Name() == "config" {
		t.Fatal("downloader config command should not be exposed")
	}
}

func TestConfigInitCommandWritesDefaultConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	root := rootCommand()
	root.SetArgs([]string{"--config", path, "config", "init", "--server-url", "https://zpan.test"})
	var out bytes.Buffer
	root.SetOut(&out)
	root.SetErr(&out)
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	data := readFile(t, path)
	if !strings.Contains(data, `server_url: "https://zpan.test"`) {
		t.Fatalf("unexpected config file:\n%s", data)
	}
}

func TestRegisterDownloaderWithDeviceLoginHappyPath(t *testing.T) {
	var tokenPolls int
	var createBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/auth/device/code":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":               "device-1",
				"user_code":                 "ABCD-EFGH",
				"verification_uri":          serverURL(r) + "/device",
				"verification_uri_complete": serverURL(r) + "/device?user_code=ABCD-EFGH",
				"expires_in":                5,
				"interval":                  1,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/auth/device/token":
			tokenPolls++
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "access-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/downloads/downloaders":
			if r.Header.Get("Authorization") != "Bearer access-token" {
				t.Fatalf("unexpected auth header: %q", r.Header.Get("Authorization"))
			}
			if err := json.NewDecoder(r.Body).Decode(&createBody); err != nil {
				t.Fatal(err)
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"downloader": map[string]any{"id": "downloader-1"},
				"token":      "downloader-token",
			})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	cfgFile := filepath.Join(t.TempDir(), "config.yaml")
	cmd := &cobra.Command{}
	var out bytes.Buffer
	cmd.SetOut(&out)
	registered, err := registerDownloaderWithDeviceLogin(context.Background(), cmd, config.Config{
		ServerURL:          server.URL,
		Engine:             "http",
		MaxConcurrentTasks: 2,
	}, cfgFile)
	if err != nil {
		t.Fatal(err)
	}
	if registered.Token != "downloader-token" || registered.Downloader.ID != "downloader-1" {
		t.Fatalf("unexpected registration response: %#v", registered)
	}
	if tokenPolls != 1 {
		t.Fatalf("expected one token poll, got %d", tokenPolls)
	}
	heartbeat, ok := createBody["heartbeat"].(map[string]any)
	if !ok || heartbeat["engine"] != "http" || heartbeat["maxConcurrentTasks"] != float64(2) {
		t.Fatalf("unexpected create downloader body: %#v", createBody)
	}
	if !strings.Contains(out.String(), "Downloader registered: downloader-1") {
		t.Fatalf("unexpected output: %s", out.String())
	}
	data := readFile(t, cfgFile)
	if !strings.Contains(data, `token: "downloader-token"`) {
		t.Fatalf("registered token was not saved:\n%s", data)
	}
}

type assertError string

func (e assertError) Error() string {
	return string(e)
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func serverURL(r *http.Request) string {
	return "http://" + r.Host
}
