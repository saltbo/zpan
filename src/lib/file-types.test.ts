import { describe, expect, it } from 'vitest'
import { getPreviewType, getShikiLanguage } from './file-types'

describe('getPreviewType — image extensions', () => {
  it('returns image for .jpg', () => {
    expect(getPreviewType('photo.jpg')).toBe('image')
  })

  it('returns image for .jpeg', () => {
    expect(getPreviewType('photo.jpeg')).toBe('image')
  })

  it('returns image for .png', () => {
    expect(getPreviewType('screenshot.png')).toBe('image')
  })

  it('returns image for .gif', () => {
    expect(getPreviewType('animation.gif')).toBe('image')
  })

  it('returns image for .webp', () => {
    expect(getPreviewType('image.webp')).toBe('image')
  })

  it('returns image for .svg', () => {
    expect(getPreviewType('icon.svg')).toBe('image')
  })

  it('returns image for .bmp', () => {
    expect(getPreviewType('bitmap.bmp')).toBe('image')
  })

  it('returns image for .ico', () => {
    expect(getPreviewType('favicon.ico')).toBe('image')
  })
})

describe('getPreviewType — pdf extension', () => {
  it('returns pdf for .pdf', () => {
    expect(getPreviewType('document.pdf')).toBe('pdf')
  })
})

describe('getPreviewType — markdown extensions', () => {
  it('returns markdown for .md', () => {
    expect(getPreviewType('README.md')).toBe('markdown')
  })

  it('returns markdown for .markdown', () => {
    expect(getPreviewType('notes.markdown')).toBe('markdown')
  })
})

describe('getPreviewType — code extensions', () => {
  it('returns code for .ts', () => {
    expect(getPreviewType('app.ts')).toBe('code')
  })

  it('returns code for .js', () => {
    expect(getPreviewType('index.js')).toBe('code')
  })

  it('returns code for .tsx', () => {
    expect(getPreviewType('component.tsx')).toBe('code')
  })

  it('returns code for .jsx', () => {
    expect(getPreviewType('component.jsx')).toBe('code')
  })

  it('returns code for .py', () => {
    expect(getPreviewType('script.py')).toBe('code')
  })

  it('returns code for .go', () => {
    expect(getPreviewType('main.go')).toBe('code')
  })

  it('returns code for .rs', () => {
    expect(getPreviewType('lib.rs')).toBe('code')
  })

  it('returns code for .java', () => {
    expect(getPreviewType('Main.java')).toBe('code')
  })

  it('returns code for .c', () => {
    expect(getPreviewType('hello.c')).toBe('code')
  })

  it('returns code for .cpp', () => {
    expect(getPreviewType('main.cpp')).toBe('code')
  })

  it('returns code for .h', () => {
    expect(getPreviewType('header.h')).toBe('code')
  })

  it('returns code for .json', () => {
    expect(getPreviewType('config.json')).toBe('code')
  })

  it('returns code for .yaml', () => {
    expect(getPreviewType('pipeline.yaml')).toBe('code')
  })

  it('returns code for .yml', () => {
    expect(getPreviewType('docker-compose.yml')).toBe('code')
  })

  it('returns code for .toml', () => {
    expect(getPreviewType('Cargo.toml')).toBe('code')
  })

  it('returns code for .xml', () => {
    expect(getPreviewType('pom.xml')).toBe('code')
  })

  it('returns code for .html', () => {
    expect(getPreviewType('index.html')).toBe('code')
  })

  it('returns code for .css', () => {
    expect(getPreviewType('styles.css')).toBe('code')
  })

  it('returns code for .scss', () => {
    expect(getPreviewType('styles.scss')).toBe('code')
  })

  it('returns code for .sh', () => {
    expect(getPreviewType('deploy.sh')).toBe('code')
  })

  it('returns code for .bash', () => {
    expect(getPreviewType('setup.bash')).toBe('code')
  })

  it('returns code for .sql', () => {
    expect(getPreviewType('migration.sql')).toBe('code')
  })

  it('returns unsupported for dockerfile (bare filename, no dot)', () => {
    expect(getPreviewType('dockerfile')).toBe('unsupported')
  })
})

