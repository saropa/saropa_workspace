# Saropa Workspace — Claude Chat Pinning Spec

**Feature:** Pin active Claude AI conversations directly in the Saropa Workspace sidebar. Single-click to open the chat (as a local markdown file, or deep-linked to the Claude web/desktop app).

## 1. Motivating Use Case (The "AI Tab Explosion")
As shown in the UI screenshot, developers heavily utilizing Claude often end up with dozens of identically styled tabs ("Fix and tidy...", "Review bug map...", "Find the games tab..."). 
* **The Problem:** Context is lost. When you reopen a project the next day, finding the specific AI thread where you were refactoring the `ContactAvatar` component takes 5 minutes of hunting. 
* **The Solution:** Saropa Workspace scans the local Claude chat store, matches chats relevant to the current workspace, and surfaces them as **URL or File pins** in a dedicated `AI Context` group.

---

## 2. Model & Mechanics (No new Pin types needed)

This feature reuses the existing `url` and `file` pin kinds shipped in Phase 3. It simply introduces a new **Scanner/Detector** and a new **Recipe Class (I - AI Context)**.

A Claude pin is just a standard pin configured as:
* **Kind:** `url` (e.g., `https://claude.ai/chat/<uuid>` or `claude://chat/<uuid>`) OR `file` (e.g., `.vscode/claude-chats/1234.md`).
* **Label:** The extracted title of the chat (e.g., "Review Dart linter bug").
* **Icon:** Theme-aware AI icon (e.g., `sparkle` or `hubot`).
* **Group:** A new top-level or sub-group called **"Active AI Threads"**.

---

## 3. Detection & Extraction (The Claude Chat Scanner)

Since Claude does not expose a local API, we rely on a local file scan. Developers typically have chats stored locally in one of two ways:
1. **Local Export/Sync folder:** Tools or CLI scripts that sync Claude chats to local `.md` or `.json` files.
2. **AI Assistant Extensions (Cline / Roo Code / Copilot):** Store chats in project-relative folders (e.g., `.cline/tasks/` or `.roo/`).

We will add a configurable scanner that reads these folders.

### 3.1 Workspace Configuration
Add a new configuration namespace to `package.json`:
```json
"saropaWorkspace.aiContext.claudeChatFolders": {
  "type": "array",
  "default": [".claude", ".cline/tasks", "docs/chats"],
  "description": "Local folders to scan for Claude/AI chat files to offer as pins."
}
```

### 3.2 Scanning Logic (The Detector)
When the user runs the "Detect recipes" command, the new **AI Context Detector** runs:
1. **Locate:** Check each path in `claudeChatFolders` relative to the open workspace.
2. **Parse:** For each `.json` or `.md` file found (limited to the 10 most recently modified):
   * *If JSON:* Extract the `"title"` and `"id"` fields.
   * *If Markdown:* Extract the first `# H1` heading as the title, and look for a `URL: https://claude.ai/...` frontmatter or footer.
3. **Assemble:** Create a recipe proposal for each valid chat.

---

## 4. Recipe Book Extension (Class I - AI Context)

This adds to your existing `RECIPE_BOOK.md` catalog:

| # | Recipe | Detected from | Action |
|---|--------|---------------|--------|
| **64** | **Pin active Claude thread** | Workspace-relative chat folder (`.claude/` or `.cline/tasks/`) | **url pin**: opens the chat in the browser (`https://claude.ai/chat/<id>`)<br>*OR*<br>**file pin**: opens the local `.md` transcript. |
| **65** | **Start new Claude chat (Context Aware)** | Project `README.md` or `package.json` | **url pin**: opens `https://claude.ai/new` (or macro that copies a custom pre-prompt to clipboard, then opens the URL). |

---

## 5. UI / UX

When detected and promoted, the pins land cleanly in the tree:

```text
Project Pins
├─ Entry Points
│  └─ lib/main.dart
└─ Active AI Threads         (New group, created automatically if chats selected)
   ├─ ✧ Fix contact editing bug      (URL pin → https://claude.ai/...)
   ├─ ✧ Review Dart linter bug       (URL pin)
   └─ ✧ Find the games tab           (File pin → .claude/games-tab.md)
```

**Interaction:**
* **Single-click:** Opens the URL in the default browser (or Claude Desktop if registered as protocol handler), or opens the local markdown file preview.
* **Inline Actions:** Normal pin actions apply (Rename, Unpin, Set Icon & Color).

---

## 6. Implementation / Build Order

Since Phase 3 (sibling favorites, URL action kind, interactive tokens) is largely complete, this feature fits perfectly into the upcoming **Phase 4 (Quality & Recipe Expansion)**.

1. **Add the Configurable Setting:** Define `saropaWorkspace.aiContext.claudeChatFolders`.
2. **Build the Chat Parser (`claudeParser.ts`):** 
   * Write a fast file-walker that sorts by `mtime` (last modified) to grab only the freshest chats.
   * Add extraction logic: RegEx for markdown titles/URLs, `JSON.parse` for structured logs.
