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