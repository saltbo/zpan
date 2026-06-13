export interface SystemOption {
  key: string
  value: string
  public: boolean
}

export interface SystemOptionsRepo {
  list(): Promise<SystemOption[]>
  listPublic(): Promise<SystemOption[]>
  get(key: string): Promise<SystemOption | null>
  getValue(key: string): Promise<string | null>
  listByKeyLike(pattern: string): Promise<Array<{ key: string; value: string }>>
  set(key: string, value: string, isPublic: boolean): Promise<void>
  delete(key: string): Promise<void>
}
