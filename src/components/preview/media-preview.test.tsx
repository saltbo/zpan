import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreparedPlayback } from '@/lib/media-pipeline'
import { MediaPreview, mimeFromExt } from './media-preview'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const preparePlayback = vi.hoisted(() =>
  vi.fn<(url: string, onError: (e: unknown) => void) => Promise<PreparedPlayback>>(),
)
vi.mock('@/lib/media-pipeline', () => ({ preparePlayback }))

type TestSrc = { src: string | object; type?: string } | string

vi.mock('@vidstack/react', () => ({
  isVideoProvider: (provider: { type?: string }) => provider.type === 'video',
  MediaPlayer: ({
    children,
    src,
    onError,
    onProviderSetup,
  }: {
    children: ReactNode
    src: TestSrc
    onError: () => void
    onProviderSetup?: (provider: unknown) => void
  }) => {
    const value = typeof src === 'string' ? src : src.src
    const isObject = typeof value !== 'string'
    return (
      <div data-testid="media-player" data-src-kind={isObject ? 'object' : 'url'}>
        {/* biome-ignore lint/a11y/useMediaCaption: test double */}
        <video
          data-testid="video"
          onError={onError}
          ref={(video) => {
            if (video) onProviderSetup?.({ type: 'video', video })
          }}
        >
          {!isObject && <source data-testid="source" src={value as string} />}
        </video>
        {children}
      </div>
    )
  },
  MediaProvider: () => null,
}))

vi.mock('./subtitle-tracks', () => ({
  SubtitleTracks: ({ videoUrl, videoName, sidecars }: { videoUrl: string; videoName: string; sidecars: unknown[] }) => (
    <div data-testid="subtitle-tracks" data-url={videoUrl} data-name={videoName} data-count={sidecars.length} />
  ),
}))

vi.mock('@vidstack/react/player/layouts/default', () => ({
  DefaultAudioLayout: () => null,
  DefaultVideoLayout: () => null,
  defaultLayoutIcons: {},
}))

const URL = 'https://s3.example.com/movie?X-Amz-Signature=abc'

beforeEach(() => {
  preparePlayback.mockReset()
})

afterEach(cleanup)

describe('mimeFromExt', () => {
  it('maps video extensions to types the HTML5 provider accepts', () => {
    expect(mimeFromExt('a.mp4', 'video')).toBe('video/mp4')
    expect(mimeFromExt('a.MOV', 'video')).toBe('video/mp4')
    expect(mimeFromExt('a.webm', 'video')).toBe('video/webm')
    expect(mimeFromExt('a.mkv', 'video')).toBe('video/webm')
    expect(mimeFromExt('a.avi', 'video')).toBe('video/mp4')
  })

  it('keeps audio mapping unchanged', () => {
    expect(mimeFromExt('a.flac', 'audio')).toBe('audio/flac')
    expect(mimeFromExt('a.unknown', 'audio')).toBe('audio/mpeg')
  })
})

