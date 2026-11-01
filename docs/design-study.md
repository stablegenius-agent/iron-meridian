# Design study: Apple's Human Interface Guidelines applied to IRON MERIDIAN

Source: Apple HIG pages *Buttons*, *Materials* (Liquid Glass), *Segmented controls*, *Alerts*
(developer.apple.com/design/human-interface-guidelines, read 2026-11-01). Quotes are verbatim.

## What the HIG says, and what the old UI did wrong

| HIG principle | Quote | Old IRON MERIDIAN | Revamp |
|---|---|---|---|
| **Controls float on their own layer above content** | "Liquid Glass forms a distinct functional layer for controls and navigation elements … that floats above the content layer" | Opaque full-width top bar and boxy panels glued to the screen edges, competing with the globe | Floating, rounded glass toolbars and sidebars, inset from the edges; the globe shows through |
| **Use glass sparingly; content layer stays plain** | "Don't use Liquid Glass in the content layer." "Limit these effects to the most important functional elements" | Glow, borders and neon on everything | Glass only for the toolbar, the side panels and sheets; rows inside are plain |
| **One or two prominent buttons per view** | "Keep the number of prominent buttons to one or two per view." | Every op was an outlined box; EXECUTE was one more red box, often scrolled off-screen | Exactly one filled accent button per view: the **action bar's** verb button, pinned to the bottom of the dossier |
| **Distinguish choices by style, not size** | "Use style — not size — to visually distinguish the preferred choice" | Mixed sizes, mixed borders | Four styles only: *prominent* (filled), *tinted*, *gray* (bordered), *plain*; one capsule geometry |
| **Roles: primary, cancel, destructive** | "a primary button uses an app's accent color, whereas a destructive button uses the system red color." "Don't assign the primary role to a button that performs a destructive action" | DECLARE WAR and EXECUTE both red | Execute = accent blue primary. Declare War = destructive red, never primary, always behind a confirmation alert |
| **Labels: verbs, title case, specific** | "consider starting the label with a verb" · "Avoid using OK" · "Always use 'Cancel'" | "EXECUTE", "STAND DOWN", "CLOSE" in tracked capitals | The button names the result: **Launch Strike**, **Begin Recon**, **Deploy Aid**; alerts use **Cancel** |
| **Button placement** | "place the button people are most likely to choose on the trailing side … Cancel buttons are typically on the leading side" | Arbitrary order | Sheets: Cancel leading, primary trailing; stacked choices: preferred on top |
| **Hit targets and press states** | "a button needs a hit region of at least 44x44 pt" · "Always include a press state for a custom button." | 20–26 px tall buttons, 1 px nudge on press | 36–44 px controls, spring scale-down press, visible keyboard focus ring |
| **Segmented controls for related choices** | "Use nouns … for segment labels" · "Prefer using either text or images — not a mix" · "no more than about five to seven segments" | Speed buttons and force tabs as loose boxes, tabs mixed glyph + text | Speed = icon-only segmented control; force filter = text-only segmented control (6 segments) |
| **Familiar icons** | "Try to associate familiar actions with familiar icons" | Unicode glyphs/emoji that render inconsistently (☠ ⛨ ◭ ⟡) | One hand-drawn SF Symbols-style line icon set (`src/icons.js`) |
| **Alerts only when needed; Cancel always present for destructive actions** | "Avoid using an alert merely to provide information." "If there's a destructive action, include a Cancel button" | Modal "CLOSE" boxes for info | Alerts reserved for decisions (war, dilemmas); info goes to banners and the comms feed |
| **Legibility over materials** | "Thicker materials … provide better contrast for text" | Low-contrast muted text on 78% panels | Regular (thick) glass for text-heavy panels, vibrant labels, tabular numerals |

## Interaction model for taking action (the core loop)

1. **Choose a target**: click a country, crisis card or pin. The dossier sheet slides in.
2. **Choose an operation**: a list grouped by escalation (*Intelligence & Support*, *Limited Force*,
   *Major Operations*), each row showing an icon, name and one-line effect, with a checkmark on the
   selected one. Back-Channel Talks sits in the first group; **Declare War** is alone at the bottom,
   red, separated, as destructive actions should be.
3. **Choose assets**: selectable rows with circular check indicators (iOS edit-mode style), ETA on the
   trailing side, unavailable assets dimmed with the reason.
4. **Commit**: the pinned **action bar** always shows the four odds (Success, Loss, Collateral,
   Tension), the cost, and one prominent button whose title is the verb for that operation. It never
   scrolls away.

## Accessibility

- `prefers-reduced-motion` disables springs, pulses and slide-ins.
- `prefers-reduced-transparency` swaps glass for solid fills.
- Status is never color-only: odds have labels, units have status text, crisis urgency has a timer.
