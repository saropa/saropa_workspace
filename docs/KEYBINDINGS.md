# Keybindings

Saropa Workspace ships no default key bindings (to avoid clashing with your
existing ones). Bind any of the commands below in **File → Preferences →
Keyboard Shortcuts** (`Ctrl+K Ctrl+S`), or directly in `keybindings.json`.

## Run a "top" pin by position

Five commands run the Nth pin in tree order — reorder pins by dragging to choose
which are your "top" pins:

| Command id | Title |
|---|---|
| `saropaWorkspace.runTopPin1` | Run Top Pin 1 |
| `saropaWorkspace.runTopPin2` | Run Top Pin 2 |
| `saropaWorkspace.runTopPin3` | Run Top Pin 3 |
| `saropaWorkspace.runTopPin4` | Run Top Pin 4 |
| `saropaWorkspace.runTopPin5` | Run Top Pin 5 |

Example `keybindings.json`:

```json
[
  { "key": "ctrl+alt+1", "command": "saropaWorkspace.runTopPin1" },
  { "key": "ctrl+alt+2", "command": "saropaWorkspace.runTopPin2" }
]
```

## Run a specific pin by reference

`saropaWorkspace.runPinById` takes a binding argument matched against a pin's id,
label, path, or basename — bind it to run one specific pin regardless of its
position:

```json
[
  {
    "key": "ctrl+alt+b",
    "command": "saropaWorkspace.runPinById",
    "args": "build.sh"
  }
]
```

The `args` value is matched against, in order, the pin's id, its label, its
stored path, and its basename — so `"build.sh"`, a label like `"Build"`, or the
full relative path all work.

## Other bindable commands

These have no default binding either, but are useful to bind:

| Command id | Title |
|---|---|
| `saropaWorkspace.runAnyPin` | Run Pin… (QuickPick of all pins, recents first) |
| `saropaWorkspace.runPinWithOverrides` | Run Pin with Overrides… |
| `saropaWorkspace.pinActiveFile` | Pin Active File (Project) |
| `saropaWorkspace.pinActiveFileGlobal` | Pin Active File (Global) |
| `saropaWorkspace.refresh` | Refresh the Pins view |
| `saropaWorkspace.refreshProjectFiles` | Refresh the Project Files view |

All run paths route through the same runner, so a key-bound run behaves exactly
like clicking the play button in the tree.
