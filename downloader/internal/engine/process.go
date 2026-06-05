package engine

import (
	"context"
	"fmt"
	"net/url"
	"os/exec"
	"strconv"
	"strings"
)

type Starter interface {
	Start(ctx context.Context) (*exec.Cmd, error)
}

type localEngineURL struct {
	port string
}

func lookPathAny(names ...string) (string, error) {
	var lastErr error
	for _, name := range names {
		path, err := exec.LookPath(name)
		if err == nil {
			return path, nil
		}
		lastErr = err
	}
	return "", lastErr
}

func parseLocalEngineURL(raw string, defaultPort string) (localEngineURL, error) {
	normalized := raw
	if strings.HasPrefix(normalized, "ws://") {
		normalized = "http://" + strings.TrimPrefix(normalized, "ws://")
	}
	if strings.HasPrefix(normalized, "wss://") {
		normalized = "https://" + strings.TrimPrefix(normalized, "wss://")
	}
	parsed, err := url.Parse(normalized)
	if err != nil {
		return localEngineURL{}, err
	}
	host := parsed.Hostname()
	if host != "" && host != "127.0.0.1" && host != "localhost" && host != "::1" {
		return localEngineURL{}, fmt.Errorf("auto start only supports local engine URLs, got %s", host)
	}
	port := parsed.Port()
	if port == "" {
		port = defaultPort
	}
	if _, err := strconv.Atoi(port); err != nil {
		return localEngineURL{}, fmt.Errorf("invalid engine port %q", port)
	}
	return localEngineURL{port: port}, nil
}

func filepathBase(path string) string {
	parts := strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' })
	if len(parts) == 0 {
		return path
	}
	return parts[len(parts)-1]
}
