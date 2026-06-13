export function buildBreadcrumb(dir: string): string[] {
  if (!dir) return []
  return dir.split('/')
}
