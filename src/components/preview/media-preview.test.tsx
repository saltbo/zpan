import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaPreview, mimeFromExt } from './media-preview'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@vidstack/react', () => ({
  MediaPlayer: ({
    children,
    src,
    onError,
  }: {
    children: ReactNode
    src: { src: string } | string
    onError: () => void
  }) => {
    const url = typeof src === 'string' ? src : src.src
    return (
      <div data-testid="media-player">
        {/* biome-ignore lint/a11y/useMediaCaption: test double */}
        <video data-testid="video" onError={onError}>
          <source data-testid="source" src={url} />
        </video>
        {children}
      </div>
    )
  },
  MediaProvider: () => null,
}))

vi.mock('@vidstack/react/player/layouts/default', () => ({
  DefaultAudioLayout: () => null,
  DefaultVideoLayout: () => null,
  defaultLayoutIcons: {},
}))

afterEach(cleanup)

const URL = 'https://s3.example.com/movie?X-Amz-Signature=abc'

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

describe('MediaPreview', () => {
  it('lets the browser try MKV instead of rejecting it up front', () => {
    render(<MediaPreview url={URL} filename="movie.mkv" previewType="video" />)
    expect(screen.getByTestId('media-player')).toBeTruthy()
    expect(screen.getByText('preview.openWith')).toBeTruthy()
    expect(screen.queryByText('preview.videoUnsupported')).toBeNull()
  })

  it('falls back when the <source> fails even though the media element reports no error', () => {
    render(<MediaPreview url={URL} filename="movie.avi" previewType="video" />)
    fireEvent.error(screen.getByTestId('source'))
    expect(screen.getByText('preview.videoUnsupported')).toBeTruthy()
    expect(screen.getByText('preview.openWith')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'preview.download' }).getAttribute('href')).toBe(URL)
  })

  it('falls back when the media element itself errors', () => {
    render(<MediaPreview url={URL} filename="song.wma" previewType="audio" />)
    fireEvent.error(screen.getByTestId('video'))
    expect(screen.getByText('preview.audioUnsupported')).toBeTruthy()
  })

  it('does not offer external players under audio playback', () => {
    render(<MediaPreview url={URL} filename="song.mp3" previewType="audio" />)
    expect(screen.queryByText('preview.openWith')).toBeNull()
  })
})
