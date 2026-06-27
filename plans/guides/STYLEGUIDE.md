# UI Style Guide

The rules every user-facing surface in Saropa Workspace must follow. This guide
sits beside [`principles.md`](./principles.md) (the standing design constraints)
and is the concrete checklist for any change that adds or alters a screen, a
command, a menu item, a toast, a webview, or a user-visible string.

A change that breaks a rule here is not done. When a change exposes a situation
this guide does not yet cover, the gap is itself the work: add the rule (see
[Maintaining this guide](#maintaining-this-guide)) in the same change.

Scope: this governs what the user sees. It does not restate the TypeScript,
testing, or git conventions in [`.claude/rules/`](../../.claude/rules/) — those
still apply.

---

## 1. Branding and naming

### 1.1 Screens carry the Saropa name

Every **full-screen surface** — a webview panel that opens as an editor tab —
has a title whose first word is **Saropa**. This applies to all three places the
title appears, which are driven by one i18n key:

- the editor tab title (the `createWebviewPanel` title argument),
- the HTML `<title>`,
- the in-panel `<h1>` heading.

Current screens, for reference:

| i18n key | Screen title |
| --- | --- |
| `monitor.panel.title` | **Saropa Dashboard** |
| `planner.title` | **Saropa Schedule & Workflow Planner** |
| `scheduleEditor.title` | **Saropa Schedule: {name}** |

A per-item screen title may carry an interpolated `{name}` after the Saropa
prefix (e.g. **Saropa Schedule: `regen-types`**) so the tab names the item it
edits — the Saropa-first rule still holds.

When you add a new webview panel, its title key starts with `Saropa `. Do not
hardcode the prefix at three call sites — set it once in the catalog value and
reference the key everywhere (single source of truth).

### 1.2 Menu items, buttons, and commands are NOT prefixed for branding

The thing that *opens* a screen, and any button or context-menu action, keeps
its plain wording. Two reasons it is already branded without a manual prefix:

- Command-palette entries inherit the category `%extension.displayName%`
  ("Saropa Workspace"), so the palette renders them as
  *Saropa Workspace: Run Pin…* automatically.
- Context-menu and view-toolbar actions live under the **Saropa Workspace**
  view, so their origin is already clear.

So `command.openPlanner.title` stays "Open Schedule & Workflow Planner" — the
verb and the screen name, no extra prefix. The screen it opens is the surface
that must read "Saropa Schedule & Workflow Planner". Do not add "Saropa:" to a
menu item or button to brand it; only screens get the prefix.

(A few command titles do contain "Saropa" because the word is part of the action
itself — "Copy as Saropa Link", "Pin File" under an explicit `Saropa:` for a
palette-only command. That is naming the feature, not the branding-prefix rule.)

### 1.3 Product name spelling

The product is **Saropa Workspace**, capital S, capital W. Sibling tools are
**Saropa Lints**, **Saropa Drift Advisor**, **Saropa Log Capture** — named in
full on first mention in any surface.

### 1.4 The feature is a Shortcut, never a Pin

The thing a user creates — a saved file or script that single-click opens and
double-click runs — is a **Shortcut** (plural **Shortcuts**). This replaced the
earlier name "Pin". Every user-visible surface, every code identifier, every
comment, and every doc uses Shortcut. The old word survives only in the
backward-compatibility exceptions listed below.

Copy rules:

- **Noun:** a *shortcut* / *shortcuts*. The view is **Shortcuts**; the groups are
  **Project Shortcuts** and **Global Shortcuts**; a curated collection is a
  **Shortcut Set**.
- **Do not verb "shortcut".** There is no "shortcutted". Use a plain verb for the
  action: *Add* (create one), *Remove* (delete one), *Save*. So "Pinned {name}"
  became **"Added {name}"**, "Unpin" became **"Remove"**, "Pin it" became
  **"Add shortcut"**.
- **A recipe is an auto-detected shortcut.** Because "shortcut" is now the noun
  for the user's own entries, describe a recipe as an *auto-detected* (or
  *ready-made*) shortcut so the two read as one family, not two competing words.

**VS Code's native "pinned tab" keeps the word "pin".** The tab-suggestion
feature watches editor tabs the user pinned with VS Code's own right-click → Pin
and offers to add them as Saropa shortcuts. There, "pinned tab" / "pin the tab"
is VS Code's terminology and stays literal; only the Saropa entity in the same
sentence becomes "shortcut" (e.g. "Add it to your Saropa shortcuts").

**Backward-compatibility exceptions — these keep the legacy `pin` spelling on
purpose, because v1.5.0 users have data and keybindings bound to them. Renaming
them would silently break shipped installs.** Do not "finish the rename" by
touching any of these:

- The on-disk project-file JSON field **`pins`** (and `removedAutoPins`) in
  `.vscode/saropa-workspace.json`, and the `pins` array of a stored set.
- The globalState keys **`saropaWorkspace.globalPins`** and
  **`saropaWorkspace.globalGroups`**.
- All **`saropaWorkspace.*` command and view IDs** (e.g. `saropaWorkspace.runPin`,
  the `saropaWorkspace.pins` view id). Their user-visible *titles* are renamed to
  Shortcut wording; the IDs themselves are a contract with user keybindings.
- The serialized **`pinId`** field (on a routine member and a trigger) and the
  **`"pin"`** trigger-kind discriminant value.
- The **i18n catalog key names** in `en.json` and `package.nls.json` (e.g. the
  key `pin.added`, the NLS key `command.pinFile.title`). These are internal,
  non-visible string identifiers referenced from code and the manifest; like the
  command IDs, they are kept to avoid silent runtime breakage. Only the catalog
  *values* (the text users read) are rewritten to Shortcut wording.

The compiler is the safety net for the field names: because the TypeScript
interfaces still declare `pins` / `pinId` / `removedAutoPins`, any accidental
rename of a `.pins` access becomes a type error rather than a silent wire-format
break.

---

## 2. Internationalization (translation-ready at write time)

Every string an end user can read is externalized at the moment it is written —
never hardcoded, never deferred. There are two catalogs and you pick by where
the string lives:

| String lives in… | Mechanism | Catalog file |
| --- | --- | --- |
| `package.json` (command titles, view names, setting descriptions) | `%key%` NLS placeholder | `extension/package.nls.json` |
| Code shown at runtime (toasts, panel text, QuickPick labels) | `l10n('key', { token })` | `extension/src/i18n/locales/en.json` |

Rules:

- **No inline English** in code or the manifest. A hardcoded display string ships
  English in every locale — that is a localization bug at write time.
- **Interpolate, never concatenate.** Use `{token}` placeholders inside the
  catalog value (`"Linked {name}."`), not `'Linked ' + name + '.'`. Word order
  differs across languages; a concatenated string cannot be reordered.
- **Adding keys is routine.** Needing a new string is never a reason to drop,
  shrink, or ask-permission-for a feature. Add the key as part of the change, the
  way you would write a code comment. Do not narrate it.
- **American English source** (see §6). There is no machine-translation pipeline
  in this repo; you only author the English source values.

Exempt (leave literal): log/console/debug strings, command/route/event IDs,
config keys, URLs, CSS, pure symbols and numbers.

**Synthetic group folder labels are inline in their routing table.** The short
category labels for the synthetic tree folders defined in
`model/shortcutStoreShared.ts` — the recipe groups (`RECIPE_GROUPS`,
`RECIPE_SUBGROUPS`, `RECOMMENDED_GROUP_DEF`) and the built-in default project
groups (`DEFAULT_GROUPS`: Build / Run / Deploy / Test / Docs / Data / Code) — are
written inline in American English alongside the folder's stable id, glyph, and
tint, not through `l10n`. They are one-word structural folder names that live in a
const routing table rather than at a call site, and keeping the label beside the
id/icon/color keeps the table a single source of truth. This is the established
convention for every synthetic group; match it rather than externalizing one table
in isolation. Everything else a user reads from these features — the "added to
{group}" toast, the setting description — stays externalized per the table above.

**Webview client-script strings are currently inline.** A webview's injected
client script (e.g. `PLANNER_SCRIPT` in `plannerScript.ts`) runs in the browser
context and cannot call `l10n`, which imports the catalog and runs in the
extension host. So display strings authored *inside* that script — view-tab
labels, button captions, empty states, in-canvas hints — are written inline in
American English, matching the rest of the script. Strings rendered host-side
(the panel title, `showInformationMessage` toasts) still go through `l10n`.
Localizing the client script requires a host→webview string bridge (inject a
keyed string map into the page at render time, look it up in the script); until
that bridge exists, keep client-script strings inline and consistent with their
neighbors rather than half-externalizing.

**Prefer host-rendered labels for static form markup.** When a webview's layout is
a fixed form (not a generated canvas), render the markup and ALL its visible labels
host-side via `l10n` in the panel's `renderShell` (see `scheduleEditorPanel.ts`),
and keep the injected client script free of display strings — it only reads the
host-posted initial state, wires controls, and writes host-computed text (e.g. a
preview line) into place. This keeps the whole surface translation-ready today
without the string bridge. Reserve inline client-script strings for surfaces that
build their DOM dynamically in the script (the planner canvas), where host
rendering is not practical.

---

## 3. Native-first surfaces

Default to VS Code's own surfaces; a webview must earn its place. (Full rationale
in [`principles.md`](./principles.md).)

