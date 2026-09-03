# BUG-007: Settings panel does not revert displayed value when cfg.update() fails

**Status: Fixed**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-09-02
Area: Tree View / UX
File(s): `extension/src/views/settingsPanel.ts` (`applySetting`)
Severity: Medium
Extension version: 1.6.12

---

## Summary

In `settingsPanel.ts` `applySetting`, if `cfg.update()` throws an error, the toast correctly reports the failure, but the webview client control's displayed value is not reverted to its prior state. The UI stays showing the new (unsaved) value, silently diverging from the actual persisted setting. The user sees a value that was never saved.

---

## Attribution Evidence

`applySetting` is in `extension/src/views/settingsPanel.ts`. The setting update and error handling are extension code.

---

## Reproducer

1. Open the Settings panel webview.
2. Change a setting to a new value.
3. Arrange for `cfg.update()` to fail (e.g. a read-only settings file, a policy-locked setting, or a simulated error).
4. Observe: the error toast appears, but the control in the webview still shows the new value, not the original.

**Frequency:** Always, when `cfg.update()` fails.

---

## Expected vs Actual

| | Behavior |
|---|---|
| **Expected** | On `cfg.update()` failure, the webview control reverts to the prior/actual value so the UI accurately reflects the persisted state. |
| **Actual** | The webview control retains the new (unsaved) value. The user sees a value that does not match reality. |

---

## State / Flow Context

```
applySetting (settingsPanel.ts)
  └─ cfg.update(newValue)   ← throws
      └─ catch: showErrorMessage(error)   ← toast shown, correct
      └─ webview control state: still shows newValue   ← NOT reverted
```

---

## Root Cause

The `applySetting` catch block shows an error message but does not post a message back to the webview to reset the control's value. The webview client optimistically updated its display when the user made the change, and nothing tells it to roll back on failure.

---

## Suggested Fix

In the catch block of `applySetting`, after showing the error toast, post a message to the webview with the actual current value of the setting (read from `cfg.get()` or the stored prior value). The webview client should handle this message by resetting the control to the provided value.

```ts
// In the catch block:
panel.webview.postMessage({
    type: 'revertSetting',
    key: settingKey,
    value: cfg.get(settingKey)  // the real persisted value
});
```

The webview client script needs a corresponding handler for `revertSetting` messages.

---

## Changes Made

<!-- Fill in when a fix is written. -->

---

## Verification

- [ ] `tsc -p ./ --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Manual smoke test: trigger a setting update failure, confirm the control reverts to the prior value and the error toast appears

---

## Commits

<!-- Add commit hashes as fixes land. -->

---

## Environment

- saropa_workspace version: 1.6.12
- VS Code version: any
- OS: any
- Pin scope (project / global): n/a
- Settings Sync enabled (yes / no): n/a

---

## Reflection

### Hardening items

- `panel.webview.postMessage` in the `applySetting` catch block (`settingsPanel.ts`) is fired without checking `panel.visible`/disposal state. If the user closes the panel between the optimistic "change" post and the `cfg.update()` rejection, the revert message is posted to a disposed webview and silently dropped — the in-memory control state is gone anyway on next open, but there is no guard or log distinguishing "reverted" from "webview gone," which will look identical to a fixed bug if a regression reintroduces the missing revert.
- `setControlValue` in `settingsAssets.ts` locates the control with `document.querySelector('...[data-key="' + key + '"]')`, string-concatenating `key` directly into the selector. Every current `SettingDef.key` is a static literal from `SECTIONS`, but nothing enforces that a future key can't contain a `"` or otherwise break the selector — `applySetting`'s `KNOWN_KEYS.has(key)` guard on the extension side does not protect the webview-side selector construction.
- Race window: if the user changes the same control again while the original `cfg.update()` is still in flight (e.g. two rapid edits on a slow filesystem), the later "change" message's optimistic value can be overwritten by a `revertSetting` for the earlier, now-stale request — `applySetting`/`setControlValue` have no request id or timestamp, so a revert always clobbers whatever the control currently shows, even if that's a newer, still-pending edit.
- `cfg.get(key)` in the catch block (line 214) reads the configuration fresh at failure time rather than capturing the pre-change value before `cfg.update()` was called. This is correct for the common case, but if another process/extension writes the same key concurrently between the optimistic UI change and the failed update, the reverted value reflects that third-party write, not necessarily what the user last saw before their own edit.
- The `number` branch of `setControlValue` does `number.value = String(value)` without re-validating against `min`/`max` attributes; a revert value from `cfg.get()` that happens to violate the rendered bounds (e.g. schema changed without a reload) would display unclamped, unlike user-driven edits which are clamped in the `change` listener.

### Suggestions

- Give each "change" postMessage a monotonically increasing request token per key, echoed back in `revertSetting`, and have the webview ignore a revert whose token is older than the latest "change" it sent for that key — closes the race window described above.
- Wrap the `postMessage` call in `applySetting`'s catch block with a `this.panel.visible` (or a disposed-flag) check, and log via existing extension logging when the panel is gone, so a silently-dropped revert is distinguishable from a working one during future debugging.
