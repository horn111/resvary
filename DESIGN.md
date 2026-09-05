---
name: Resvary
description: Monochrome technical editorial system for prepaid AI credit infrastructure.
colors:
  canvas: '#0a0a0a'
  code-surface: '#0c0c0c'
  surface-raised: '#0e0e0e'
  ink: '#f2f2f0'
  ink-strong: '#dededb'
  ink-body: '#b8b8b5'
  ink-muted: '#9b9b98'
  ink-subtle: '#868684'
  line-strong: 'rgb(242 242 240 / 22%)'
  line: 'rgb(242 242 240 / 14%)'
  line-soft: 'rgb(242 242 240 / 8%)'
typography:
  display:
    fontFamily: 'Archivo, Helvetica Neue, Helvetica, Arial, sans-serif'
    fontSize: 'clamp(2.45rem, 4.9vw, 4.625rem)'
    fontWeight: 500
    lineHeight: 0.98
    letterSpacing: '-0.038em'
  body:
    fontFamily: 'Archivo, Helvetica Neue, Helvetica, Arial, sans-serif'
    fontSize: '1.03125rem'
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: 'JetBrains Mono, monospace'
    fontSize: '0.6875rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: '0.12em'
  operator-micro:
    fontFamily: 'JetBrains Mono, monospace'
    fontSize: '9px'
    fontWeight: 400
  operator-caption:
    fontFamily: 'JetBrains Mono, monospace'
    fontSize: '10px'
    fontWeight: 400
  operator-label:
    fontFamily: 'JetBrains Mono, monospace'
    fontSize: '11px'
    fontWeight: 500
    letterSpacing: '0.04em'
  operator-body:
    fontFamily: 'JetBrains Mono, monospace'
    fontSize: '12px'
    fontWeight: 400
  operator-data:
    fontFamily: 'JetBrains Mono, monospace'
    fontSize: '14px'
    fontWeight: 400
  operator-brand:
    fontFamily: 'Syncopate, sans-serif'
    fontSize: '20px'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '0.16em'
  operator-metric:
    fontFamily: 'Rubik, sans-serif'
    fontSize: '24px'
    fontWeight: 400
    lineHeight: 1
  operator-section:
    fontFamily: 'Rubik, sans-serif'
    fontSize: 'clamp(32px, 4vw, 58px)'
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: '-0.04em'
  operator-auth:
    fontFamily: 'Rubik, sans-serif'
    fontSize: '42px'
    fontWeight: 400
    letterSpacing: '-0.03em'
components:
  button-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.canvas}'
    typography: '{typography.label}'
    padding: '14px 22px'
  button-secondary:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-strong}'
    typography: '{typography.label}'
    padding: '14px 22px'
---

# Design System: Resvary

## Overview

**Creative North Star: "The Settlement Instrument"**

Resvary looks like a precise instrument for inspecting credit movement, not a generic finance dashboard. The system uses a near-black field, restrained off-white hierarchy, square construction lines, and technical mono labels. Large editorial typography explains the product while receipts, code, balances, and lifecycle states provide operational proof.

The hero mark, receipt printer, and particle word are the authored moments. The hero mark is a pair of clean settlement rails: they illuminate on direct hover while the bright settlement node follows the pointer inside their bounded corridor. The footer word preserves each glyph's local dot grid so repeated letters remain identical and counters stay legible. Everything around them stays flat, quiet, and inspectable so motion and bright ink retain meaning.

The Operator Console extends this world into a high-density command ledger. A fixed project rail, situation strip, chronological activity field, evidence dossier, and guarded operations share the same monochrome hierarchy and construction-line logic. It is an operational expression of the landing-page system, not a replacement identity.

**Key Characteristics:**

- Monochrome hierarchy with no decorative accent palette.
- Large editorial headings paired with measurement-oriented mono labels.
- Square controls and thin construction lines instead of rounded SaaS cards.
- Dense command-ledger layouts keep scope, provenance, consequence, and next action visible.
- Motion reserved for the settlement mark, receipt lifecycle, ledger arrival, and direct feedback.

