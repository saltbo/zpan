export function isCredentialLoginMethod(method: string | null): boolean {
  return method === 'email' || method === 'username'
}
