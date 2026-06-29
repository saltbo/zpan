package geoip

import (
	"os"
	"path/filepath"
	"testing"
)

type fakeResolver struct{}

func (fakeResolver) LookupPeerRegion(ip string) (string, string) {
	if ip == "203.0.113.10" {
		return "us", "ca"
	}
	return "", ""
}

func TestNormalizeRegionUsesGeoIPAndFallbackCountry(t *testing.T) {
	country, region := NormalizeRegion("203.0.113.10", "", fakeResolver{})
	if country != "US" || region != "CA" {
		t.Fatalf("expected US/CA from geoip, got %s/%s", country, region)
	}

	country, region = NormalizeRegion("198.51.100.10", "jp", fakeResolver{})
	if country != "JP" || region != "" {
		t.Fatalf("expected JP fallback country, got %s/%s", country, region)
	}
}

func TestOpenHandlesEmptyMissingAndInvalidDatabases(t *testing.T) {
	db, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	if db != nil {
		t.Fatalf("expected nil db for empty path, got %#v", db)
	}

	db, err = Open(filepath.Join(t.TempDir(), "missing.mmdb"))
	if err != nil {
		t.Fatal(err)
	}
	if db != nil {
		t.Fatalf("expected nil db for missing path, got %#v", db)
	}

	path := filepath.Join(t.TempDir(), "invalid.mmdb")
	if err := os.WriteFile(path, []byte("not a maxmind database"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path); err == nil {
		t.Fatal("expected invalid database error")
	}
}

func TestDBCloseAndLookupEmptyDatabase(t *testing.T) {
	if err := ((*DB)(nil)).Close(); err != nil {
		t.Fatal(err)
	}
	db := &DB{}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	country, region := db.LookupPeerRegion("203.0.113.10")
	if country != "" || region != "" {
		t.Fatalf("expected empty region for nil reader, got %s/%s", country, region)
	}
	country, region = ((*DB)(nil)).LookupPeerRegion("203.0.113.10")
	if country != "" || region != "" {
		t.Fatalf("expected empty region for nil DB, got %s/%s", country, region)
	}
}
