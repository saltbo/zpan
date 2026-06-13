export interface CfHostnameStatus {
  status: 'pending' | 'active' | 'moved' | 'deleted' | 'blocked'
  ssl_status: string
}

export class CfConflictError extends Error {}

export interface CfHostnamesProvider {
  register(hostname: string): Promise<{ id: string }>
  getStatus(id: string): Promise<CfHostnameStatus>
  delete(id: string): Promise<void>
}