3. **Wire into the Detector (`recipeDetector.ts`):** 
   * Hook the parser into the auto-creation checklist.
   * Map the output to `PinAction` objects with `kind: "url"` or `kind: "file"`.
4. **Group Promotion:** 
   * Ensure selected AI threads map into a new `"Active AI Threads"` default group in `.vscode/saropa-workspace.json`.

---

## 7. Future Exploratory: The "Auto-Pruning" Routine
Because AI chats age out quickly (a bug is fixed, the context is stale), Claude pins risk cluttering the workspace over time. 
* **Integration with Workspace Hygiene (Recipe #63):** We can extend the Phase 3 hygiene scan to flag pinned AI chats that haven't been modified or clicked in >14 days. 
* **Action:** The hygiene report proposes a one-click *"Unpin stale AI chats"* remediation.

---

## Finish Report (2026-06-25)

Status: Implemented (recipes 64 and 65). The auto-pruning routine in section 7 remains exploratory and was not built.

### What was added

A new recipe category, **AI Context**, surfaces active Claude/AI conversations as
recipe pins in a dedicated **Active AI Threads** group. The feature reuses the
existing `url` and `file` pin kinds and the whole recipe lifecycle (sticky removal
via `removedRecipes`, **Restore Recipes**, promote-to-pin, single-click detail and
hover) — it introduces a detector and a synthetic group, not new pin types.

### Files

- `extension/src/recipes/aiContextRecipes.ts` (new) — `detectAiContextRecipes`.
  Reads `saropaWorkspace.aiContext.enabled` (master toggle) and
  `saropaWorkspace.aiContext.claudeChatFolders` (default `.claude`,
  `.cline/tasks`, `docs/chats`). Scans each folder's top level only (no recursion,
  matching the detector-wide rule), `stat`s every `.md`/`.json` entry, keeps the
  globally freshest ten (`MAX_THREADS`), and reads/parses only those. JSON
  transcripts must carry a string `title` (the gate that keeps an unrelated config
  JSON from being pinned) and yield a `claude.ai/chat/<id|uuid>` deep link when an
  id is present. Markdown transcripts use the first `# H1` as the title and a
  `claude.ai` URL (frontmatter or footer) as the deep link, with trailing
  link/bracket delimiters stripped; a Markdown file with neither an H1 nor a URL
  is skipped. A thread with a deep link becomes a `url` pin; otherwise a `file`
  pin on the local transcript. Recipe 65 (**Start a new Claude chat** →
  `claude.ai/new`) is emitted only when at least one configured chat folder exists,
  so the group stays out of projects that do not use AI chat folders.
- `extension/src/recipes/detectors.ts` — `RecipeCategory` gains `"ai"`.
- `extension/src/model/pinStore.ts` — registers the `ai-threads` group
  ("Active AI Threads", `sparkle` icon, `charts.foreground`, order 9989 so it
  leads the recipe groups) in `RECIPE_GROUPS`, and calls the new detector in
  `detectRecipes` alongside the others. The group only renders when it has a pin
  (existing per-group gating).
- `extension/src/extension.ts` — the two new settings trigger `store.rescan()`
  (which clears the recipe cache) on change.
- `extension/package.json` + `extension/package.nls.json` — the two settings and
  their NLS descriptions.
- Root `README.md` settings table and `CHANGELOG.md` `## [Unreleased]`.

### Design decisions that diverged from the plan's letter

1. **File layout.** The plan named `claudeParser.ts` plus edits to a
   `recipeDetector.ts`. No such aggregator file exists; the repository's actual
   architecture is one detector module per category (`suiteRecipes.ts`,
   `processRecipes.ts`, `scheduledRecipes.ts`), aggregated in
   `PinStore.detectRecipes`. The implementation follows the repository: a single
   `aiContextRecipes.ts` holding both scan and parse.
2. **No "Detect recipes" command.** The plan's section 3.2 references a manual
   "Detect recipes" command; the product has no such command — detection runs
   automatically on refresh/reload and is cached per folder. The new detector
   follows that model. New transcripts surface on the next window reload, matching
   every other detector.
3. **Group visibility.** The plan's UI section states the group is "created
   automatically if chats selected". Recipe 65 is therefore gated on a chat folder
   being present rather than offered in every project, so the group does not appear
   where AI chats are not in use.

### Verification

`npx tsc -p ./ --noEmit` and `node esbuild.js` both exit 0. No automated test
infrastructure exists in the repository (no `extension/src/test/**`), so behavior
was reviewed by inspection.

### Not built

Section 7's auto-pruning routine (flag/Unpin stale AI chats via the hygiene scan)
is left as exploratory future work, as the plan itself marked it.