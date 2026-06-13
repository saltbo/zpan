// Read-only membership counts used by team-limit enforcement. Kept separate
// from the authz OrgRepo because it answers a quota question (how many orgs a
// user belongs to), not an access-control one.
export interface MemberCountRepo {
  countUserOrgs(userId: string): Promise<number>
}