describe('getPreviewType — text extensions', () => {
  it('returns text for .txt', () => {
    expect(getPreviewType('notes.txt')).toBe('text')
  })

  it('returns text for .log', () => {
    expect(getPreviewType('app.log')).toBe('text')
  })

  it('returns text for .csv', () => {
    expect(getPreviewType('data.csv')).toBe('text')
  })

  it('returns unsupported for .env (dotfile, dot at position 0)', () => {
    expect(getPreviewType('.env')).toBe('unsupported')
  })

  it('returns unsupported for .gitignore (dotfile, dot at position 0)', () => {
    expect(getPreviewType('.gitignore')).toBe('unsupported')
  })

  it('returns unsupported for .editorconfig (dotfile, dot at position 0)', () => {
    expect(getPreviewType('.editorconfig')).toBe('unsupported')
  })
})

describe('getPreviewType — audio extensions', () => {
  it('returns audio for .mp3', () => {
    expect(getPreviewType('song.mp3')).toBe('audio')
  })

  it('returns audio for .wav', () => {
    expect(getPreviewType('sound.wav')).toBe('audio')
  })

  it('returns audio for .ogg', () => {
    expect(getPreviewType('track.ogg')).toBe('audio')
  })

  it('returns audio for .flac', () => {
    expect(getPreviewType('track.flac')).toBe('audio')
  })

  it('returns audio for .aac', () => {
    expect(getPreviewType('clip.aac')).toBe('audio')
  })

  it('returns audio for .m4a', () => {
    expect(getPreviewType('podcast.m4a')).toBe('audio')
  })

  it('returns audio for .wma', () => {
    expect(getPreviewType('audio.wma')).toBe('audio')
  })
})

describe('getPreviewType — video extensions', () => {
  it('returns video for .mp4', () => {
    expect(getPreviewType('movie.mp4')).toBe('video')
  })

  it('returns video for .webm', () => {
    expect(getPreviewType('clip.webm')).toBe('video')
  })

  it('returns video for .mkv', () => {
    expect(getPreviewType('film.mkv')).toBe('video')
  })

  it('returns video for .avi', () => {
    expect(getPreviewType('video.avi')).toBe('video')
  })

  it('returns video for .mov', () => {
    expect(getPreviewType('recording.mov')).toBe('video')
  })

  it('returns video for .wmv', () => {
    expect(getPreviewType('clip.wmv')).toBe('video')
  })

  it('returns video for .flv', () => {
    expect(getPreviewType('stream.flv')).toBe('video')
  })
})

describe('getPreviewType — case insensitivity', () => {
  it('returns image for .JPG (uppercase extension)', () => {
    expect(getPreviewType('PHOTO.JPG')).toBe('image')
  })

  it('returns code for .TS (uppercase extension)', () => {
    expect(getPreviewType('App.TS')).toBe('code')
  })

  it('returns pdf for .PDF (uppercase extension)', () => {
    expect(getPreviewType('DOC.PDF')).toBe('pdf')
  })
})

describe('getPreviewType — MIME type fallback', () => {
  it('returns image from image/ MIME prefix when extension is unknown', () => {
    expect(getPreviewType('file.unknown', 'image/tiff')).toBe('image')
  })

  it('returns audio from audio/ MIME prefix when extension is unknown', () => {
    expect(getPreviewType('file.unknown', 'audio/x-aiff')).toBe('audio')
  })

  it('returns video from video/ MIME prefix when extension is unknown', () => {
    expect(getPreviewType('file.unknown', 'video/x-matroska')).toBe('video')
  })

  it('returns pdf from application/pdf MIME type when extension is unknown', () => {
    expect(getPreviewType('file.unknown', 'application/pdf')).toBe('pdf')
  })

  it('returns markdown from text/markdown MIME type when extension is unknown', () => {
    expect(getPreviewType('file.unknown', 'text/markdown')).toBe('markdown')
  })

  it('returns text from text/ MIME prefix for plain text when extension is unknown', () => {
    expect(getPreviewType('file.unknown', 'text/plain')).toBe('text')
  })

  it('extension takes priority over MIME type', () => {
    expect(getPreviewType('photo.jpg', 'application/pdf')).toBe('image')
  })
})

describe('getPreviewType — unsupported files', () => {
  it('returns unsupported for .zip with no MIME type', () => {
    expect(getPreviewType('archive.zip')).toBe('unsupported')
  })

  it('returns unsupported for .exe with no MIME type', () => {
    expect(getPreviewType('installer.exe')).toBe('unsupported')
  })

  it('returns unsupported for unknown extension with non-matching MIME type', () => {
    expect(getPreviewType('binary.bin', 'application/octet-stream')).toBe('unsupported')
  })

  it('returns unsupported when no extension and no MIME type', () => {
    expect(getPreviewType('noextension')).toBe('unsupported')
  })

  it('returns unsupported when MIME type is undefined', () => {
    expect(getPreviewType('archive.zip', undefined)).toBe('unsupported')
  })
})

