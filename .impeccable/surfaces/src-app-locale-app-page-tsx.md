---
version: 1
slug: "src-app-locale-app-page-tsx"
primary_target: "src/app/[locale]/(app)/page.tsx"
related_targets: ["src/app/[locale]/(app)/layout.tsx"]
---

# Surface brief — `/` Dashboard (and the app shell it anchors)

**Scope & mode:** Operate. The whole `(app)` group shares this world; `/` is the first viewport of the product and the reference surface for every other screen.

**Audience & job:** the owner, reading at home, asking "what is *my* inflation?" — and, at the end of a shopping trip, looking for the fastest way back into capture.

**Task & action:** read the headline honestly (number + coverage line), glance at the 12-month trend vs ISTAT, scan categories and top movers, then tap the Scan FAB or a quick action.

**Proof / content:** real engine output (`getPersonalCpi`), rebased ISTAT series from `data/istat-nic.json`, seed data extended to 14 months so the YoY headline and the 12-month chart are real.

**Constraints:** Spec 05 §5.1 layout blocks in order; all four states plus thin-data; every number via `format.ts`; tabular figures; AA in both themes; reduced motion honored.

**Chosen direction (seed 12e30ec0, re-roll 1, assigned, locked by the owner 2026-08-21):** *Tabulato a modulo continuo* — the personal index printed as a continuous-form statement: cream stock with a punched sprocket margin, green-bar zebra rows behind every data list, ribbon-ink monospace for everything the machine printed (numbers, product names, rows), a quiet preprinted-form sans for labels and prose, highlighter orange as the single live accent (text on it stays ink), red/green ribbon reserved for price direction. Dark theme is the print negative (ink field, paper type), never a phosphor screen.

**Memorable moment:** the hero number printing in — digits rolling into their fixed cells over the sprocket margin, then the coverage line underneath like the statement's footer; the highlighter-orange Scan disc punching through the tear-off perforation of the tab bar and morphing into the viewfinder.

**Raises kept from the declined hand:** one meaning per color (Televideo); true printout density in lists (Ikeda); a rigid margin column for dates/row numbers (orizuru); hierarchy by ink weight — double-strike — not only by size (star atlas).

**Unresolved:** none at brief level; exact token values are recorded in `DESIGN.md` at finish.
