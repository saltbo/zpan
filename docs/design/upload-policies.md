# Upload Placement Policies — Proposal

> Status: Proposed (2026-07-23)
> Implementation: Deferred
> Proposed release: v2.8
> Product surface: Admin → Storages → Upload Policies

## 1. Problem

When multiple storage backends are configured, ZPan currently selects the oldest
active backend that has not reached its configured capacity. This behavior is
implicit and instance-wide. Administrators cannot give a space different storage
placement behavior, route images separately from other files, or choose between
ordered failover and balanced distribution.

Upload placement should be an independent product concept:

- A storage backend describes connection details, health, and capacity.
- An upload policy describes which uploads it applies to and which storage
  backends those uploads may use.
- Existing files remain attached to their recorded `storageId`; policies affect
  only newly created physical objects.

## 2. Product placement

Upload policies belong under the existing **Storages** administration area.
The page becomes two sibling surfaces:

- **Storage Backends** — connections, credentials, capacity, health, and usage.
- **Upload Policies** — selectors, eligible storage backends, and placement mode.

The admin sidebar keeps one **Storages** entry. Upload policies do not become a
new top-level navigation item, and policy configuration does not live inside an
individual storage form.

The proposal is intended for v2.8 alongside admin analytics, expanding the
release theme from analytics alone to admin operations and analytics.

## 3. Policy model

Upload policies are stored in one `upload_policies` table. Selectors and storage
IDs are JSON columns on the policy row. There are no policy-to-storage,
policy-to-space, or policy-to-group association tables.

Conceptual shape:

```ts
interface UploadPolicy {
  id: string
  name: string
  enabled: boolean
  priority: number
  selector: UploadSelector
  storageIds: string[]
  selectionMode: 'ordered' | 'balanced'
  createdAt: Date
  updatedAt: Date
}
```

`storageIds` is ordered. In `ordered` mode it defines the failover order; in
`balanced` mode it is the stable tie-break order.

### Default policy

The system always has one default policy:

- Fixed ID: `default`
- Selector: `{}`
- Priority: `0`
- Cannot be disabled or deleted

The empty selector matches every upload, so the default policy is the natural
fallback when no higher-priority policy matches.

On upgrade, existing storage backends are added to the default policy in
`createdAt` order and the mode is `ordered`. This preserves current placement
behavior. When creating a new storage backend, the admin form offers **Add to
default upload policy**, enabled by default.

### Edition boundary

- **Community** can view and edit the default policy's storage list and
  selection mode. It cannot change the default selector or create another
  policy.
- **Pro / Business** can create, edit, enable, disable, and delete custom
  selector-based policies.

The server enforces this boundary; hiding controls in the UI is not sufficient.

## 4. Selector

The selector follows the Kubernetes `LabelSelector` shape:

```ts
interface UploadSelector {
  matchLabels?: Record<string, string>
  matchExpressions?: Array<{
    key: string
    operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist'
    values?: string[]
  }>
}
```

All `matchLabels` and `matchExpressions` conditions are combined with AND.
Values inside an `In` expression are combined with OR.

The initial upload context exposes:

| Label | Example |
|-------|---------|
| `space.id` | `org_acme` |
| `space.type` | `personal`, `team` |
| `file.category` | `image`, `video`, `audio`, `document`, `archive`, `other` |
| `file.mime` | `image/png` |
| `file.extension` | `png` |
| `upload.source` | `web`, `webdav`, `image-host`, `download-task`, `archive`, `copy`, `transfer` |

Extensions are normalized to lowercase without a leading dot. File categories
reuse ZPan's shared classification rather than introducing a policy-specific
classification.

New targeting dimensions are added as labels, not as new policy columns.

Example policies:

```json
{
  "name": "Acme storage",
  "priority": 100,
  "selector": {
    "matchLabels": {
      "space.id": "org_acme"
    }
  },
  "storageIds": ["acme-primary", "acme-backup"],
  "selectionMode": "ordered"
}
```

```json
{
  "name": "Team images",
  "priority": 50,
  "selector": {
    "matchLabels": {
      "space.type": "team",
      "file.category": "image"
    }
  },
  "storageIds": ["r2-images-a", "r2-images-b"],
  "selectionMode": "balanced"
}
```

## 5. Policy resolution

For every operation that creates a new physical object, ZPan:

1. Builds labels from the target space, file metadata, and upload source.
2. Finds all enabled policies whose selector matches.
3. Sorts matches by `priority DESC`, then policy ID for a stable tie-break.
4. Uses the first matching policy.
5. Selects a storage from that policy's `storageIds`.

The default policy matches when no more specific policy wins.

Once a custom policy wins, failure to find usable storage within that policy
fails the upload. ZPan must not silently escape to the default policy because
that could violate an administrator's data-placement intent. Administrators
configure fallback by including additional storage IDs in the selected policy.

Policy changes affect new upload sessions only. An active session retains its
selected policy and storage, and existing objects retain their `storageId`.

## 6. Storage selection

Before selection, ZPan excludes storage backends that are disabled, unhealthy,
or unable to hold the complete file.

### Ordered

Choose the first eligible storage in `storageIds`. Later entries are fallbacks
when earlier entries are disabled, unhealthy, or lack capacity.

### Balanced

Choose the eligible storage with the lowest projected utilization after
reserving the current file:

```text
projected utilization =
  (used bytes + reserved bytes + current file size) / configured capacity
```

Ties follow the order in `storageIds`. Every storage in a balanced policy must
have a non-zero configured capacity; otherwise the policy cannot be saved.

## 7. Capacity reservation

Policy-based placement must not retain the current race where concurrent
uploads can all select a nearly full backend.

When a file draft is created, ZPan atomically reserves its declared size on the
selected storage. If another upload consumes the remaining capacity first, the
selection is retried against the policy's other eligible storage backends.

The upload session records the selected policy, storage, and reserved bytes.

- Completion converts reserved bytes to used bytes using the actual size
  returned by S3 `HEAD`.
- A larger actual size must reserve the difference before activation.
- Cancellation, failed preparation, and expired sessions release the
  reservation exactly once.
- A session that cannot reserve an actual-size increase is cleaned up and
  fails rather than exceeding the configured capacity.

## 8. Admin experience

The Upload Policies page is a browse-first list showing:

- Name and default status
- Enabled state
- Selector summary
- Priority
- Ordered storage list
- Selection mode

Create and edit forms live in an `AdminFormDrawer`. The form contains:

1. Name, enabled state, and priority.
2. A visual selector builder for label, operator, and values.
3. Storage multi-selection with ordering.
4. Ordered or balanced selection mode.

The UI does not require administrators to edit raw JSON. It may show the
generated selector as a read-only advanced preview.

The Storage Backends page shows which policies reference a backend. A referenced
backend cannot be deleted until it is removed from those policies, and the
error identifies the referencing policies.

## 9. API and integrity boundaries

Policy management uses an admin-only Hono RPC resource under
`/api/site/upload-policies`.

Ordinary object creation must not accept a client-selected `storageId`, because
that would bypass policy resolution. Storage connection testing uses a
dedicated admin endpoint that explicitly targets one backend and does not
participate in normal placement.

Selector keys and operators are allowlisted and validated. Referenced storage
IDs must exist when a policy is saved. Because the references are stored in
JSON, deletion checks and reference integrity are enforced by the application
service rather than database foreign keys.

## 10. Non-goals

This proposal does not add:

- Storage pools or policy association tables
- User-group-specific columns
- Replication or multiple copies of one object
- Automatic migration or rebalancing of existing files
- Geographic routing
- Custom numeric selector operators
- User-facing physical storage selection

