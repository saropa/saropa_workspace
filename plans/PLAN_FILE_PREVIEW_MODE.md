# Saropa Workspace — File Preview Mode (Quick View)

**Feature:** Allow pinned files to open in VS Code's native "Preview Mode" (italicized tabs) on a single click. When a user clicks through multiple pinned files to quickly check their contents, they reuse the same tab, preventing workspace tab bloat. 

## 1. Motivation
Currently, Saropa Workspace hardcodes `preview: false` when opening files (as noted in the Phase 1 roadmap constraints) to ensure pins feel permanent. However, when users pin a large group of reference files (e.g., 5 different `.env` variants, multiple log files, or config maps) and click through them looking for a specific value, it results in an explosion of open editor tabs. 

Users expect the native VS Code Explorer behavior: a single click opens a transient "preview" tab (italic title); interacting with the file or double-clicking it makes it permanent; clicking another file replaces the preview tab.

---

## 2. Configuration & Model

We introduce a new user setting to govern this behavior, defaulting to `false` to strictly preserve the existing behavior for current users, but allowing the native VS Code UX for those who opt in.

Add to `package.json` under `contributes.configuration`:

```json
"saropaWorkspace.previewMode.enabled": {
  "type": "boolean",
  "default": false,
  "description": "When true, single-clicking a pinned file opens it in a transient Preview tab (italic). Clicking another pinned file will reuse that tab unless you edit it or double-click the pin."
}
```

---

## 3. Interaction Matrix (The Double-Click Conflict)

VS Code's native Explorer uses a double-click to promote a preview tab to a permanent tab. However, **Saropa Workspace maps double-click to "Run"** for scripts. We must resolve this overlap cleanly based on whether the file is *runnable* (a logic branch recently hardened in Phase 3).

| Click Type | Target File | Setting `previewMode` | Action |
| :--- | :--- | :--- | :--- |
| **Single Click** | Any file | `true` | Opens file with `{ preview: true }`. Tab is italicized. |
| **Single Click** | Any file | `false` | Opens file with `{ preview: false }`. Tab is permanent. |
| **Double Click** | **Runnable** script | *Any* | **Runs the script** (existing behavior). |
| **Double Click** | **Non-runnable** file | `true` | Opens file with `{ preview: false }` (Promotes tab to permanent). |
| **Double Click** | **Non-runnable** file | `false` | Info toast: "This file has no run command." (Phase 3 behavior). |

*Note: As per VS Code native behavior, if a user types in a preview tab, VS Code automatically promotes it to a permanent tab. We do not need to code that; the editor handles it automatically.*

---

## 4. Implementation Steps

1. **Read the Setting in the Open Command:**
   In `src/commands.ts` (or where the `Open` action is executed), read the user configuration:
   ```typescript
   const config = vscode.workspace.getConfiguration('saropaWorkspace');
   const usePreview = config.get<boolean>('previewMode.enabled', false);
   ```

2. **Pass the Argument to the VS Code API:**
   When invoking the open command, pass the preview flag.
   ```typescript
   // If using vscode.window.showTextDocument:
   vscode.window.showTextDocument(document, { preview: usePreview });
   
   // OR if using the built-in vscode.open command:
   vscode.commands.executeCommand('vscode.open', uri, { preview: usePreview });
   ```

3. **Update the Double-Click Discriminator (`doubleClickMs`):**
   In the tree view's click-timing logic (likely `treeItem.ts` or the central command dispatcher):
   * When a double-click is detected, check `isRunnable()`.
   * If `isRunnable() === true`, execute the `Run` action.
   * If `isRunnable() === false` AND `previewMode.enabled === true`, execute the `Open` action but forcefully pass `{ preview: false }` to pin the tab permanently.

4. **Context Menu Update:**
   Currently, the context menu has `Open` and `Run`. No changes are strictly necessary here, but the `Open` context menu action should respect the `previewMode` setting, just like the single-click.

---

## 5. Roadmap Update

Remove or amend the constraint in `ROADMAP.md` under "UX constraints to design around":
* *Old:* "Always pass `preview: false` on open."
* *New:* "Tree-opened files support native preview mode (italic tabs) via `saropaWorkspace.previewMode.enabled`, integrating gracefully with our custom double-click-to-run discriminator."