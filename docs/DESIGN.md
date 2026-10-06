# Interface design

House Painter's interface follows the R7 Orbit design system (https://r7orbit.io): warm obsidian surfaces, ivory text, one brass accent, hairlines and small radii, Cormorant Garamond for headlines, Inter for interface text, JetBrains Mono for numbers. It is dark only: there is no light theme and no theme switch.

This page says where the design comes from, how to use it, how to add to it, and what must never change.

## Where it comes from

The tokens, fonts and logo were copied from the R7 Orbit site repository (read only, nothing there was changed):

| Copied here | From the site repo | Changes |
|---|---|---|
| `ui/tokens.css` | `src/styles/design-system/tokens.css` | font URLs made relative (`fonts/...`, not `/fonts/...`) so the app works under a sub-path such as GitHub Pages. Nothing else. |
| `ui/fonts/*.woff2` (12 files) | `public/fonts/` | none. The "core" and "rest" halves of each face, split by `unicode-range`, as on the site. |
| `ui/fonts/LICENSES/` | `public/fonts/LICENSES/` | none (SIL Open Font License for all three families). |
| `ui/img/r7-mark.svg` | `public/assets/r7-mark.svg` | none. Used once, as the credit link on the landing page. |

**Site commit these came from:** `97dd4eb3b1335e7b3039a536d768cc38526be9a4` (`git -C "<site path>" rev-parse HEAD`).

The component shapes in `ui/base.css` (`.btn`, `.seg`, fields, `.card`, `.wordmark`, scrollbars, focus ring, motion) are written to match `src/styles/design-system/components.css` at the same commit; the app-only parts (panels, the walkthrough bar, swatch tiles, the plan drawing) are ours.

**To re-sync with the site:**

1. `git -C "<site path>" rev-parse HEAD`, and compare with the commit above.
2. Copy `tokens.css` over `ui/tokens.css`, then repeat the one edit: `sed "s#url('/fonts/#url('fonts/#g"`. Keep the header comment, updating the commit.
3. Copy any changed `public/fonts/*.woff2` and `LICENSES/` over `ui/fonts/`. If a face was added, add it to `tokens.css` (it arrives with the copy).
4. Diff `components.css` against `ui/base.css` for the shared pieces (buttons, segmented control, fields, scrollbars, focus) and port what changed.
5. `node --test tests/ui-tokens.test.js` must still pass. Update the commit in this file.

## What is in `ui/`

| File | What it is |
|---|---|
| `tokens.css` | The site's tokens and the `@font-face` rules (self-hosted fonts, with metric-matched fallbacks). Never add app rules here. |
| `base.css` | Everything shared: base, type, icons, buttons, segmented control, fields (select, range, checkbox, colour, file), dialog, toast, tooltip, wordmark, touch and forced-colours rules, and the app-level tokens below. |
| `home.css`, `paint.css`, `editor.css`, `floorplan.css` | One page each (`index.html`, `paint.html`, `editor.html`, `floorplan.html`). |
| `fonts/`, `img/` | The woff2 files with their licences; the R7 mark. |

Every page links `ui/tokens.css`, `ui/base.css` and its own file, in that order, and preloads two fonts (Inter and Cormorant, the "core" files) because the interface text and the title are above the fold. There is no inline `<style>` and no request to a font service.

**The static build must publish `ui/`** (the whole folder, with `fonts/` and `img/`). `tools/build_site.js` copies a fixed list of files; `ui/` has to be on it.

## The rules

1. **Tokens only.** No hex codes, `rgb()`, named colours, raw `px` or `ms`, ad-hoc font sizes, radii or shadows in `ui/*.css` (other than `tokens.css`). If a value is missing, add a token. A layout constant (a column width) is written once as a custom property, such as `--col-rooms: 280px`, and used through `var()`. `tests/ui-tokens.test.js` enforces this by reading the CSS (`npm test`).
2. **Obsidian background, ivory text.** `--bg` and `--surface-1/2/3` for surfaces, `--text`, `--text-2`, `--text-3` for text. Never `#000` or `#fff`.
3. **Depth is tone.** A panel is one step lighter than what it sits on. Shadows (`--shadow-float`, `--shadow-raise`) are for things that float: dialogs, toasts, tooltips, the walkthrough colour picker, a card on hover. Floating bars over the 3D view use the translucent `--header-veil` with a hairline instead.
4. **Hairlines and small radii.** `--bw` borders in `--line`, `--line-strong`, `--line-brass`. Radii `--r-xs` to `--r-lg`; `--r-full` only for chips and dots.
5. **One accent: brass.** Selected, focused, the one main action per view. Status colours (`--st-done`, `--st-failed`) appear only for done and error. No other hue in the interface.
6. **Type.** Cormorant Garamond (`--font-display`) for headlines and big display text only: page titles, dialog titles, the room name in the walkthrough. Inter (`--font-ui`) for all interface text. JetBrains Mono (`--font-mono`) for numbers, areas, codes, measurements, keys and paint codes. Sentence case; uppercase only for short tracked labels (`.eyebrow`, segmented controls).
7. **Motion means something.** `--ease` and `--dur-fast`, `--dur`, `--dur-slow`. Reduced motion zeroes the durations.
8. **Focus is visible.** `--focus-ring` on everything focusable, `outline-offset` `--focus-offset`.
9. **AA contrast.** Text is `--text` (16:1), `--text-2` (7.5:1) or `--text-3` (4.9:1) on the surfaces. `--text-3-app` is only for non-text marks such as a slider track.
10. **One theme.** No `prefers-color-scheme`, no `data-theme`.