## Colors

The palette is deliberately monochrome. Hierarchy comes from stable ink roles and line density rather than hue.

### Primary

- **Ledger Ink** (`ink`): primary headings, active controls, focus rings, and the brightest particles.

### Neutral

- **Settlement Black** (`canvas`): the continuous page field.
- **Code Well** (`code-surface`): code and machine-readable output.
- **Raised Black** (`surface-raised`): restrained hover and selected surfaces.
- **Strong, Body, Muted, and Subtle Ink**: semantic reading levels that all retain WCAG AA contrast for their intended text sizes.
- **Construction Lines** (`line-strong`, `line`, `line-soft`): controls, section boundaries, and internal data separators.

**The Monochrome Evidence Rule.** Bright ink marks action or proof. Muted ink carries context. Color is not introduced merely to decorate status.

## Typography

**Display Font:** Archivo with Helvetica fallbacks  
**Body Font:** Archivo with Helvetica fallbacks  
**Label/Mono Font:** JetBrains Mono with monospace fallback

**Character:** Archivo supplies neutral editorial authority without competing with the product mechanics. JetBrains Mono is limited to code, data, lifecycle labels, navigation, and measurements.

### Hierarchy

- **Display** (500, fluid to 74px, 0.98): hero and final conversion statement.
- **Headline** (500, fluid to 54px, approximately 1.02): section propositions.
- **Title** (500, 20–34px): capability and interactive-demo titles.
- **Body** (400, 15–17px, 1.55–1.6): explanatory copy capped near 70 characters.
- **Label** (400, 10.5–12px, tracked uppercase): navigation, state, metadata, and data headings.

The Operator Console adds Syncopate for the 20px project wordmark and Rubik for 19–24px situation metrics, 32–58px section titles, and the 42px authentication title. JetBrains Mono carries the dense operational ramp: 9px micro metadata, 10px captions and column labels, 11px command headings, 12px interface copy, and 14px ledger rows. The smaller steps are reserved for short machine-readable values and never carry explanatory prose.

**The Measurement Rule.** Mono type belongs to information that can be operated, verified, or counted. Product claims remain in the sans family.

**The Evidence Density Rule.** Reduce size before reducing context: identifiers, timestamps, state, and units remain present, with contrast and line length calibrated to their role.

## Layout

The page uses one uninterrupted vertical narrative with a 1280px content ceiling. Sections are separated by single-pixel lines and generous vertical intervals. Two-column editorial compositions become one column on phones; repeated data structures use fluid grids.

The header keeps the full navigation on wide screens and exposes the same destinations through a compact menu at tablet and phone widths. Mobile controls meet a 44px touch floor, tables become stacked records, and the footer collapses to one column at the narrowest viewport.

The Operator Console uses a 190px fixed project rail beside the workspace. Its Overview first view is a 77px situation strip above a command ledger and evidence dossier; the primary split favors the ledger while reserving at least 420px for evidence. At 1100px and below, the rail compresses to 68px, retains icon-labelled destinations, and narrows the evidence pane to 330px. At 760px and below, the rail becomes a sticky top bar, the four 44px navigation targets remain available, the situation metrics and scope metadata scroll horizontally, and the dossier follows the ledger in document order.

Only the Overview ledger transforms into stacked label/value records on phones. Its table headers remain available to assistive technology and each value repeats the header through `data-label`; selected state becomes a bounded record rather than six independently highlighted cells. General data tables retain horizontal inspection, while timelines, action forms, health bands, and page headers reflow to fewer columns.

**The Responsive Evidence Rule.** Compact layouts may change geometry, never the accessible name, record identity, scope, units, or evidence order.

## Elevation & Depth

The system is flat by default. Depth comes from tonal black surfaces, clipped paper, bounded canvas glow, and the sticky header backdrop. Conventional card shadows are not part of the visual language.

**The Flat Ledger Rule.** A border defines structure; a shadow appears only when it expresses light emitted by an animated particle or focused settlement node.

## Shapes

