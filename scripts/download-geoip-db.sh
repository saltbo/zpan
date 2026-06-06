#!/usr/bin/env sh
set -eu

year_month="${GEOIP_DB_MONTH:-$(date -u +%Y-%m)}"
url="${GEOIP_DB_URL:-https://download.db-ip.com/free/dbip-city-lite-${year_month}.mmdb.gz}"
out="${GEOIP_DB_PATH:-cmd/data/geoip.mmdb}"
tmp="${out}.gz"

mkdir -p "$(dirname "$out")"
curl -fsSL "$url" -o "$tmp"
gzip -dc "$tmp" > "$out"
rm -f "$tmp"

echo "GeoIP database written to $out"