## Tokens in use

- **Surfaces:** `--bg`, `--surface-1` (panels, top bar), `--surface-2` (cards, fields on hover, dialogs), `--surface-3` (selected, hover rows), `--void`, `--scrim`, `--scrim-strong`, `--header-veil`.
- **Lines:** `--line` (dividers), `--line-strong` (field and button edges), `--line-brass` (selected, focused).
- **Text:** `--text`, `--text-2`, `--text-3`, `--text-3-app`, `--on-brass`, `--on-scrim`.
- **Brass:** `--brass` (the main action, the selection mark), `--brass-bright` (hover, selected text), `--brass-dim`, `--brass-highlight`, `--brass-deep`, `--brass-wash-1/2/3` (selected rows and tiles).
- **Status:** `--st-done`, `--st-failed`, `--st-failed-text`, `--st-failed-wash`, `--st-done-wash`, `--st-idle`.
- **Type:** `--font-display`, `--font-ui`, `--font-mono`; `--fs-2xs` to `--fs-5xl`; `--fw-*`; `--lh-*`; `--tracking-*`.
- **Space and shape:** `--s-1` to `--s-8`, `--r-xs` to `--r-lg`, `--r-full`, `--bw`.
- **Elevation, motion, layers:** `--shadow-float`, `--shadow-raise`, `--glow-dot`; `--ease`, `--dur-fast`, `--dur`, `--dur-slow`; `--focus-ring`, `--focus-offset`, `--selection`; `--z-*`.
- **Texture and layout:** `--grid-dot`, `--grid-size` (the dot grid behind the landing hero); `--gutter`, `--w-content`, `--w-wide`.

### Tokens added for the app (top of `base.css`)

