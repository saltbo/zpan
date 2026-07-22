export function createTrafficEventId(): string {
  return `traffic_${crypto.randomUUID()}`
}
