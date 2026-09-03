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
