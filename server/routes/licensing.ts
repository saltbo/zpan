import { Hono } from 'hono'
import type { BindingState } from '../../shared/types'
import { loadBindingState } from '../licensing/has-feature'
import type { Env } from '../middleware/platform'

const app = new Hono<Env>().get('/status', async (c) => {
  const db = c.get('platform').db
  const state = await loadBindingState(db)
  return c.json(state satisfies BindingState)
})

export default app
