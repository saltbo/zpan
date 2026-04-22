import { createBootstrap } from './bootstrap'
import { createNodePlatform } from './platform/node'

const platform = createNodePlatform()
export default await createBootstrap(platform)