- **Reach for native first:** tree view, QuickPick, input box, `ThemeIcon`
  product icons, markdown preview, the integrated terminal. They are theme-aware,
  accessible, and free.
- **A custom webview is the exception** — justified only when a native surface
  genuinely cannot do the job (a live chart, a sparkline trend, a sortable
  multi-column grid).
- **A many-field configuration may offer a webview FORM as the default editor,
  with the native QuickPick kept as a `(Quick)` fallback.** A hub-and-spoke
  QuickPick (pick a field, edit it, return, repeat) hides every value behind a
  step and buries conditional fields; once a configuration has more than a handful
  of fields, a single-screen form that shows them all at once is the better default
  (the Schedule editor and the Configure Run editor both do this). Keep the
  QuickPick command registered under a `…Quick` id and a `Configure X (Quick)…`
  title for keyboard-only use, and share ONE seed + ONE persistence/normalize path
  between the two so a config saved from either is byte-for-byte identical. The form
  obeys every webview rule above (nonce CSP, no remote resource, `--vscode-*`
  theming) and the asset CSS/JS lives in a sibling `*Assets.ts` so the panel module
  stays the host/logic side.
- **In a form, a conditionally-applicable control is shown DISABLED with an inline
  reason, never hidden.** A field that only applies under another setting (the
  administrator toggle, which applies only to a new external window) must stay
  visible and merely disable until its precondition holds, with a one-line hint
  naming what to set first. Hiding it makes the option undiscoverable — a user
  hunting for "run elevated" cannot find a row that does not exist. (This is the
  defect the Configure Run form was built to fix: the QuickPick hid the elevation
  field until the location was External.) A QuickPick, which cannot disable a row,
  is the one place where conditionally appending the row is acceptable.
