package mediascrape

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// The server lists a media library's videos by the extensions in
// server/domain/media-library.ts. A video the downloader skips is uploaded
// unscraped, so the two lists must stay the same.
func TestVideoExtensionsMatchServer(t *testing.T) {
	source, err := os.ReadFile("../../../server/domain/media-library.ts")
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)VIDEO_MIME_BY_EXTENSION[^{]*\{(.*?)\n\}`).FindSubmatch(source)
	if block == nil {
		t.Fatal("VIDEO_MIME_BY_EXTENSION not found in server/domain/media-library.ts")
	}
	var server []string
	for _, key := range regexp.MustCompile(`(?m)^\s*([a-z0-9]+):`).FindAllSubmatch(block[1], -1) {
		server = append(server, "."+string(key[1]))
	}
	var downloader []string
	for ext := range videoExtensions {
		downloader = append(downloader, ext)
	}
	slices.Sort(server)
	slices.Sort(downloader)
	if !slices.Equal(server, downloader) {
		t.Fatalf("video extensions differ\nserver:     %s\ndownloader: %s", strings.Join(server, " "), strings.Join(downloader, " "))
	}
}
