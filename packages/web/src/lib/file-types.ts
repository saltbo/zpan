export type PreviewType = 'image' | 'pdf' | 'text' | 'markdown' | 'code' | 'audio' | 'video' | 'unsupported'

const EXTENSION_MAP: Record<string, PreviewType> = {
  // Images
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  // PDF
  pdf: 'pdf',
  // Markdown
  md: 'markdown',
  markdown: 'markdown',
  // Code
  ts: 'code',
  js: 'code',
  tsx: 'code',
  jsx: 'code',
  py: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  c: 'code',
  cpp: 'code',
  h: 'code',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
  xml: 'code',
  html: 'code',
  css: 'code',
  scss: 'code',
  sh: 'code',
  bash: 'code',
  sql: 'code',
  dockerfile: 'code',
  // Text
  txt: 'text',
  log: 'text',
  csv: 'text',
  env: 'text',
  gitignore: 'text',
  editorconfig: 'text',
  // Audio
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  aac: 'audio',
  m4a: 'audio',
  wma: 'audio',
  // Video
  mp4: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  mov: 'video',
  wmv: 'video',
  flv: 'video',
}

const EXTENSION_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  tsx: 'tsx',
  jsx: 'jsx',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sh: 'bash',
  bash: 'bash',
  sql: 'sql',
  dockerfile: 'dockerfile',
}

function getExtension(filename: string): string {
  const name = filename.toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return ''
  return name.slice(dotIndex + 1)
}

export function getPreviewType(filename: string, mimeType?: string): PreviewType {
  const ext = getExtension(filename)
  if (ext && EXTENSION_MAP[ext]) return EXTENSION_MAP[ext]

  if (mimeType) {
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType === 'application/pdf') return 'pdf'
    if (mimeType.startsWith('audio/')) return 'audio'
    if (mimeType.startsWith('video/')) return 'video'
    if (mimeType.startsWith('text/')) return 'text'
  }

  return 'unsupported'
}

export function getLanguageFromFilename(filename: string): string {
  const ext = getExtension(filename)
  return EXTENSION_TO_LANG[ext] ?? 'text'
}
