# Spaces, Quota Ownership, and Sharing — Design

> Status: Accepted (2026-06-11)
> Scope: personal/team spaces, quota purchasing & allocation, cross-space transfer, sharing & permissions

This document records the design decisions for how storage spaces (personal and team
organizations) own data and quota, how team storage gets paid for, how files move between
spaces, and where the sharing model deliberately stops. It also records the alternatives
that were considered and **rejected**, with rationale — so future discussions don't restart
from zero.

## 1. Core principle

**A space owns its data, holds its own quota, and whoever owns the space pays for it.**

Every org (personal or team) has its own `org_quotas` row and its own entitlements
(`orgQuotaEntitlements`). Files belong to the space they live in (`matters.orgId`), not to
the uploader. Usage is charged to the space, never to the individual member who uploaded.

This single invariant resolves every downstream question:

- Capacity: each space has an independent pool; no cross-space accounting.
- Continuity: team files survive member departure because the team — not a member — owns them.
- Billing: the bill follows the asset. Team assets are never carried on a member's personal wallet.

Everything below is a consequence of this principle.

## 2. Quota: who pays for what

Three funding paths, one mechanism (`orgQuotaEntitlements`):

| Scenario | Path | Status |
|----------|------|--------|
| Company / formal team | Team owner purchases directly in team context (subscription or packs) | Works accidentally; needs hardening (§2.1) |
| Individual / family / informal group | Owner buys packs to personal space, then **allocates** them to a team they own | New capability (§2.2) |
| Self-hosted free usage | Instance admin grants entitlements directly | Backend exists; needs admin UI (§2.3) |

### 2.1 Team purchases: owner-responsibility model

Per-workspace billing is the industry-standard model (Google Workspace, Dropbox Business,
Notion, Microsoft 365): when a team owns data, the team pays, represented by its owner.
We do **not** block team purchases — the checkout chain already delivers entitlements to
the active org correctly (`storefront.ts` → cloud order `target.orgId` → webhook →
entitlement on that org). We make it deliberate:

**Rule: only the team owner can purchase for, subscribe for, or open the billing portal of
a team space. Members consume; they don't spend the team's money or see its invoices.**

Hardening required (the current chain has no role/type check beyond membership):

1. Server-side: checkout, billing portal, and credits endpoints must require `owner` role
   when the target org is a team (`canAccessTargetOrg` currently only checks membership —
   any viewer can buy/subscribe/see invoices for the team). This is the only real
   security gap; fix first.
2. UX: owners see the store normally (the active-space switcher already provides context);
   non-owner members see "ask your team owner" guidance instead of buy buttons.
