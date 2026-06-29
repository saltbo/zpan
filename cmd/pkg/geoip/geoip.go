package geoip

import (
	"errors"
	"net"
	"os"
	"regexp"
	"strings"

	"github.com/oschwald/geoip2-golang"
)

var geoIPCodePattern = regexp.MustCompile(`^[A-Z0-9-]+$`)

type Resolver interface {
	LookupPeerRegion(ip string) (countryCode string, regionCode string)
}

type DB struct {
	db *geoip2.Reader
}

func Open(path string) (*DB, error) {
	if path == "" {
		return nil, nil
	}
	db, err := geoip2.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	return &DB{db: db}, nil
}

func (r *DB) Close() error {
	if r == nil || r.db == nil {
		return nil
	}
	return r.db.Close()
}

func (r *DB) LookupPeerRegion(ip string) (string, string) {
	if r == nil || r.db == nil {
		return "", ""
	}
	parsed := net.ParseIP(strings.TrimSpace(ip))
	if parsed == nil {
		return "", ""
	}
	record, err := r.db.City(parsed)
	if err != nil || record == nil {
		return "", ""
	}
	country := strings.ToUpper(record.Country.IsoCode)
	if country == "" {
		country = strings.ToUpper(record.RegisteredCountry.IsoCode)
	}
	region := ""
	if len(record.Subdivisions) > 0 {
		region = strings.ToUpper(record.Subdivisions[0].IsoCode)
	}
	return country, region
}

func NormalizeRegion(ip string, fallbackCountryCode string, geoIP Resolver) (string, string) {
	country, region := "", ""
	if geoIP != nil {
		country, region = geoIP.LookupPeerRegion(ip)
	}
	if country == "" {
		country = fallbackCountryCode
	}
	return normalizeGeoIPCode(country, 2), normalizeGeoIPCode(region, 16)
}

func normalizeGeoIPCode(value string, maxLen int) string {
	code := strings.ToUpper(strings.TrimSpace(value))
	if code == "" || len(code) > maxLen || !geoIPCodePattern.MatchString(code) {
		return ""
	}
	return code
}
