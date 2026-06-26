# Keybindings

Saropa Workspace ships no default key bindings (to avoid clashing with your
existing ones). Bind any of the commands below in **File → Preferences →
Keyboard Shortcuts** (`Ctrl+K Ctrl+S`), or directly in `keybindings.json`.

## Run a "top" shortcut by position

Five commands run the Nth shortcut in tree order — reorder shortcuts by dragging
to choose which are your "top" shortcuts:

| Command id | Title |
|---|---|
| `saropaWorkspace.runTopPin1` | Run Top Shortcut 1 |
| `saropaWorkspace.runTopPin2` | Run Top Shortcut 2 |
| `saropaWorkspace.runTopPin3` | Run Top Shortcut 3 |
| `saropaWorkspace.runTopPin4` | Run Top Shortcut 4 |
| `saropaWorkspace.runTopPin5` | Run Top Shortcut 5 |

Example `keybindings.json`:

```json
[
  { "key": "ctrl+alt+1", "command": "saropaWorkspace.runTopPin1" },
  { "key": "ctrl+alt+2", "command": "saropaWorkspace.runTopPin2" }
]
```

## Run a specific shortcut by reference

`saropaWorkspace.runPinById` takes a binding argument matched against a
shortcut's id, label, path, or basename — bind it to run one specific shortcut
regardless of its position:

```json
[
  {
    "key": "ctrl+alt+b",
    "command": "saropaWorkspace.runPinById",
    "args": "build.sh"
  }
]
```

The `args` value is matched against, in order, the shortcut's id, its label, its
stored path, and its basename — so `"build.sh"`, a label like `"Build"`, or the
full relative path all work.

## Other bindable commands

These have no default binding either, but are useful to bind:

| Command id | Title |
|---|---|
| `saropaWorkspace.runAnyPin` | Run Shortcut… (QuickPick of all shortcuts, recents first) |
| `saropaWorkspace.runPinWithOverrides` | Run Shortcut with Overrides… |
| `saropaWorkspace.pinActiveFile` | Add Active File as Shortcut (Project) |
| `saropaWorkspace.pinActiveFileGlobal` | Add Active File as Shortcut (Global) |
| `saropaWorkspace.refresh` | Refresh the Shortcuts view |
| `saropaWorkspace.refreshProjectFiles` | Refresh the Project Files view |

All run paths route through the same runner, so a key-bound run behaves exactly
like clicking the play button in the tree.
