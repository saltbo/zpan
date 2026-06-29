package core

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

const btTrackerListURL = "https://raw.githubusercontent.com/XIU2/TrackersListCollection/master/best_aria2.txt"

var defaultBTTrackers = []string{
	"udp://tracker.opentrackr.org:1337/announce",
	"udp://open.demonii.com:1337/announce",
	"udp://open.stealth.si:80/announce",
	"udp://tracker.torrent.eu.org:451/announce",
	"udp://exodus.desync.com:6969/announce",
	"udp://tracker.openbittorrent.com:6969/announce",
	"udp://opentracker.i2p.rocks:6969/announce",
	"udp://tracker.dler.org:6969/announce",
	"http://tracker.openbittorrent.com:80/announce",
	"udp://tracker.moeking.me:6969/announce",
}

var (
	cachedBTTrackers string
	loadBTTrackers   sync.Once
)

func BTTrackers(configured string) string {
	if trackers := strings.TrimSpace(configured); trackers != "" {
		return trackers
	}
	loadBTTrackers.Do(func() {
		cachedBTTrackers = FetchBTTrackers()
	})
	return cachedBTTrackers
}

func FetchBTTrackers() string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	trackers, err := fetchBTTrackers(ctx, http.DefaultClient, btTrackerListURL)
	if err != nil {
		slog.Warn("fetch bt trackers failed, using bundled fallback", "url", btTrackerListURL, "err", err)
		return DefaultBTTrackers()
	}
	return trackers
}

func fetchBTTrackers(ctx context.Context, client *http.Client, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if list := strings.TrimSpace(string(body)); list != "" {
		return list, nil
	}
	return "", errors.New("empty tracker list")
}

func DefaultBTTrackers() string {
	return strings.Join(defaultBTTrackers, ",")
}

func BTTrackersForQBittorrent(trackers string) string {
	parts := strings.FieldsFunc(trackers, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r'
	})
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		tracker := strings.TrimSpace(part)
		if tracker != "" {
			out = append(out, tracker)
		}
	}
	return strings.Join(out, "|")
}
