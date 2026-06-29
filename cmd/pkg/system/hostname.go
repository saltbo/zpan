package system

import (
	"os"
	"strings"
)

const HostnamePath = "/host/etc/hostname"

func DownloaderHostname() string {
	if hostname := hostnameFromFile(HostnamePath); hostname != "" {
		return hostname
	}
	hostname, _ := os.Hostname()
	return strings.TrimSpace(hostname)
}

func hostnameFromFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
