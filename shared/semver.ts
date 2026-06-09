// Minimal semver comparison for the version freshness check on the About page.
// Compares the major.minor.patch core only; any pre-release/build suffix is
// ignored. Returns 1 if a > b, -1 if a < b, 0 if equal or either is unparseable.
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number] | null => {
    const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
    if (!m) return null
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}