Controls and data containers are square or nearly square. Thin corner brackets identify primary navigation actions. In the console, status marks, evidence steps, and the synthetic/live dataset badge are also square. Circles belong only to particles, progress indicators, and the central settlement node.

## Components

### Buttons

- **Primary:** Ledger Ink fill, Settlement Black label, square silhouette, 14px × 22px internal padding.
- **Secondary:** transparent field with a strong construction line and Strong Ink label.
- **Operational:** compact demo controls use 12px × 16px padding while preserving the 44px touch floor.
- **Hover / Focus:** bounded ink shift and a one-pixel external focus outline; no lift or rounded pill treatment.
- **Disabled:** Subtle Ink plus reduced opacity, with the action remaining legible.

### Cards / Containers

- **Corner Style:** square.
- **Background:** Settlement Black or Code Well.
- **Shadow Strategy:** none at rest.
- **Border:** a single semantic construction line.
- **Internal Padding:** 16–30px according to information density.

### Navigation

Landing-page navigation uses tracked mono labels. Wide screens show the full route set; smaller screens use a native disclosure control containing the same destinations. Header and footer landmarks have unique accessible names.

Operator navigation uses a labelled primary landmark and four persistent destinations. The 190px rail shows icon and text; the 68px compact rail and 760px sticky top bar hide the visible text but preserve each link's `aria-label`, active link `aria-current="page"`, visible focus outline, and 44px mobile target.

### Command Ledger

The Overview is a ledger-first shell rather than a metric-card dashboard. A five-cell situation strip reports available, reserved, charged, overdue, and dead-letter totals. The command ledger owns the largest field, the selected row uses Raised Black plus strong top and bottom rules, and the evidence dossier follows receipt, reservation, price version, and ledger entries in numbered order. Status always includes a text label and a square marker, so hue is never the only signal.

Rows arrive with a 520ms `cubic-bezier(0.16, 1, 0.3, 1)` opacity, five-pixel translation, and blur settle, staggered by 22ms. Chart bars use the same easing over 500ms. Under `prefers-reduced-motion: reduce`, animation and transition durations collapse to 0.01ms and scroll behavior returns to auto.

**The Ledger Arrival Rule.** Motion may reveal chronology once; it must not delay reading, reorder evidence, or survive a reduced-motion preference.

### Scope Metadata

The ledger toolbar states events, statuses, customers, and window as compact term/value pairs before the refresh action. On compact screens, scope metadata scrolls as a row instead of disappearing; only the customer item is omitted at the 1100px intermediate layout where the project-level context is already established by the rail.

### Evidence Records

Evidence cards use one construction-line border, a compact header, tabular values, and a numbered square connected by a one-pixel rule. Original JSON sits behind a native disclosure with a bounded scroll region. On phones the dossier moves below the trend without changing the evidence sequence.

### Interactive Ledger

The demo combines explicit lifecycle actions, a polite status region, posted/reserved/available balances, and inspectable JSON records. Loading, error, success, disabled, replay, and provider-failure states use the same visual grammar.

## Do's and Don'ts

### Do:

- **Do** preserve the near-black continuous field and off-white hierarchy.
- **Do** use square controls, thin rules, and tabular numerals for balances.
- **Do** keep claims next to operational proof: code, receipts, states, or ledger records.
- **Do** stop nonessential canvas motion when its scene leaves the viewport.
- **Do** preserve scope labels, units, timestamps, and record identifiers when data stacks on mobile.
- **Do** keep compact navigation keyboard-visible and explicitly named when its text label is visually hidden.
- **Do** honor reduced-motion preferences for ledger arrival and chart transitions.

### Don't:

- **Don't** add colored gradients, glass cards, rounded SaaS panels, or decorative icon grids.
- **Don't** use mono type as a costume for ordinary marketing prose.
- **Don't** hide core navigation or demo functionality on smaller screens.
- **Don't** bind interactions to visible copy; use stable semantic hooks.
- **Don't** use color alone to distinguish ledger status, selection, or recovery state.
- **Don't** collapse dense records into unlabeled values or reorder their evidence chain on mobile.
