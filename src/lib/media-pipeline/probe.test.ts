import { describe, expect, it, vi } from 'vitest'

vi.mock('mediabunny', () => {
  class UnsupportedInputFormatError extends Error {}
  class UrlSource {
    constructor(readonly url: string) {}
  }
  class Input {
    constructor(readonly options: { source: UrlSource; formats: unknown }) {}
  }
  return { ALL_FORMATS: ['mkv', 'mp4'], Input, UnsupportedInputFormatError, UrlSource }
})

const { UnsupportedInputFormatError } = await import('mediabunny')
const { openMediaInput, readMediaFacts } = await import('./probe')

function fakeTrack(id: number, codec: string | null, codecString: string | null, isDefault: boolean) {
  return {
    id,
    getCodec: async () => codec,
    getCodecParameterString: async () => codecString,
    getDisposition: async () => ({ default: isDefault }),
  }
}

describe('openMediaInput', () => {
  it('reads the URL through range requests with every supported container', () => {
    const input = openMediaInput('https://s3.example.com/movie.mkv') as unknown as {
      options: { source: { url: string }; formats: unknown }
    }
    expect(input.options.source.url).toBe('https://s3.example.com/movie.mkv')
    expect(input.options.formats).toEqual(['mkv', 'mp4'])
  })
})

describe('readMediaFacts', () => {
  it('collects the container, primary video and every audio track', async () => {
    const input = {
      getFormat: async () => ({ mimeType: 'video/x-matroska' }),
      getPrimaryVideoTrack: async () => fakeTrack(1, 'avc', 'avc1.64001f', true),
      getAudioTracks: async () => [fakeTrack(2, 'ac3', 'ac-3', true), fakeTrack(3, 'aac', 'mp4a.40.2', false)],
    }
    await expect(readMediaFacts(input as never)).resolves.toEqual({
      containerMime: 'video/x-matroska',
      video: { id: 1, codec: 'avc', codecString: 'avc1.64001f', isDefault: true },
      audio: [
        { id: 2, codec: 'ac3', codecString: 'ac-3', isDefault: true },
        { id: 3, codec: 'aac', codecString: 'mp4a.40.2', isDefault: false },
      ],
    })
  })

  it('reports a missing video track as null', async () => {
    const input = {
      getFormat: async () => ({ mimeType: 'audio/mp4' }),
      getPrimaryVideoTrack: async () => null,
      getAudioTracks: async () => [],
    }
    await expect(readMediaFacts(input as never)).resolves.toMatchObject({ video: null, audio: [] })
  })

  it('returns null for containers Mediabunny cannot demux', async () => {
    const input = {
      getFormat: async () => {
        throw new UnsupportedInputFormatError('avi')
      },
    }
    await expect(readMediaFacts(input as never)).resolves.toBeNull()
  })

  it('propagates other read failures', async () => {
    const input = {
      getFormat: async () => {
        throw new TypeError('Failed to fetch')
      },
    }
    await expect(readMediaFacts(input as never)).rejects.toThrow('Failed to fetch')
  })
})
