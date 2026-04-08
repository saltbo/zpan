import { describe, expect, it } from 'vitest'
import { getLanguageFromFilename, getPreviewType } from './file-types'

describe('getPreviewType', () => {
  it('detects image extensions', () => {
    const exts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']
    for (const ext of exts) {
      expect(getPreviewType(`photo.${ext}`)).toBe('image')
    }
  })

  it('detects pdf extension', () => {
    expect(getPreviewType('doc.pdf')).toBe('pdf')
  })

  it('detects markdown extensions', () => {
    expect(getPreviewType('README.md')).toBe('markdown')
    expect(getPreviewType('notes.markdown')).toBe('markdown')
  })

  it('detects code extensions', () => {
    const exts = [
      'ts',
      'js',
      'tsx',
      'jsx',
      'py',
      'go',
      'rs',
      'java',
      'c',
      'cpp',
      'h',
      'json',
      'yaml',
      'yml',
      'toml',
      'xml',
      'html',
      'css',
      'scss',
      'sh',
      'bash',
      'sql',
    ]
    for (const ext of exts) {
      expect(getPreviewType(`file.${ext}`)).toBe('code')
    }
  })

  it('detects text extensions', () => {
    const exts = ['txt', 'log', 'csv', 'env', 'gitignore', 'editorconfig']
    for (const ext of exts) {
      expect(getPreviewType(`file.${ext}`)).toBe('text')
    }
  })

  it('detects audio extensions', () => {
    const exts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma']
    for (const ext of exts) {
      expect(getPreviewType(`track.${ext}`)).toBe('audio')
    }
  })

  it('detects video extensions', () => {
    const exts = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv']
    for (const ext of exts) {
      expect(getPreviewType(`clip.${ext}`)).toBe('video')
    }
  })

  it('handles Dockerfile (no extension)', () => {
    expect(getPreviewType('Dockerfile')).toBe('code')
    expect(getPreviewType('dockerfile')).toBe('code')
  })

  it('falls back to mimeType when extension is unknown', () => {
    expect(getPreviewType('file.xyz', 'image/heic')).toBe('image')
    expect(getPreviewType('file.xyz', 'application/pdf')).toBe('pdf')
    expect(getPreviewType('file.xyz', 'audio/mpeg')).toBe('audio')
    expect(getPreviewType('file.xyz', 'video/quicktime')).toBe('video')
    expect(getPreviewType('file.xyz', 'text/plain')).toBe('text')
  })

  it('returns unsupported for unknown file with no mimeType', () => {
    expect(getPreviewType('file.xyz')).toBe('unsupported')
  })

  it('returns unsupported for unknown file with unknown mimeType', () => {
    expect(getPreviewType('file.xyz', 'application/octet-stream')).toBe('unsupported')
  })

  it('is case-insensitive for extensions', () => {
    expect(getPreviewType('PHOTO.JPG')).toBe('image')
    expect(getPreviewType('Doc.PDF')).toBe('pdf')
  })
})

describe('getLanguageFromFilename', () => {
  it('returns correct language for known extensions', () => {
    const cases: [string, string][] = [
      ['app.ts', 'typescript'],
      ['app.js', 'javascript'],
      ['page.tsx', 'tsx'],
      ['page.jsx', 'jsx'],
      ['main.py', 'python'],
      ['main.go', 'go'],
      ['lib.rs', 'rust'],
      ['App.java', 'java'],
      ['main.c', 'c'],
      ['main.cpp', 'cpp'],
      ['header.h', 'c'],
      ['data.json', 'json'],
      ['config.yaml', 'yaml'],
      ['config.yml', 'yaml'],
      ['config.toml', 'toml'],
      ['feed.xml', 'xml'],
      ['index.html', 'html'],
      ['style.css', 'css'],
      ['style.scss', 'scss'],
      ['run.sh', 'bash'],
      ['run.bash', 'bash'],
      ['query.sql', 'sql'],
      ['Dockerfile', 'dockerfile'],
    ]
    for (const [filename, lang] of cases) {
      expect(getLanguageFromFilename(filename)).toBe(lang)
    }
  })

  it('returns text for unknown extensions', () => {
    expect(getLanguageFromFilename('file.xyz')).toBe('text')
    expect(getLanguageFromFilename('noext')).toBe('text')
  })
})
