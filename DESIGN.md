---
version: alpha
name: ZPan
description: A calm, Google-flavoured workspace for files, shares, and image hosting on the user's own S3 bucket.
colors:
  primary: "oklch(0.587 0.201 258.4)"
  on-primary: "oklch(1 0 0)"
  background: "oklch(1 0 0)"
  on-background: "oklch(0.22 0 0)"
  canvas: "oklch(0.978 0.006 247)"
  surface: "oklch(1 0 0)"
  on-surface: "oklch(0.22 0 0)"
  secondary: "oklch(0.972 0.003 247.9)"
  on-secondary: "oklch(0.28 0.015 260)"
  muted: "oklch(0.972 0.003 247.9)"
  on-muted: "oklch(0.48 0.01 258)"
  accent: "oklch(0.945 0.005 250)"
  destructive: "oklch(0.619 0.228 26.8)"
  on-destructive: "oklch(1 0 0)"
  border: "oklch(0.92 0.003 247)"
  sidebar: "oklch(0.972 0.003 247.9)"
  sidebar-accent: "oklch(0.93 0.042 256)"
  chart-teal: "oklch(0.61 0.13 185)"
  chart-violet: "oklch(0.62 0.18 292)"
  primary-dark: "oklch(0.764 0.111 254.1)"
  on-primary-dark: "oklch(0.22 0 0)"
  background-dark: "oklch(0.22 0 0)"
  on-background-dark: "oklch(0.93 0.005 250)"
  canvas-dark: "oklch(0.18 0.005 250)"
  surface-dark: "oklch(0.27 0.003 250)"
  on-muted-dark: "oklch(0.72 0.012 258)"
  destructive-dark: "oklch(0.756 0.139 28.1)"
  border-dark: "oklch(0.34 0.005 250)"
typography:
  page-title:
    fontFamily: system-ui
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
  section-title:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1
  body:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: system-ui
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    height: 36px
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.on-destructive}"
    rounded: "{rounded.md}"
    height: 36px
  input:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.md}"
    height: 36px
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: 24px
  badge-pro:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
---

# ZPan design

The tokens above are the light theme; a `-dark` suffix is the same role in the dark
theme. The source of truth for running code is the theme in
`src/styles/globals.css`, and the two carry the same values. Interaction rules are
in [UX.md](UX.md).

## Overview

ZPan looks like a quiet work tool: white cards lifted off a faintly blue-grey
canvas, one blue for everything the user can act on, and red only for what cannot
be undone. Content, not chrome, carries the colour, so file thumbnails and images
stand out.

## Colors

- **Primary** is Google Blue, and it is the only accent: primary buttons, links,
  the focus ring, the selected sidebar item, and the first chart series. A site
  admin can replace it through branding, so nothing may depend on its exact hue,
  such as text that is readable only on blue.
- **Canvas** sits behind cards and is darker than a card in both themes, so a card
  always lifts off the page.
- **Destructive** is used for irreversible actions and their confirm buttons, and
  for error text. It is never decoration.
- **Muted** text is for secondary information such as sizes, dates, and hints.
- Charts use primary, then teal, then violet, and a muted grey for "other".

## Typography

The system font stack throughout, with no web font, so the UI matches the user's
platform and loads nothing extra. Body and labels are 14 px; captions, badges, and
field errors are 12 px. Weight, not size, carries hierarchy inside a card: titles
are semibold, labels medium.

## Layout

Pages sit on the canvas with cards inside. Spacing runs on a 4 px base: 8 px
between an icon and its text, 16 px between form fields and card padding, 24 px
between cards. Forms stay compact: no viewport-sized gaps, and no gap under 12 px
except in a dense, table-like editor.

## Elevation & Depth

Depth is one step: a card has a hairline border and a small shadow over the
canvas. Popovers, menus, dialogs, and sheets are the only things above that.

## Shapes

Controls are 6 px rounded, cards 12 px. Pills, such as the Pro badge and avatars,
are fully round.

## Motion & Micro-interaction

Motion is the shadcn default: short fades and slides for dialogs, sheets, and
menus, and no motion on data. Reduced motion is honoured.

## Voice & Content Strategy

- Short, plain sentences in product language, with no technical detail: "Couldn't
  create the share" rather than a status code.
- Buttons say what they do with a verb, such as Create, Save, Delete, Revoke, and
  the same action has the same word everywhere.
- A confirm title is a question naming the object ("Delete Acme?"), and its body
  says the consequence.
- An empty state says what would be here and how to add it.

## Components

Built from shadcn/ui (new-york style, neutral base) with tokens from the theme;
installed components are adapted where they are used, never edited. ZPan's own
shared pieces are `AdminFormDrawer` and its field components, `PageHeader`,
`AdminPageHeader`, `ProBadge`, and `UpgradeHint`.

## Do's and Don'ts

- Do use theme tokens for every colour, radius, and shadow; don't write a raw
  colour value in a component.
- Do keep icons from one set, at 16 px in controls.
- Don't use the primary colour for anything the user cannot act on.
- Don't put a card inside a form unless the section is a framed, repeated, or
  gated sub-surface.
