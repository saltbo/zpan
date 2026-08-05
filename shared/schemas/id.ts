import { z } from 'zod'
import { BASE62_PATTERN, IMAGE_TOKEN_PATTERN, SHARE_TOKEN_PATTERN } from '../ids'

export const opaqueIdSchema = z.string().min(1).regex(BASE62_PATTERN, 'Must contain only ASCII letters and digits')
export const opaqueTokenSchema = z.string().min(1).regex(BASE62_PATTERN, 'Must contain only ASCII letters and digits')
export const shareTokenSchema = z.string().regex(SHARE_TOKEN_PATTERN, 'Must be s followed by 11 Base62 characters')
export const imageTokenSchema = z.string().regex(IMAGE_TOKEN_PATTERN, 'Must be i followed by 11 Base62 characters')
