import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { emptyTrash } from '../usecases/trash'
import { apiError, errorResponse, jsonContent } from './openapi'

const emptyTrashRoute = createRoute({
  operationId: 'emptyTrash',
  summary: 'Empty trash',
  tags: ['Trash'],
  method: 'delete',
  path: '/',
  middleware: [requireTeamRole('editor')] as const,
  responses: {
    200: jsonContent(z.object({ purged: z.number().int() }), 'Number of objects permanently removed'),
    400: errorResponse('No active organization'),
  },
})

const app = new OpenAPIHono<Env>()
app.use(requireAuth)

const trash = app.openapi(emptyTrashRoute, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return apiError(c, 400, 'No active organization')
  const result = await emptyTrash(c.get('deps'), { orgId, userId: c.get('userId')! })
  return c.json({ purged: result.purged }, 200)
})

export default trash