3. `customerLabel` sent to cloud should be the org name for team purchases (currently the
   purchaser's email), so cloud-side accounting is readable.
4. Tests: integration coverage for owner-buys-for-team (entitlement lands on team org),
   non-owner 403, and webhook delivery to a team org. None exist today.

### 2.2 Quota allocation ("划拨") — NOT BUILT (deferred)

The original idea (Google One family-sharing): buy a distributable pool once, hand parts of
it to other spaces the owner controls. An entitlement is a discrete row with an `orgId`, so
"allocation" would just reassign that row between orgs the user owns.

**This was implemented and then removed.** Two reasons converged:

1. **No valid input exists.** The model only makes sense for a *distributable pool* — i.e.
   one-time storage packs. The store only sells **per-workspace subscriptions** (the cloud
   product catalog has month/year prices for `zpan.plan`; one-time prices exist only for
   credit packs). There is no one-time storage pack to allocate, so the feature operated on
   an empty set.

2. **Subscriptions can't be safely allocated.** The webhook *increase* (renewal) path
   upserts by `(source, sourceId, resourceType)` — org-independent, so renewal would follow
   a moved entitlement. But the *decrease* (cancellation/downgrade) path matches on
   `orgId = event.targetOrgId AND source AND sourceId` (`cloud-store.ts`
   `quotaEntitlementSourceMatch`), locked to the org the subscription was bought for. Move
   the entitlement to another org and a cancellation no longer matches it — the claw-back
   silently fails and leaves ghost capacity. The base-quota fallback is org-locked the same
   way.

Crucially, allocation is also **redundant** now: a family owner who wants the team space to
have capacity just subscribes the team space directly (§2.1, team purchase works), and a
self-hosted admin grants capacity straight to the team space (§2.3). Both deliver capacity
to the team without any cross-org entitlement movement.

**Revisit only if** a one-time/distributable storage pack SKU is introduced. At that point
allocation has a clear pool semantics and these packs carry no cancellation webhook, so the
claw-back problem doesn't arise. If subscription allocation is ever wanted, the prerequisite
is making the webhook decrease/base-quota paths match by `sourceId` alone (org-independent),
which is a cloud-contract change to design carefully.

### 2.3 Admin grants (self-hosted)

The S3 bucket belongs to the instance admin; quota is the admin's governance tool against
their own storage bill. The entitlements admin API exists for users' personal orgs
(`/api/users/:id/entitlements`) but there is **no admin surface to set a specific team's
quota** (the v2.2 roadmap item "Per-team storage quota set by admin" shipped the data
model only). Required:

1. Generalize the entitlements admin API to any org (e.g. `/api/admin/teams/:id/entitlements`).
   The admin UI splits by surface to avoid duplication: personal-space quotas live on the
   user detail page, team-space quotas on a team-scoped admin Quotas page.
2. Separate defaults: add a `default_team_quota` system option; org creation picks the
   default by `metadata.type === 'team'` vs personal. Today both share `default_org_quota`.
3. Team-owner read view: team settings should show used/quota so owners know when to ask
   for (or buy) more.

### 2.4 Rejected alternatives for team quota funding

- **Charge the uploader's personal quota** — team capacity becomes the unpredictable sum
  of members' purchases; contributors are punished; "remaining team space" stops being a
  concept; member departure leaves unaccountable usage. (This is the consumer Google
  Drive shared-folder model, and is exactly why it can't serve teams.)
- **Charge the owner's personal quota** — teammates silently consume the owner's personal
  purchases; owner downgrade instantly over-quotas the team; ownership transfer requires
  moving quota between personal wallets.
- **One account-level wallet shared by all spaces** — ties team continuity to one member's
  subscription; usage on either side squeezes the other; company files end up on an
  employee's personal card.

All three break "billing follows ownership". Per-space billing is not double-charging:
the personal space and the team space are two different assets; a user funds each asset
it owns, and most members fund the team zero times.

## 3. Cross-space transfer

"Share my personal files into the family space" really means **transfer of ownership**,
not access grant. The primitive:

- **Copy to another space** — base operation. Source untouched; target space pays quota
  for its copy. Both copies are thereafter independent (no sync) — the UI must say
  "a copy will be created".
- **Move to another space** — copy + delete source. Quota effectively transfers. v1 is
  implemented as copy-then-trash, not an `orgId` mutation, so quota release/charge both
  ride existing paths and no share/trash references dangle.

Implementation notes:

- Reuse the save-to-drive engine (`server/services/save-to-drive.ts`): recursive folder
  BFS, same-storage S3 server-side copy, per-file quota reservation with rollback. The
  engine is complete; this feature is a new entry point (object copy/move APIs accepting
  `targetOrgId` + a space picker in the file manager — the org/folder picker from
  `save-to-drive-dialog.tsx` is reusable).
- Permission: read access on source + `editor`+ on target (same check as save-to-drive).
- Quota counts in **both** spaces after a copy. That is correct, not a bug — each space
  owns its copy. Future infra optimization (invisible to users): same-storage copies may
  share one S3 object via refcounting so the admin's physical bill stays single; logical
  per-space quota unchanged. Not v1 — deletion bookkeeping isn't worth it yet.

The legacy back door (share your own file → open your own share → save-to-drive into the
team) becomes unnecessary but harmless.

## 4. Sharing model

ZPan's sharing follows the **distribution paradigm** (netdisk-style: publish a snapshot
via link; receiver copies), not the **collaboration paradigm** (Google Drive: per-item
ACL + mounted "Shared with me"). This was the original simplification and it is correct:

- Google needs live references because Docs/Sheets require many people editing the *same
  object*. ZPan hosts immutable blobs with no online co-editing — for blobs, a copy is
  experientially equivalent to a reference and vastly cheaper (no sync semantics, no
  permission propagation, no dangling references).
- Per-item ACL wrecks the §1 invariant: someone writing into a folder of *my* personal
  space consumes *my* quota at their discretion; "who can see my stuff" degrades from a
  member list into a graph walk (the permission sprawl Google itself migrates enterprises
  away from, via Shared Drives).
- The need "give specific people ongoing access" already has an answer in our model:
  **create a shared space and move the files in.** Identity-based ongoing collaboration
  belongs to spaces; anonymous one-off distribution belongs to share links.

Current state (verified, complete):

| Need | Answer | Status |
|------|--------|--------|
| Send to anyone | Link share: landing/direct, password, expiry, download limit | ✅ shipped (v2.3) |
| Send to a specific registered user | Directed share (`shareRecipients`) → in-app notification (`share_received`, deep-links to `/s/:token`) + email when configured | ✅ closed loop (`server/services/share-notification.ts`, `notification-item.tsx`) |
| Keep a copy of something shared to me | Save-to-drive (physical copy, target space pays) | ✅ shipped |
| Ongoing sharing with fixed people | Shared space + cross-space copy/move | space ✅ / transfer = §3 |
| Folder-level permissions inside a team | Advanced RBAC, **team spaces only** | Future / demand-driven |
| Grant others access inside a personal space | **Will not do** — guide to creating a shared space | decision |

Decisions:

1. **No per-item ACL, ever, in personal spaces.** A personal space has exactly one human.
   The moment a second person needs standing access, that's a shared space.
2. **Future RBAC stays scoped to team spaces** (folder-level restrictions among members).
   It adds a directory dimension to the existing space-role system; it does not introduce
   a second permission system.
3. Traffic for share downloads continues to be charged to the share creator's org
   (`shares.orgId`) — the publisher pays for distribution.
4. Backlog (nice-to-have): a "Received shares" list page filtered by recipient — an
   *inbox of share links*, not a mounted filesystem. Notifications already cover the
   moment of sharing; this only improves later retrieval.

## 5. Implementation status

Shipped:

1. **Team purchase hardening** (§2.1.1) — owner-role checks on checkout/billing-portal/credits.
2. Store UX: non-owner guidance (§2.1.2), `customerLabel` = org name (§2.1.3), integration tests (§2.1.4).
3. **Cross-space copy/move** (§3) — API + file-manager actions, reusing the save-to-drive engine.
4. Admin per-team quota management (§2.3.1) + `default_team_quota` (§2.3.2).
5. **Received shares** list page (§4.4).

Not built / deferred:

- **Quota allocation** (§2.2) — built then removed; no valid input (only subscriptions are
  sold) and redundant with team purchase + admin grant. Revisit only with a one-time pack SKU.
- (Later) same-storage copy dedup via refcounting (§3); team RBAC remains future / demand-driven.
