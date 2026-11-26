# ZPan UX rules

These are the interaction rules every ZPan page follows. They hold the choices that
are ZPan's own; general good practice, such as visible labels, focus rings, and
contrast, is assumed and not repeated. Visual values are in [DESIGN.md](DESIGN.md),
and what each feature does is in [spec/](spec/). A change that follows this file
needs no one's approval; a change to a rule here is Saltbo's call.

## Surfaces

Where a task opens depends on what the user is doing, so the same kind of task
looks the same everywhere.

- **Admin create, edit, and configuration forms open in `AdminFormDrawer`**, a
  right-side drawer. Admin pages stay for browsing and operating, and a long
  configuration form needs the height a dialog does not give.
- **Short create and edit tasks in the user area open in a centred dialog**, such as
  creating a team, an API key, a folder, or an invite, and renaming.
- **Settings that belong to the user or a team live on their own page**, in cards,
  saved per card.
- **Read-only details open in a side sheet**, such as file details, a share's
  details, and an OAuth app.
- A list and a form never share one dialog.

## Forms

- Fields stack in one column with `gap-4`. A drawer body that uses grid sets
  `auto-rows-min content-start`, or its rows stretch into empty gaps.
- Admin forms are built from `AdminFormField`, `AdminSwitchField`, and
  `AdminFormLabel`, which carry the label, required marker, help, and error wiring.
- Every field has a label and a placeholder. A placeholder is a short example, not
  an instruction. A long explanation goes behind `help`; a visible description is
  only for a line needed while typing.
- A field's error appears under the field. An error that belongs to the whole form,
  such as a failed sign-in, appears above the submit button.
- A switch that enables other fields leaves them visible and disabled while it is
  off, so the user sees what turning it on gives.
- A number with a unit is one control with a suffix selector.
- A drawer does not focus its first field on open, because its first job is
  reading the current values. A dialog whose only purpose is typing, such as a
  share password, focuses its field.
- The submit button is disabled while the form is unchanged or submitting, and
  reads as loading while it submits. Footer actions run in one row: secondary
  first, primary last.

## Lists

- **A list of unbounded length loads its next page as the user scrolls to its end**,
  with no page numbers, per
  [list pagination](docs/design/list-pagination-realtime.md). A small list with a
  hard limit loads at once.
- **Search, filter, sort, and the selected item live in the URL**, so back, reload,
  and a shared link restore the view. A display preference, such as list or grid
  view, stays in local storage.
- **Every list of user content has search; a list whose order matters to the user
  can be sorted.** Adding them to a list is ordinary work.
- **Row actions:** up to two actions sit inline as icon buttons, each with a tooltip
  and an accessible name. More go in a row menu, with the destructive one last.
  File and download rows also open the same menu on right click.
- **Bulk actions** appear in a toolbar once a row is selected, and the file manager
  answers Cmd/Ctrl+A and Delete when focus is not in a text field.

## States

- **Loading:** a list or page shows the shared loading text in its body; a
  dashboard or card that has a known shape shows a skeleton of it.
- **Empty:** a title saying what would be here, a one-line hint, and the primary
  action when there is one.
- **Failed to load:** an inline alert in the area that failed, with a retry. A route
  that cannot render at all falls back to its route error component, so no page is
  ever blank.

## Feedback

- The result of an action that leaves no lasting mark on the page goes to a toast.
  One that changes what the page shows needs no toast.
- A toast says what happened in product language. A server error is translated
  into what the user can do; its raw text is not shown.

## Destructive actions

- **Every delete, revoke, or disable that cannot be undone from the UI is
  confirmed** in a dialog that names the object ("Delete Acme?"), states the
  consequence, and puts Cancel first and the destructive button last. Moving files
  to trash is confirmed too, because a batch is easy to trigger by mistake.
- **Turning off a whole feature or deleting a team** sits in a danger zone card at
  the bottom of its settings page and asks the user to type a confirmation word.
- Replacing an image, such as an avatar or a logo, is not confirmed.

## Navigation and global controls

- **Signed in**, the user area has a sidebar with the team switcher, quota, and the
  account menu, and a header with search, transfers, the player, and
  notifications. The admin area has its own sidebar and a header with only the
  title. Pages open with a breadcrumb `PageHeader`, or `AdminPageHeader` in admin.
- **Language and theme can be changed on every page.** Signed in, they are in the
  account menu. On a page that needs no session, such as sign-in, sign-up, password
  reset, a share, or a public profile, the page offers a language menu and a theme
  toggle of its own, because a visitor decides there whether the site is usable for
  them.
- Theme offers system, light, and dark wherever it appears.

## Language

- All visible text and every accessible name, including `aria-label`, comes from
  the locale files. English and Chinese are kept complete; adding a language is
  adding its locale file and its row in `src/i18n/languages.ts`.
- A language is listed by its own name, such as 中文, so a reader who cannot read
  the current language still finds theirs.

## Small screens

- Below 768 px the sidebar becomes an off-canvas sheet.
- A table keeps its layout and hides its secondary columns; it does not turn into
  cards.
- Toolbar buttons collapse to icons, and touch targets grow to 44 px.
- File preview opens as a bottom sheet.

## Paid features

- **A feature the site's edition does not include is shown, not hidden**, so the
  user learns it exists.
- `ProBadge` sits next to the label of a gated menu item, setting, or page title.
- `UpgradeHint` replaces the gated region itself. For an admin it links to
  licensing; for anyone else it says to ask the site's administrator.