describe('MediaPreview video', () => {
  it('shows a checking state while the file is probed', async () => {
    preparePlayback.mockReturnValue(new Promise(() => {}))
    render(<MediaPreview url={URL} filename="movie.mkv" previewType="video" />)
    expect(screen.getByText('preview.analyzingVideo')).toBeTruthy()
    await waitFor(() => expect(preparePlayback).toHaveBeenCalledWith(URL, expect.any(Function)))
  })

  it('plays the URL directly when the browser supports the file', async () => {
    const dispose = vi.fn()
    preparePlayback.mockResolvedValue({ kind: 'native', dispose })
    render(<MediaPreview url={URL} filename="movie.mkv" previewType="video" />)

    const player = await screen.findByTestId('media-player')
    expect(player.dataset.srcKind).toBe('url')
    expect(screen.getByTestId('source').getAttribute('src')).toBe(URL)
    expect(dispose).toHaveBeenCalled()
  })

  it('feeds the Media Source stream to the player and attaches it to the <video>', async () => {
    const attach = vi.fn()
    const dispose = vi.fn()
    const mediaSource = {}
    preparePlayback.mockResolvedValue({ kind: 'mse', stream: { mediaSource, attach } as never, dispose })
    const { unmount } = render(<MediaPreview url={URL} filename="movie.mkv" previewType="video" />)

    const player = await screen.findByTestId('media-player')
    expect(player.dataset.srcKind).toBe('object')
    expect(attach).toHaveBeenCalledWith(screen.getByTestId('video'))
    expect(dispose).not.toHaveBeenCalled()

    unmount()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it.each([
    ['container', 'preview.videoUnsupportedContainer'],
    ['video-codec', 'preview.videoUnsupportedVideoCodec'],
    ['audio-codec', 'preview.videoUnsupportedAudioCodec'],
  ] as const)('explains a %s rejection and offers external players', async (reason, message) => {
    preparePlayback.mockResolvedValue({ kind: 'unsupported', reason, dispose: vi.fn() })
    render(<MediaPreview url={URL} filename="movie.avi" previewType="video" />)

    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.getByText('preview.openWith')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'preview.download' }).getAttribute('href')).toBe(URL)
    expect(screen.queryByTestId('media-player')).toBeNull()
  })

  it('reports playback failure when the stream errors mid-play', async () => {
    let reportError: (error: unknown) => void = () => {}
    vi.spyOn(console, 'error').mockImplementation(() => {})
    preparePlayback.mockImplementation(async (_url, onError) => {
      reportError = onError
      return { kind: 'mse', stream: { mediaSource: {}, attach: vi.fn() } as never, dispose: vi.fn() }
    })
    render(<MediaPreview url={URL} filename="movie.mkv" previewType="video" />)
    await screen.findByTestId('media-player')

    reportError(new Error('decode failed'))
    expect(await screen.findByText('preview.videoUnsupported')).toBeTruthy()
  })

  it('hands the video and its sidecar subtitles to the player', async () => {
    preparePlayback.mockResolvedValue({ kind: 'native', dispose: vi.fn() })
    const subtitles = [{ name: 'movie.chs.srt', url: 'https://s3.example.com/movie.chs.srt' }]
    render(<MediaPreview url={URL} filename="movie.mkv" previewType="video" subtitles={subtitles} />)

    const tracks = await screen.findByTestId('subtitle-tracks')
    expect(tracks.dataset).toMatchObject({ url: URL, name: 'movie.mkv', count: '1' })
  })

  it('lets the browser try when the probe itself fails (e.g. storage refuses range reads)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    preparePlayback.mockRejectedValue(new Error('CORS'))
    render(<MediaPreview url={URL} filename="movie.mp4" previewType="video" />)

    expect((await screen.findByTestId('media-player')).dataset.srcKind).toBe('url')
  })

  it('falls back when the native <source> fails even though the media element reports no error', async () => {
    preparePlayback.mockResolvedValue({ kind: 'native', dispose: vi.fn() })
    render(<MediaPreview url={URL} filename="movie.mp4" previewType="video" />)

    fireEvent.error(await screen.findByTestId('source'))
    expect(screen.getByText('preview.videoUnsupported')).toBeTruthy()
  })

  it('disposes a stream that resolves after the preview closed', async () => {
    let resolve: (value: PreparedPlayback) => void = () => {}
    preparePlayback.mockReturnValue(new Promise((r) => (resolve = r)))
    const { unmount } = render(<MediaPreview url={URL} filename="movie.mkv" previewType="video" />)
    unmount()

    const dispose = vi.fn()
    resolve({ kind: 'mse', stream: { mediaSource: {}, attach: vi.fn() } as never, dispose })
    await waitFor(() => expect(dispose).toHaveBeenCalledOnce())
  })
})

describe('MediaPreview audio', () => {
  it('plays audio directly without probing', () => {
    render(<MediaPreview url={URL} filename="song.mp3" previewType="audio" />)
    expect(screen.getByTestId('media-player')).toBeTruthy()
    expect(screen.queryByTestId('subtitle-tracks')).toBeNull()
    expect(preparePlayback).not.toHaveBeenCalled()
    expect(screen.queryByText('preview.openWith')).toBeNull()
  })

  it('falls back when the media element itself errors', () => {
    render(<MediaPreview url={URL} filename="song.wma" previewType="audio" />)
    fireEvent.error(screen.getByTestId('video'))
    expect(screen.getByText('preview.audioUnsupported')).toBeTruthy()
  })
})