`--ctl-sm` 28px, `--ctl` 36px, `--ctl-lg` 46px (button and field heights, as the site's `.btn`, `.sm`, `.lg`), `--tap` 44px (the touch minimum, applied under `(pointer: coarse)`), `--icon` 16px, `--mark-h`, `--bw-2`, `--bw-3`, `--blur`, `--blur-sm`, `--scrollbar`, `--panel-w`.

### Names the page scripts still use

The scripts write inline styles and a loader error box that name the old variables. They are kept as aliases of tokens, and new CSS must not use them: `--panel` = `--surface-1`, `--raised` = `--surface-2`, `--ink` = `--text`, `--muted` = `--text-2`, `--select` = `--brass`, `--select-soft` = `--brass-wash-2`, `--ok`, `--warn`, `--f-display`, `--f-body`, `--r`, and `--stage` (the 3D and plan background, `= --bg`). `editor.css` adds the plan's drawing names (`--wall`, `--wall-ext`, `--open`, `--removed`, `--new`, `--snap`, `--grid`, `--grid-major`) and `floorplan.css` the sheet's (`--paper`, `--card`, `--rule`, `--open`, `--bed`, `--clos`, `--wet`, `--util`, `--cabB`, `--cabW`, `--app`, `--red`, `--green`), all as tokens.

## Adding a component

1. Look for a site component first (`components.css`: `.btn`, `.chip`, `.card`, `.seg`, `.field`, `.callout`, `.eyebrow`). Reuse its shape and name.
2. Put a shared component in `base.css`, a page-only one in that page's file. Write it with tokens: `background: var(--surface-1); border: var(--bw) solid var(--line); border-radius: var(--r-md); padding: var(--s-4); transition: border-color var(--dur) var(--ease);`.
3. States: hover goes to `--brass` border and `--brass-bright` text; selected is `--surface-3` with `--brass-bright` text and a `--line-brass` edge (`aria-pressed='true'`); disabled is `--text-3` on `--line`; focus is the global ring (do not remove the outline).
4. Targets under `(pointer: coarse)` need at least `--tap`. Add the component to the list in `base.css`'s touch block if it is a control.
5. Icons: inline SVG with `class="ico"` (16 x 16 viewBox, 1.5px stroke, round caps, `currentColor`), `aria-hidden="true"`, and an `aria-label` on the button. No emoji.
6. Run `node --test tests/ui-tokens.test.js`.

## Fonts

Self-hosted woff2, `font-display: swap`, split into "core" (ASCII and typographic punctuation) and "rest" (accents) by `unicode-range`, so a page downloads the second file only if it shows such a character. Metric-matched fallbacks (`Cormorant Fallback`, `Inter Fallback`, `JetBrains Mono Fallback`) stop the swap moving the layout. Cormorant weight 500 is served by the 400 file. To add a weight, copy the file from the site, add its `@font-face` rule to `tokens.css` (copy it from the site's), and the licence stays the same.

## What must not change

- **The colours a person paints with.** Swatches, chips, room and surface dots, the selected-colour chip, the paint-needed list and the custom colour picker take their colour from `--c` (set inline from data) or from the colour input itself. `ui/paint.css` only draws a hairline outline round them, never a tint, an opacity or a filter, and a swatch is never dimmed, even when disabled. `tests/ui-tokens.test.js` checks that each swatch rule still takes `background: var(--c)`.
- **The 3D rendering.** Lighting, tone mapping, exposure, environment, materials and textures live in `house3d.js` and `paint-app.js`; the CSS never touches the canvas except to size it. The scene reads `--stage` for its background (`paint-app.js`, `editor.js`); that is now `--bg` (it was a light or dark grey, by the system theme). Painted surfaces render exactly as before: a pixel comparison of the 3D canvas, same house, same paint, same camera, in the dollhouse, top-down and face-on views under all four lighting modes, found 0 differing pixels out of 662,480 in each. The stage colour shows only where the model does not cover the view: in the Outside view it is the sky behind the house (those pixels, and the anti-aliased edge of the house against it, are the only ones that changed). To keep the old neutral grey behind the model, point `--stage` at a grey token in `base.css`; nothing else depends on it.
- **Colour data.** The hsl room colours in the plan editor, the surface map colours and the wood floor on the floor plan are identifiers and data. The room colours in the editor are quietened (`--room-saturate`) but keep their hue so a room can still be matched between the list and the plan.
- **The markup the scripts build.** Class names, ids, `data-*` and `aria-*` attributes that `paint-app.js`, `editor.js`, `floorplan.js` and `house-loader.js` create or query must stay, and so must the aliases above. The CSS styles what the scripts emit (including the loader's inline-styled error box, via `!important` in `base.css`); it does not rely on changing them.
- **Behaviour.** Keyboard shortcuts, tab order, ids, what each control does, and the responsive breakpoints (860px, 1100px).

## Accessibility

- Contrast (WCAG AA, 4.5:1 for text): `--text` is 16:1 on `--bg`, `--text-2` 7.5:1 on `--bg` and 6.4:1 on the lightest surface, `--text-3` 4.9:1 on `--bg` and 4.7:1 on `--surface-1`. Because `--text-3` falls to 4.5 or below on `--surface-2` and `--surface-3`, use `--text-2` for any text on a card, a dialog, a selected row or the translucent bars over the 3D view. Brass on `--bg` is 8.9:1; `--on-brass` on brass 8.4:1. Check a new pairing with the table in the site's `DESIGN_SYSTEM.md` (section 3) before using it.
- Focus: the global brass-bright ring; inputs draw it flush so the border change and the ring do not stack.
- Reduced motion: durations go to zero (`tokens.css`) and animations stop (`base.css`).
- Forced colours: borders and the pressed states use system colours (`Highlight`, `ButtonText`); swatches keep their colour with `forced-color-adjust: none`.
- Touch: 44px minimum under `(pointer: coarse)` for buttons, segmented controls, fields, sliders, the walkthrough pad, zoom buttons.
- Structure: each page has one `h1` (the tool's name in the top bar), a `main` landmark where the page is a document (landing, floor plan), and the modal wrapper is a labelled `role="dialog"`. The floor plan sheet is a focusable, labelled region so it scrolls by keyboard at narrow widths.
- Colour is never the only signal: selected is a tone, a brass edge and, for swatches, a check mark; "done" steps have a check; suggested door gaps are dashed and window gaps dotted.

## Known gaps

- **Markup the scripts emit** that CSS cannot fix: the file input in the house loader's error box has no text label (`house-loader.js`); the walkthrough's confirm dialog has `role="alertdialog"` without a name (`paint-app.js`); the fixture library's `h4` headings skip a level (`editor.js`). The axe run reports these three and nothing else on colour or contrast.
- **Hue-coded identifiers** stay hue-coded: the room fills and list dots in the editor (quietened, not recoloured) and the surface map on the floor plan.
- **Glyphs inside script strings** are not icons: the start marker's triangle and the Return symbol in the length label (plan SVG text), and the arrows in link text on the landing page.
- **Favicon.** None is linked: the head is not part of this restyle. `ui/img/r7-mark.svg` is the logo if one is wanted.
- **Scripts from a CDN** (Three.js, and tesseract and pdf.js on request) are not part of this work.

## Credit

The landing page footer links the R7 mark and "R7 Orbit" to https://r7orbit.io. There is no other credit.
