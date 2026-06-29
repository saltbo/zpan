package system

import (
	"os/exec"
	"path/filepath"
	"testing"
)

func TestParseLocalEngineURL(t *testing.T) {
	cases := []struct {
		raw  string
		port string
	}{
		{"", "6800"},
		{"http://127.0.0.1:6888/jsonrpc", "6888"},
		{"http://localhost", "6800"},
		{"ws://127.0.0.1:6801/jsonrpc", "6801"},
		{"wss://[::1]:6802/jsonrpc", "6802"},
	}
	for _, tc := range cases {
		got, err := ParseLocalEngineURL(tc.raw, "6800")
		if err != nil {
			t.Fatalf("ParseLocalEngineURL(%q): %v", tc.raw, err)
		}
		if got.Port != tc.port {
			t.Fatalf("ParseLocalEngineURL(%q) port=%q, want %q", tc.raw, got.Port, tc.port)
		}
	}
}

func TestParseLocalEngineURLRejectsRemoteAndInvalidPorts(t *testing.T) {
	if _, err := ParseLocalEngineURL("http://example.com:6800", "6800"); err == nil {
		t.Fatal("expected remote host rejection")
	}
	if _, err := ParseLocalEngineURL("http://127.0.0.1:bad", "6800"); err == nil {
		t.Fatal("expected invalid port error")
	}
	if _, err := ParseLocalEngineURL("http://127.0.0.1", "bad"); err == nil {
		t.Fatal("expected invalid default port error")
	}
}

func TestLookPathAnyAndFilepathBase(t *testing.T) {
	path, err := LookPathAny("definitely-not-a-zpan-test-binary", "go")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "go" {
		t.Fatalf("expected go binary, got %q", path)
	}
	if _, err := LookPathAny("definitely-not-a-zpan-test-binary"); err == nil {
		t.Fatal("expected lookup error")
	}
	if FilepathBase(`C:\Program Files\qBittorrent\qbittorrent.exe`) != "qbittorrent.exe" {
		t.Fatal("expected windows basename")
	}
	if FilepathBase("/usr/bin/aria2c") != "aria2c" {
		t.Fatal("expected unix basename")
	}
	if _, err := exec.LookPath("go"); err != nil {
		t.Fatal(err)
	}
}
