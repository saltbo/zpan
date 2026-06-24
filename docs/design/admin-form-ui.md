# Admin Form UI

This document defines the UI rules for admin create/edit/configuration forms.

## Surface

- Admin create/edit/configuration forms must live in `AdminFormDrawer`, a dialog, or a dedicated secondary page.
- Do not place management forms directly in primary list/detail page content.
- Drawer actions belong in the drawer footer. Use one horizontal row: secondary action first, primary submit last.
- Do not auto-focus the first input when it creates visual noise. Use `onOpenAutoFocus={(event) => event.preventDefault()}` for configuration drawers where immediate typing is not the primary action.

## Layout

- Use `AdminFormDrawer` for admin drawers.
- Use `bodyClassName="grid auto-rows-min content-start gap-4"` for ordinary vertical forms.
- Use `auto-rows-min content-start` whenever the body uses CSS grid; otherwise grid rows can stretch and create large empty gaps.
- Use `AdminFormField` for text, password, number, textarea, and select-like fields.
- Use `AdminFormLabel` only when a field needs custom composition, such as input suffix controls.
- Use `AdminSwitchField` for switch rows unless a form-specific compact inline layout is required.
- Keep cards out of forms unless the section is a genuinely framed, repeated, or gated sub-surface.

## Field Rules

- Every input must have a label.
- Every input must have a placeholder. Use concise examples, not instructions.
- Required fields must use `required` on `AdminFormField` or `AdminFormLabel`; this shows the required marker and sets `aria-required`.
- Long explanations belong in `help`, not always-visible body text.
- Use visible `description` only when the text is needed while editing and is short enough to not dominate the field.
- Error text stays under the control via `error`.

## Density

- Default field spacing is intentionally compact but readable:
  - Field internal spacing: `AdminFormField` default.
  - Form item spacing: drawer body `gap-4`.
- Do not use viewport-sized spacing, stretched grid rows, or large section padding in forms.
- Do not over-compress form items below `gap-3` unless the form is a dense table-like editor.

## Switches

- Switches should not appear as oversized cards.
- If a switch enables dependent fields, keep those fields visible and disabled when off unless hiding them materially improves comprehension.
- Put plan badges, such as `ProBadge`, next to the field label.
- Put explanatory text behind `help` unless it is a gate notice or required state message.

## Input Suffixes

- For numeric value + unit controls, prefer a single composed control that visually reads as one input with a suffix selector.
- Do not show a separate preview when it duplicates the selected value and unit.
- Keep disabled suffix controls visually disabled as one group.

## Localization

- Labels, placeholders, help text, descriptions, errors, and success messages must use i18n keys.
- New `admin.storages.*` keys must be added to the corresponding locale test.
