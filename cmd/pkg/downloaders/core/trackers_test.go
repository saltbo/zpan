package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/saltbo/zpan/internal/downloader"
)

func TestFetchBTTrackers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(" udp://tracker.example:1337/announce \n"))
	}))
	defer server.Close()

	trackers, err := fetchBTTrackers(context.Background(), server.Client(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if trackers != "udp://tracker.example:1337/announce" {
		t.Fatalf("unexpected trackers: %q", trackers)
	}
}

func TestFetchBTTrackersReturnsErrors(t *testing.T) {
	t.Run("status", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "nope", http.StatusBadGateway)
		}))
		defer server.Close()

		_, err := fetchBTTrackers(context.Background(), server.Client(), server.URL)
		if err == nil || !strings.Contains(err.Error(), "502") {
			t.Fatalf("expected status error, got %v", err)
		}
	})

	t.Run("empty", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		defer server.Close()

		_, err := fetchBTTrackers(context.Background(), server.Client(), server.URL)
		if err == nil || !strings.Contains(err.Error(), "empty") {
			t.Fatalf("expected empty response error, got %v", err)
		}
	})
}

func TestBTTrackersForQBittorrent(t *testing.T) {
	got := BTTrackersForQBittorrent(" udp://one/announce,\n udp://two/announce\r\nudp://three/announce ")
	want := "udp://one/announce|udp://two/announce|udp://three/announce"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestBTTrackersUsesConfiguredValueWithoutFetch(t *testing.T) {
	got := BTTrackers(" udp://configured.example:1337/announce ")
	if got != "udp://configured.example:1337/announce" {
		t.Fatalf("unexpected configured trackers: %q", got)
	}
}

func TestDefaultBTTrackers(t *testing.T) {
	got := DefaultBTTrackers()
	if got == "" {
		t.Fatal("expected bundled trackers")
	}
	if !strings.Contains(got, "udp://tracker.opentrackr.org:1337/announce") {
		t.Fatalf("expected bundled tracker list, got %q", got)
	}
	if strings.Contains(got, "\n") {
		t.Fatalf("default trackers should be comma-separated, got %q", got)
	}
}

type regionResolver struct{}

func (regionResolver) LookupPeerRegion(ip string) (string, string) {
	if ip == "203.0.113.10" {
		return "US", "CA"
	}
	return "", ""
}

func TestApplyPeerRegion(t *testing.T) {
	ApplyPeerRegion(nil, "203.0.113.10", "", regionResolver{})

	peer := downloader.Peer{}
	ApplyPeerRegion(&peer, "203.0.113.10", "", regionResolver{})
	if peer.CountryCode != "US" || peer.RegionCode != "CA" {
		t.Fatalf("expected resolver region, got %#v", peer)
	}
	peer = downloader.Peer{}
	ApplyPeerRegion(&peer, "198.51.100.10", "JP", regionResolver{})
	if peer.CountryCode != "JP" || peer.RegionCode != "" {
		t.Fatalf("expected fallback country, got %#v", peer)
	}
}
