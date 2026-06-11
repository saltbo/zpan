import { AsyncLocalStorage } from 'node:async_hooks'
import type { Database, Platform } from './interface'

export const platformContext = new AsyncLocalStorage<Platform>()

export function createPlatformProxy(fallback: Platform): Platform {
  const dbProxy = new Proxy({} as unknown as Database, {
    get(_target, prop) {
      const activePlatform = platformContext.getStore() || fallback
      const activeDb = activePlatform.db
      const val = Reflect.get(activeDb, prop)
      if (typeof val === 'function') {
        if (prop === 'constructor') return val
        return val.bind(activeDb)
      }
      return val
    },
  })

  return new Proxy(fallback, {
    get(_target, prop) {
      if (prop === 'db') {
        return dbProxy
      }
      const activePlatform = platformContext.getStore() || fallback
      const val = Reflect.get(activePlatform, prop)
      if (typeof val === 'function') {
        if (prop === 'constructor') return val
        return val.bind(activePlatform)
      }
      return val
    },
  })
}

export function createDbProxy(fallback: Database): Database {
  return new Proxy(fallback, {
    get(_target, prop) {
      const activePlatform = platformContext.getStore()
      const activeDb = activePlatform ? activePlatform.db : fallback
      const val = Reflect.get(activeDb, prop)
      if (typeof val === 'function') {
        if (prop === 'constructor') return val
        return val.bind(activeDb)
      }
      return val
    },
  })
}
