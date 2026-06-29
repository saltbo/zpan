package downloader

import (
	"context"
	"strings"
	"testing"

	"github.com/saltbo/zpan/internal/config"
)

type testRegistration struct {
	name       string
	fallback   bool
	configured bool
}

type testDownloader struct {
	name       string
	sourceType []string
}

type seedRestoringTestDownloader struct {
	testDownloader
	restoreCalls int
}

func (d testDownloader) Name() string {
	return d.name
}

func (d testDownloader) Capabilities() Capabilities {
	sourceTypes := d.sourceType
	if len(sourceTypes) == 0 {
		sourceTypes = []string{"http", "magnet", "torrent", "torrent_url"}
	}
	return Capabilities{SourceTypes: sourceTypes}
}

func (d testDownloader) Start(context.Context) error {
	return nil
}

func (d testDownloader) Stop(context.Context) error {
	return nil
}

func (d testDownloader) Check(context.Context) error {
	return nil
}

func (d testDownloader) InspectTask(context.Context, DownloadTask) (TaskSnapshot, bool, error) {
	return TaskSnapshot{}, false, nil
}

func (d testDownloader) Download(context.Context, DownloadTask, ProgressReporter) (Result, error) {
	return Result{Name: d.name}, nil
}

func (d *seedRestoringTestDownloader) RestoreSeed(context.Context, SeedRef) (*Seed, error) {
	d.restoreCalls++
	return &Seed{Engine: d.name, ID: d.name + "-seed"}, nil
}

func TestAutoManagerStartsOneConfiguredBTAndHTTPDownloaders(t *testing.T) {
	registerTestDownloaders(t,
		testRegistration{name: "aria2"},
		testRegistration{name: "qbittorrent", configured: true},
		testRegistration{name: "http", fallback: true},
	)

	manager := NewManager(config.Config{}, nil, nil)
	if err := manager.Start(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	downloaders := manager.currentDownloaders()
	if len(downloaders) != 2 {
		t.Fatalf("expected one BT downloader plus HTTP, got %d", len(downloaders))
	}
	if manager.Name() != "qbittorrent" {
		t.Fatalf("expected selected BT name, got %q", manager.Name())
	}
}

func TestManagerRejectsUnknownBTDownloader(t *testing.T) {
	registerTestDownloaders(t, testRegistration{name: "aria2"}, testRegistration{name: "http", fallback: true})

	manager := NewManager(config.Config{Engine: "bad-engine"}, nil, nil)

	err := manager.Start(context.Background(), nil)
	if err == nil {
		t.Fatal("expected unsupported downloader error")
	}
	if !strings.Contains(err.Error(), "bad-engine") {
		t.Fatalf("expected error to mention configured downloader, got %v", err)
	}
}

func TestHTTPOnlyManagerRejectsBTTask(t *testing.T) {
	manager := NewManagerWithDownloaders(testDownloader{name: "http", sourceType: []string{"http"}})
	_, err := manager.Download(context.Background(), DownloadTask{Source: Source{Type: "magnet"}}, nil)
	if err == nil || !strings.Contains(err.Error(), "no downloader supports") {
		t.Fatalf("expected unsupported source type error, got %v", err)
	}
}

func TestAutoManagerRejectsMultipleConfiguredBTDownloaders(t *testing.T) {
	registerTestDownloaders(t,
		testRegistration{name: "aria2", configured: true},
		testRegistration{name: "qbittorrent", configured: true},
		testRegistration{name: "http", fallback: true},
	)

	manager := NewManager(config.Config{}, nil, nil)
	err := manager.Start(context.Background(), nil)
	if err == nil || !strings.Contains(err.Error(), "multiple BT downloaders") {
		t.Fatalf("expected multiple BT downloader error, got %v", err)
	}
}

func TestManagerSelectsDownloaderBySourceType(t *testing.T) {
	manager := NewManagerWithDownloaders(
		testDownloader{name: "aria2", sourceType: []string{"magnet", "torrent_url"}},
		testDownloader{name: "http", sourceType: []string{"http"}},
	)

	result, err := manager.Download(context.Background(), DownloadTask{Source: Source{Type: "http"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Name != "http" {
		t.Fatalf("expected http downloader, got %q", result.Name)
	}
	result, err = manager.Download(context.Background(), DownloadTask{Source: Source{Type: "magnet"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Name != "aria2" {
		t.Fatalf("expected aria2 downloader, got %q", result.Name)
	}
}

func TestManagerRestoreSeedRequiresMatchingEngine(t *testing.T) {
	aria2 := &seedRestoringTestDownloader{testDownloader: testDownloader{name: "aria2"}}
	qbit := &seedRestoringTestDownloader{testDownloader: testDownloader{name: "qbittorrent"}}
	manager := NewManagerWithDownloaders(aria2, qbit)

	seed, supported, err := manager.RestoreSeed(context.Background(), SeedRef{Engine: "qbittorrent", ID: "seed-1"})
	if err != nil {
		t.Fatal(err)
	}
	if !supported {
		t.Fatal("expected matching engine to support restore")
	}
	if seed == nil || seed.Engine != "qbittorrent" {
		t.Fatalf("expected qbittorrent seed, got %#v", seed)
	}
	if aria2.restoreCalls != 0 {
		t.Fatalf("expected aria2 not to restore qbit seed, got %d calls", aria2.restoreCalls)
	}
	if qbit.restoreCalls != 1 {
		t.Fatalf("expected qbit restore once, got %d", qbit.restoreCalls)
	}
}

func TestManagerRestoreSeedDoesNotFallbackWhenEngineIsMissing(t *testing.T) {
	aria2 := &seedRestoringTestDownloader{testDownloader: testDownloader{name: "aria2"}}
	manager := NewManagerWithDownloaders(aria2)

	seed, supported, err := manager.RestoreSeed(context.Background(), SeedRef{Engine: "qbittorrent", ID: "seed-1"})
	if err != nil {
		t.Fatal(err)
	}
	if supported {
		t.Fatalf("expected missing explicit engine to be unsupported, got seed %#v", seed)
	}
	if seed != nil {
		t.Fatalf("expected no seed, got %#v", seed)
	}
	if aria2.restoreCalls != 0 {
		t.Fatalf("expected aria2 not to restore qbit seed, got %d calls", aria2.restoreCalls)
	}
}

func registerTestDownloaders(t *testing.T, entries ...testRegistration) {
	t.Helper()
	original := registeredDownloaders
	registeredDownloaders = nil
	for _, entry := range entries {
		name := entry.name
		configured := entry.configured
		Register(
			entry.name,
			entry.fallback,
			func(Config) bool { return configured },
			func(Config) (Downloader, error) { return testDownloader{name: name}, nil },
		)
	}
	t.Cleanup(func() {
		registeredDownloaders = original
	})
}