- **A free-text field that names a tool/path the host can detect carries
  one-click choices and shows what blank resolves to.** When a form field expects
  a value the extension can discover on the machine (an interpreter binary, an
  installed runtime, an executable path), do not leave the user a bare text box to
  guess into: detect the real options host-side and render them as selectable chips
  above the box, and when the field is empty show an inline hint naming what the
  blank value falls back to (e.g. "Empty runs with `python`, the default for this
  file type"). The text box stays for power users; the chips + hint make the common
  case no-typing and the empty case unambiguous. (This is why the Configure Run
  command box lists detected interpreters as chips with a default-resolution hint;
  the matching keyboard path is the **Run With…** QuickPick.) Detection is IO, so it
  is posted to the client AFTER init — the client holds no display strings, so the
  chip pseudo-labels (default / browse) and the hint text are host-localized and
  passed in the message, exactly like the env-row template.
- **Every webview is local-only:** a strict Content-Security-Policy with a
  per-load nonce, no external script or CDN, no network of any kind.
- **Theme the webview with `--vscode-*` CSS variables** so it tracks the active
  color theme. Never hardcode a hex where a VS Code theme variable exists.
- **To draw codicon glyphs in a webview, ship the icon font — VS Code does NOT
  expose its built-in codicon font to webviews.** `esbuild.js` copies
  `@vscode/codicons`' `codicon.css` + `codicon.ttf` into `dist/`; the panel loads
  the stylesheet via `webview.asWebviewUri` under a CSP that allows the webview's
  own resource origin for `style-src` and `font-src` (`${webview.cspSource}`) and
  sets `localResourceRoots` to `dist/`. This is the sanctioned exception to "no
  bundled resource": a LOCAL font, still no network, no CDN. The full icon set is
  generated into `views/iconCatalog.ts` from the codicons metadata, so every
  offered id is a real product icon by construction (no manual verification), and
  its search keywords come from the upstream metadata as a non-displayed search aid
  (not l10n — they are matched, never shown as translated prose).
- **Render a color choice as a real swatch from the manifest hex — a QuickPick row
  cannot tint its glyph.** A `ThemeColor` shown in a QuickPick paints every row the
  same foreground color, so a color picker MUST be a webview that draws each swatch
  from its registered `contributes.colors` hex, resolved for the active theme
  (`activeColorTheme.kind` -> the matching `defaults` key). Read the hex from the
  extension's OWN `packageJSON.contributes.colors` (one source of truth with the
  registered `ThemeColor` the tree uses); never restate the palette hex in code.
