export interface SystemOption {
  key: string
  value: string
}

export interface SystemOptionsRepo {
  get(key: string): Promise<SystemOption | null>
  getValue(key: string): Promise<string | null>
  getMany(keys: string[]): Promise<SystemOption[]>
  listByPrefix(prefix: string): Promise<SystemOption[]>
  set(key: string, value: string): Promise<void>
  setMany(entries: SystemOption[]): Promise<void>
  delete(key: string): Promise<void>
}