describe('getPreviewType — edge cases', () => {
  it('handles file with multiple dots by using the last extension', () => {
    expect(getPreviewType('archive.tar.gz')).toBe('unsupported')
  })

  it('handles file with path separators using only the last extension', () => {
    expect(getPreviewType('folder/photo.png')).toBe('image')
  })

  it('handles dotfiles like .env as unsupported when no MIME type provided', () => {
    expect(getPreviewType('.env')).toBe('unsupported')
  })
})

describe('getShikiLanguage — known extensions', () => {
  it('returns typescript for .ts', () => {
    expect(getShikiLanguage('app.ts')).toBe('typescript')
  })

  it('returns tsx for .tsx', () => {
    expect(getShikiLanguage('component.tsx')).toBe('tsx')
  })

  it('returns javascript for .js', () => {
    expect(getShikiLanguage('index.js')).toBe('javascript')
  })

  it('returns jsx for .jsx', () => {
    expect(getShikiLanguage('component.jsx')).toBe('jsx')
  })

  it('returns python for .py', () => {
    expect(getShikiLanguage('script.py')).toBe('python')
  })

  it('returns go for .go', () => {
    expect(getShikiLanguage('main.go')).toBe('go')
  })

  it('returns rust for .rs', () => {
    expect(getShikiLanguage('lib.rs')).toBe('rust')
  })

  it('returns java for .java', () => {
    expect(getShikiLanguage('Main.java')).toBe('java')
  })

  it('returns c for .c', () => {
    expect(getShikiLanguage('hello.c')).toBe('c')
  })

  it('returns cpp for .cpp', () => {
    expect(getShikiLanguage('main.cpp')).toBe('cpp')
  })

  it('returns c for .h header files', () => {
    expect(getShikiLanguage('header.h')).toBe('c')
  })

  it('returns json for .json', () => {
    expect(getShikiLanguage('config.json')).toBe('json')
  })

  it('returns yaml for .yaml', () => {
    expect(getShikiLanguage('pipeline.yaml')).toBe('yaml')
  })

  it('returns yaml for .yml', () => {
    expect(getShikiLanguage('docker-compose.yml')).toBe('yaml')
  })

  it('returns toml for .toml', () => {
    expect(getShikiLanguage('Cargo.toml')).toBe('toml')
  })

  it('returns xml for .xml', () => {
    expect(getShikiLanguage('pom.xml')).toBe('xml')
  })

  it('returns html for .html', () => {
    expect(getShikiLanguage('index.html')).toBe('html')
  })

  it('returns css for .css', () => {
    expect(getShikiLanguage('styles.css')).toBe('css')
  })

  it('returns scss for .scss', () => {
    expect(getShikiLanguage('styles.scss')).toBe('scss')
  })

  it('returns bash for .sh', () => {
    expect(getShikiLanguage('deploy.sh')).toBe('bash')
  })

  it('returns bash for .bash', () => {
    expect(getShikiLanguage('setup.bash')).toBe('bash')
  })

  it('returns sql for .sql', () => {
    expect(getShikiLanguage('migration.sql')).toBe('sql')
  })

  it('returns text for dockerfile (bare filename, no dot)', () => {
    expect(getShikiLanguage('dockerfile')).toBe('text')
  })
})

describe('getShikiLanguage — unknown extensions', () => {
  it('returns text for .txt (not in shiki map)', () => {
    expect(getShikiLanguage('notes.txt')).toBe('text')
  })

  it('returns text for .zip (unknown extension)', () => {
    expect(getShikiLanguage('archive.zip')).toBe('text')
  })

  it('returns text for a file with no extension', () => {
    expect(getShikiLanguage('noextension')).toBe('text')
  })

  it('returns text for .md (not in shiki map)', () => {
    expect(getShikiLanguage('README.md')).toBe('text')
  })
})

describe('getShikiLanguage — case insensitivity', () => {
  it('returns typescript for .TS (uppercase)', () => {
    expect(getShikiLanguage('App.TS')).toBe('typescript')
  })

  it('returns python for .PY (uppercase)', () => {
    expect(getShikiLanguage('Script.PY')).toBe('python')
  })
})
