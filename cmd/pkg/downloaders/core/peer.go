package core

import (
	"github.com/saltbo/zpan/internal/downloader"
	"github.com/saltbo/zpan/pkg/geoip"
)

func ApplyPeerRegion(peer *downloader.Peer, ip string, fallbackCountryCode string, resolver geoip.Resolver) {
	if peer == nil {
		return
	}
	peer.CountryCode, peer.RegionCode = geoip.NormalizeRegion(ip, fallbackCountryCode, resolver)
}
