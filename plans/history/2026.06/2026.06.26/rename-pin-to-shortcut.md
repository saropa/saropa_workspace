# Rename the Pin concept to Shortcut

The extension's central user concept — a saved file or script that single-click
opens and double-click runs — was named "Pin/Pins" throughout the UI, code, and
docs, a name that had grown ambiguous as the feature absorbed scheduling,
chaining, masking, sets, and many other behaviors. This change renames that
concept to "Shortcut/Shortcuts" across every surface a user or developer sees,
while deliberately preserving the persisted wire format and public command IDs so
shipped installs keep their saved data and keybindings.

## Scope

VS Code extension (TypeScript) and repository documentation. No Flutter/Dart code
exists in this repository.

## What changed

- **User-visible copy.** All values in `extension/src/i18n/locales/en.json` and
  `extension/package.nls.json` were rewritten to Shortcut wording. Verb forms were
  rewritten for correct English rather than mechanically swapped: "Pinned {name}"
  became "Added {name}", "Unpin" became "Remove", "Pin it" became "Add shortcut",
  and so on — no "shortcutted"/"shortcutting" forms were produced. The tree view
  reads **Shortcuts**; its groups read **Project Shortcuts** / **Global
  Shortcuts**; a curated collection is a **Shortcut Set**.
- **Documentation.** README, ROADMAP, CONTRIBUTING, ARCHITECTURE, SECURITY, and
  `docs/*` had their prose renamed, with cross-reference anchors updated to match
  renamed headings.
- **Code identifiers.** Every type (`Pin`→`Shortcut`, `PinStore`→`ShortcutStore`,
  `ProjectPinsFile`→`ProjectShortcutsFile`, the full store-class chain, the view
  item/provider/filter types, `SharedPin`→`SharedShortcut`, etc.), public store
  method, local variable, and comment was renamed. 50 source files were renamed
  from `pin*.ts` to `shortcut*.ts` and all import specifiers updated.
- **Manifest contract.** Tree-item `contextValue` strings were renamed in code
  (`pinRunning`→`shortcutRunning`, etc.); the `package.json` menu `when` clauses
  were updated to match so context menus continue to resolve. The `view ==
  saropaWorkspace.pins` view-id references were left intact.

## Preserved for backward compatibility

The following keep the legacy `pin` spelling because shipped v1.5.0 installs have
data and keybindings bound to them; renaming them would silently break those
installs. The rule and rationale are recorded in
[plans/guides/STYLEGUIDE.md](../../../guides/STYLEGUIDE.md) section 1.4.

- Serialized JSON field names: `pins`, `pinId`, `removedAutoPins`, and the
  persisted `BranchSetBinding.runPinId`.
- globalState key string values `saropaWorkspace.globalPins` /
  `saropaWorkspace.globalGroups`.
- All `saropaWorkspace.*` command and view IDs (their user-visible titles were
  renamed; the IDs are a contract with user keybindings).
- The `"pin"` trigger-kind discriminant value.
- The i18n catalog key names in both catalogs (internal, non-visible string
  identifiers, kept like the command IDs to avoid silent runtime breakage; only
  catalog values were rewritten).
- VS Code's native "pinned tab" feature keeps its own name; the tab-suggestion
  feature offers to add a long-pinned tab to the user's Saropa **shortcuts**.

## Defect found and fixed during the rename

The persisted `BranchSetBinding` field was renamed to `runShortcutId` on the read
side in `exec/branchSets.ts`, but the write side (`commands/branchSetCommands.ts`)
and the stored format still used `runPinId`. Because the binding is persisted via
`workspaceState`, an on-switch shortcut would never run after a branch switch (the
reader looked up a key the writer never wrote). The field is a serialized name and
was restored to `runPinId` everywhere, which both matches the writer and preserves
the wire format. A unit test (`branchSets.test.ts`, "an on-switch pin runs through
saropaWorkspace.runPin after the switch") caught the regression.

## Verification

- `npx tsc -p ./ --noEmit` — clean (zero errors).
- `node esbuild.js` — production bundle builds.
- `npm test` (node --test over the bundled suite) — 740/740 pass. The
  `l10n.test.ts` assertions were updated to pin the rewritten catalog values.
- Audit: the only remaining `pin` tokens in `extension/src` are the protected set
  above plus incidental English words ("spin", "stopping", etc.).

## Method

A shared rename specification fixed the deterministic identifier mapping and the
protected-token list. The mechanical content rename was fanned out across disjoint
file sets; the TypeScript compiler and the full unit-test suite served as the
central correctness gate, catching the cross-file symbol mismatches and the one
wire-format regression. The TypeScript interfaces still declaring `pins` /
`pinId` / `removedAutoPins` made the compiler a structural guard against any
accidental rename of a serialized field access.
