import { z } from 'zod'
import {
  BASE62_PATTERN,
  COMPATIBLE_IMAGE_TOKEN_PATTERN,
  COMPATIBLE_SHARE_TOKEN_PATTERN,
  OPAQUE_ID_PATTERN,
  OPAQUE_TOKEN_PATTERN,
} from '../ids'

/** Strict contract for IDs assigned to newly created ZPan entities. */
export const base62IdSchema = z.string().min(1).regex(BASE62_PATTERN, 'Must contain only ASCII letters and digits')

/** Compatibility contract for locating or referencing an already-persisted entity. */
export const opaqueIdSchema = z
  .string()
  .min(1)
  .regex(OPAQUE_ID_PATTERN, 'Must contain only ASCII letters, digits, underscores, or hyphens')
export const opaqueTokenSchema = z
  .string()
  .min(1)
  .regex(OPAQUE_TOKEN_PATTERN, 'Must contain only ASCII letters, digits, underscores, or hyphens')
export const shareTokenSchema = z
  .string()
  .regex(COMPATIBLE_SHARE_TOKEN_PATTERN, 'Must be a current or historical share token')
export const imageTokenSchema = z
  .string()
  .regex(COMPATIBLE_IMAGE_TOKEN_PATTERN, 'Must be a current or historical image token')
