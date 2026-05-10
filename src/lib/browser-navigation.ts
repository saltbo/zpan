export function redirectExternal(url: string) {
  window.location.assign(url)
}

export function openNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}
