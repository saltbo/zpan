export type PreviewType = 'image' | 'pdf' | 'text' | 'markdown' | 'code' | 'audio' | 'video' | 'unsupported'

const extensionMap: Record<string, PreviewType> = {
  // Image
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

const exactMimeMap: Record<string, PreviewType> = {
  'application/pdf': 'pdf',
  'text/markdown': 'markdown',
}

const prefixMimeMap: Array<[string, PreviewType]> = [
  ['image/', 'image'],
  ['audio/', 'audio'],
  ['video/', 'video'],
  ['text/', 'text'],
]

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot <= 0) return ''
  return filename.slice(lastDot + 1).toLowerCase()
}

export function getPreviewType(filename: string, mimeType?: string): PreviewType {
  const ext = getExtension(filename)
  const fromExt = extensionMap[ext]
  if (fromExt) return fromExt

  if (mimeType) {
    const exact = exactMimeMap[mimeType]
    if (exact) return exact
    for (const [prefix, type] of prefixMimeMap) {
      if (mimeType.startsWith(prefix)) return type
    }
  }

  return 'unsupported'
}

const shikiLanguageMap: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
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

export function getShikiLanguage(filename: string): string {
  const ext = getExtension(filename)
  return shikiLanguageMap[ext] ?? 'text'
}
