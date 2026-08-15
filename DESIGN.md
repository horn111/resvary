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

**Key Characteristics:**

- Monochrome hierarchy with no decorative accent palette.
- Large editorial headings paired with measurement-oriented mono labels.
- Square controls and thin construction lines instead of rounded SaaS cards.
- Motion reserved for the settlement mark, receipt lifecycle, and direct feedback.

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

**The Measurement Rule.** Mono type belongs to information that can be operated, verified, or counted. Product claims remain in the sans family.

## Layout

The page uses one uninterrupted vertical narrative with a 1280px content ceiling. Sections are separated by single-pixel lines and generous vertical intervals. Two-column editorial compositions become one column on phones; repeated data structures use fluid grids.

The header keeps the full navigation on wide screens and exposes the same destinations through a compact menu at tablet and phone widths. Mobile controls meet a 44px touch floor, tables become stacked records, and the footer collapses to one column at the narrowest viewport.

## Elevation & Depth

The system is flat by default. Depth comes from tonal black surfaces, clipped paper, bounded canvas glow, and the sticky header backdrop. Conventional card shadows are not part of the visual language.

**The Flat Ledger Rule.** A border defines structure; a shadow appears only when it expresses light emitted by an animated particle or focused settlement node.

## Shapes

Controls and data containers are square or nearly square. Thin corner brackets identify primary navigation actions. Circles belong only to particles, progress indicators, and the central settlement node.

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

Navigation uses tracked mono labels. Wide screens show the full route set; smaller screens use a native disclosure control containing the same destinations. Header and footer landmarks have unique accessible names.

### Interactive Ledger

The demo combines explicit lifecycle actions, a polite status region, posted/reserved/available balances, and inspectable JSON records. Loading, error, success, disabled, replay, and provider-failure states use the same visual grammar.

## Do's and Don'ts

### Do:

- **Do** preserve the near-black continuous field and off-white hierarchy.
- **Do** use square controls, thin rules, and tabular numerals for balances.
- **Do** keep claims next to operational proof: code, receipts, states, or ledger records.
- **Do** stop nonessential canvas motion when its scene leaves the viewport.

### Don't:

- **Don't** add colored gradients, glass cards, rounded SaaS panels, or decorative icon grids.
- **Don't** use mono type as a costume for ordinary marketing prose.
- **Don't** hide core navigation or demo functionality on smaller screens.
- **Don't** bind interactions to visible copy; use stable semantic hooks.