- **A type-to-search QuickPick whose labels are codes or jargon carries a synonym
  list.** When a row's label is a terse identifier (a codicon id, an enum value,
  a short code) the user won't always know the exact word, so put a keyword list
  in the item's `description` and enable `matchOnDescription: true` — the synonyms
  are then both visible beside the label and matched as the user types. Keep the
  synonyms in the catalog (e.g. `appearance.iconKeyword.<id>`), not inline, so
  they stay externalized. One synonym may name several rows; that overlap is
  intended, not a bug.
- **A user-selectable color comes from a registered, named theme color, never a
  raw hex passed to `ThemeColor`.** `ThemeColor` only accepts a registered color
  id, so an arbitrary RGB tint must be declared once in `package.json`
  (`contributes.colors`, e.g. `saropaWorkspace.tint.<name>`) with explicit dark /
  light / high-contrast hex, then referenced by id everywhere. The palette offered
  to the user (shortcut and group icon tints) is the named set in
  `COLOR_CHOICES` — extend that list and add a matching `appearance.color.<name>`
  label rather than introducing an inline hex or a one-off chart color. This keeps
  every tint theme-aware and the hex in one place (the manifest).
- **Every `ThemeIcon` id must be a real product icon — verify, never assume.** A
  codicon id that does not exist (e.g. `trophy`, `award` — neither is a product
  icon) renders as nothing: `$(id)` resolves to blank in a QuickPick and the tree
  shows an empty slot, with no error. Before adding an id to the icon picker, a
  group definition, or any `new ThemeIcon(...)`, confirm it against the product-icon
  reference. The picker is unit-tested for synonym coverage but not for id validity,
  so the check is the author's.
- **Default row glyphs and tints live in one token map, keyed by role.** A tree
  row's resting icon/color is resolved in `views/shortcutRowTokens.ts` — the single
  source of truth for the row visual language. A file shortcut with no user-chosen
  icon gets a file-type glyph + tint from `fileTypeIcon` (keyed by extension or
  exact name), grouped by role so the palette is learnable (source code blue,
  config purple, data green, docs/media neutral). Add a new file type to that map
  rather than inventing a glyph at a call site; an unmapped type falls back to the
  generic shortcut glyph, never to a blank.
- **A context menu past roughly a dozen items folds into labeled submenus, not one
  long flyout.** A `view/item/context` dropdown that grows past a screen-height of
  items is unscannable. Keep the few most-used actions (Open, Run) at the top
  level and group the rest into themed submenus declared in `contributes.submenus`
  (e.g. the shortcut menu's **Output & Logs**, **Configure & Schedule**,
  **Appearance & Tags**, **File Actions**). Each moved command keeps its original
  `when` clause so per-item-type visibility is preserved, and an empty submenu is
  auto-hidden by VS Code. Submenu labels are externalized through
  `package.nls.json` (`submenu.<id>.label`) and are noun phrases, unbranded, like
  the existing submenus.
- **A submenu's `icon` shows; a dropdown row's command `icon` does NOT.** VS Code
  renders a command's `icon` only as an inline (hover-toolbar) action and on the
  submenu's own `▸` row — it is ignored on ordinary `view/item/context` dropdown
  rows, which are text-only by design. So set an icon on each submenu definition,
  but do not expect (or ask for) per-row icons inside the flyout; declutter the
  flyout with grouping and submenus instead.

---

## 4. Feedback and acknowledgment

### 4.1 No silent async

Every action that runs file, terminal, network, or state work emits a visible
outcome. Silence after a click reads as a frozen app. Acceptable acknowledgments:

- a toast (`window.showInformationMessage` / `showWarningMessage` /
  `showErrorMessage`), the default;
- a new surface opening (a panel, a QuickPick, an input box);
- a visible state change in the tree (a row re-icons, a count updates, the list
  reorders).

A silent return to the same surface is **not** acknowledgment.

Background and scheduled runs always surface an outcome — a toast and/or the
output channel. Terminal and external-window runs that cannot be tracked to an
exit code report only on start, and that limitation is stated, not hidden.

### 4.2 Name the item acted on, carry the concrete value

A confirmation the user cannot tie to a specific item is noise. Surfaces name the
exact pin, file, count, or value they acted on — never a generic message.

- Good: *"Linked `regen-types`. It will auto-run when `schema.graphql` changes."*
- Bad: *"Pin linked."*

Pair the message with the matching semantic icon for the action or entity where a
surface supports one. When choosing between a terse-but-vague message and a
slightly longer specific one, pick specific.

### 4.3 Surface failures, never swallow them

