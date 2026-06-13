export interface TeamSummary {
  id: string
  name: string
  slug: string
  logo: string | null
  memberCount: number
  ownerName: string | null
  quotaUsed: number
  quotaTotal: number
  createdAt: number
}

export interface TeamRepo {
  listTeams(): Promise<TeamSummary[]>
  getTeam(orgId: string): Promise<TeamSummary | null>
  setLogo(orgId: string, logo: string | null): Promise<void>
}
