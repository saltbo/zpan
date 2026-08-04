import { z } from 'zod'
import { BASE62_PATTERN } from '../ids'

export const opaqueIdSchema = z.string().min(1).regex(BASE62_PATTERN, 'Must contain only ASCII letters and digits')
export const opaqueTokenSchema = z.string().min(1).regex(BASE62_PATTERN, 'Must contain only ASCII letters and digits')