A rejected promise behind a command emits a visible error
(`window.showErrorMessage` or an output-channel line for background work). Never
catch-and-ignore. Where the failure output names a fix, offer it as a toast
action rather than making the user copy it out.

### 4.4 Offer the helpful next step, gated to once

When state implies a likely next action the user has not taken, offer it via a
toast-with-action or a one-tap dialog — and gate it on a per-feature
"done / offered / dismissed" flag so it never reappears unsolicited. The gate is
the rule; never nag.

### 4.5 Standing counters clear when the user acts on them

A persistent count surface — a per-row counter in a tree item's `description` and
the matching activity-bar `TreeView.badge` total — represents "things you have not
looked at yet" (e.g. the Watches view's unseen new-files count). Two rules keep it
honest:

- **The badge total is derived from the per-item counters, from one source.** Never
  track the total separately from the per-item counts; sum them, so the row
  counters and the activity-bar badge can never disagree.
- **Acting on the item clears its counter, which updates the total.** Clicking a
  row (or otherwise consuming what it counted) resets that item's count to zero and
  the badge recalculates. Zero shows no badge (an undefined badge is hidden) — the
  same "never show a zero" rule the untapped-shortcuts badge follows.

### 4.6 Discovery is passive — never a popup; confirm an explicit action with one toast

Surfacing a feature the user has not found yet (the Recommended shelf, a "start
here" hint) must live **in the tree**, never in a notification or modal. A popup
that nudges steals focus and reads as nagging; the user opens a passive surface
when curious. Two rules:

- **A discovery hint is an in-tree row, gated by a one-way latch.** The one-time
  Recommended-shelf welcome ("New here? These are worth turning on.") is an inert
  comment row inside the group, shown only until a persisted `globalState` flag is
  set the first time the user expands the group or adopts a recommendation — and the
  flag never unsets, so the hint appears at most once. No notification surface is
  involved at any point.
- **A toast is for confirming an explicit action, not for nudging.** The single
  permitted notification on a discovery surface is the one that confirms a state
  change the user just requested — e.g. the Recommended shelf's one-tap enable emits
  *"Dawn lint sweep enabled — runs daily at 05:00."* It names the item and carries
  the concrete value (§4.2); it never fires unprompted.

---

## 5. Voice and tone

The app speaks **to** the user, never as a company and never in the user's voice.

- **Second person** for instructions and toggle labels: *"Add a birthday"*,
  *"Show suggestions to fix mistakes"*.
- **Third person about the product** for behavior: *"Saropa Workspace seeds
  demo pins on first install."*
- **Banned both ways:** corporate plural (*"We'll find…"*, *"our picks"*) **and**
  user-voice singular (*"Remind me…"*, *"my pins"*). A toggle is a second-person
  command (*"Show suggestions…"*), not *"Prompt me…"*.
- **Tell the user what to do next** when the action needs follow-through:
  *"Restart your dev server to apply the new values."*

---

## 6. American English (hard rule)

All output — code, comments, commits, docs, and every user-facing string — uses
American English: color, favorite, behavior, center, gray, organize, license,
catalog, dialog. The `scripts/hooks/spelling_guard.py` PostToolUse hook enforces
this at write time and blocks the commit on a British spelling; do not rely on
it as a substitute for writing it right.

---

## 7. Design quality bar

- **Use the design system — never hardcode what a token defines.** Pull color,
  spacing, and type from VS Code theme variables (`--vscode-*`) in webviews and
  from `ThemeIcon` / `ThemeColor` in native surfaces. A raw hex or magic px where
  a token exists is a defect.
- **Consistency with the surrounding editor beats novelty.** Match VS Code's
  spacing density, corner treatment, and iconography. A surface that ignores the
  editor's visual language reads as broken even when it is technically correct.
- **No embellishment for novelty** — no shimmer, rainbow color, or "premium"
  treatment that was not asked for. Write the simplest version that does the job.
- **Verify before declaring done:** the tokens resolve, dark and light themes
  both render, nothing overflows at narrow and wide widths, and contrast meets
  WCAG AA.

---

## Maintaining this guide

This guide is a living document, not a fixed plan. Two triggers add to it:

1. **A change introduces a new pattern** (a new screen type, a new feedback
   surface, a new naming decision). Capture the decision here in the same change,
   so the next author inherits it instead of re-deciding.
2. **A developer asks for something that an existing rule would break, or that no
   rule yet covers.** Before building, check this guide. If a rule is broken, say
   so and reconcile it with the request before writing code. If no rule covers
   it, decide the right convention, apply it, and write it down here.

When a rule changes, update the affected surfaces to match — do not leave the
guide describing a state the code no longer reflects.
