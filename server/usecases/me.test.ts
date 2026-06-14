import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Platform } from '../platform/interface'
import { type AvatarDeps, removeAvatar, updateAvatar } from './me'
import type { ImageUpload, ImageUploadResult, ProfileRepo } from './ports'

const AVATAR_PREFIX = '_system/avatars'

// platform is an opaque request-bound capability here — the usecase only
// forwards it to the gateway, so a sentinel is enough to assert pass-through.
const platform = { tag: 'platform' } as unknown as Platform

const sampleFile = new File([new Uint8Array(8)], 'a.png', { type: 'image/png' })

function makeDeps(image: Partial<ImageUpload> = {}) {
  const setAvatar = vi.fn(async () => {})
  const uploadPublicImage = vi.fn(async (): Promise<ImageUploadResult> => ({ ok: true, url: 'https://cdn/a.png' }))
  const deletePublicImageVariants = vi.fn(async () => {})
  const deps: AvatarDeps = {
    imageUpload: { uploadPublicImage, deletePublicImageVariants, ...image } as ImageUpload,
    profiles: { setAvatar } as unknown as ProfileRepo,
  }
  return { deps, setAvatar, uploadPublicImage, deletePublicImageVariants }
}

beforeEach(() => vi.clearAllMocks())

describe('me usecase', () => {
  describe('updateAvatar', () => {
    it('uploads, persists the url via setAvatar, and returns it', async () => {
      const uploadPublicImage = vi.fn(
        async (): Promise<ImageUploadResult> => ({ ok: true, url: 'https://cdn/_system/avatars/u1.png' }),
      )
      const { deps, setAvatar } = makeDeps({ uploadPublicImage })

      const out = await updateAvatar(deps, { platform, userId: 'u1', file: sampleFile })

      expect(out).toEqual({ ok: true, url: 'https://cdn/_system/avatars/u1.png' })
      expect(uploadPublicImage).toHaveBeenCalledWith(platform, AVATAR_PREFIX, 'u1', sampleFile)
      expect(setAvatar).toHaveBeenCalledWith('u1', 'https://cdn/_system/avatars/u1.png')
    })

    // The gateway owns which status a rejection carries (400 bad mime, 413 too
    // large, 503 no public storage); the usecase surfaces it verbatim.
    it.each([
      { ok: false, status: 400, error: 'unsupported mime' },
      { ok: false, status: 413, error: 'too large' },
      { ok: false, status: 503, error: 'no public storage' },
    ] satisfies ImageUploadResult[])('surfaces gateway failure ($status) and does not persist', async (failure) => {
      const uploadPublicImage = vi.fn(async (): Promise<ImageUploadResult> => failure)
      const { deps, setAvatar } = makeDeps({ uploadPublicImage })

      const out = await updateAvatar(deps, { platform, userId: 'u1', file: sampleFile })

      expect(out).toEqual(failure)
      expect(setAvatar).not.toHaveBeenCalled()
    })
  })

  describe('removeAvatar', () => {
    it('clears the avatar in DB first, then best-effort removes storage variants', async () => {
      const calls: string[] = []
      const setAvatar = vi.fn(async () => {
        calls.push('setAvatar')
      })
      const deletePublicImageVariants = vi.fn(async () => {
        calls.push('deleteVariants')
      })
      const { deps } = makeDeps({ deletePublicImageVariants })
      deps.profiles = { setAvatar } as unknown as ProfileRepo

      await removeAvatar(deps, { platform, userId: 'u1' })

      expect(setAvatar).toHaveBeenCalledWith('u1', null)
      expect(deletePublicImageVariants).toHaveBeenCalledWith(platform, AVATAR_PREFIX, 'u1')
      expect(calls).toEqual(['setAvatar', 'deleteVariants'])
    })
  })
})
