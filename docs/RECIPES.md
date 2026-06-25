# Run recipes

Common run configurations. Set them from a pin's context menu with **Configure
Run…** — no JSON editing required. Each recipe maps to the pin's run config
(command prefix, arguments, working directory, environment, and the
terminal-vs-background toggle).

## How a run command is assembled

By default a run is assembled as:

```
<command> <file> <args>
```

- **Command prefix** — the interpreter or runner placed before the file. If you
  leave it empty, the default for the file extension is used (see
  `saropaWorkspace.interpreterDefaults`, defaults below).
- **File** — the pinned file's path. You can omit it with the **Pass file path
  to command** toggle (off) for run targets that name their work in the
  arguments instead (an npm script, a Make target).
- **Args** — appended after the file.

Default interpreters by extension (`saropaWorkspace.interpreterDefaults`):

| Extension | Command |
|---|---|
| `.py` | `python` |
| `.js`, `.mjs`, `.cjs` | `node` |
| `.ts` | `ts-node` |
| `.ps1` | `pwsh -File` |
| `.sh` | `bash` |
| `.rb` | `ruby` |

## Placeholder tokens

These expand at run time, in the command, arguments, and working directory
(quoting is preserved for paths with spaces):

| Token | Expands to |
|---|---|
| `$workspaceRoot` | the workspace folder path |
| `$dir` | the pinned file's directory |
| `$file` | the full file path |
| `$fileName` | the file's base name |
| `$fileNameWithoutExt` | the base name without extension |

Interactive tokens, resolved when you run (the stored pin is unchanged):

| Token | Behavior |
|---|---|
| `${prompt:Label}` | opens an input box labeled `Label` |
| `${pick:a,b,c}` | opens a quick pick over `a`, `b`, `c` |

A token reused across fields is asked once; canceling any prompt aborts the run.
Scheduled runs skip pins that use interactive tokens (see
[SCHEDULING.md](SCHEDULING.md)).

## Examples

### Run a Python script with arguments

- Command prefix: *(empty — uses `python`)*
- Arguments: `--out $dir/result.txt $fileNameWithoutExt`

### Run an npm script (file path omitted)

Pin `package.json`, then in Configure Run:

- **Pass file path to command:** off
- Command prefix: `npm`
- Arguments: `run build`

Assembles as `npm run build` in the package directory. (Pinning a
`package.json` also offers its scripts directly via run-target inference.)

### Run a Make target

Pin the `Makefile`:

- **Pass file path to command:** off
- Command prefix: `make`
- Arguments: `test`

### Ask for a value at run time

- Arguments: `--env ${pick:dev,staging,prod} --tag ${prompt:Release tag}`

### Run in the background instead of the terminal

Set **Run in** to *Background output channel* in Configure Run. Background runs
can be stopped from the tree and show a success/failure badge; terminal runs stay
interactive in the integrated terminal.
