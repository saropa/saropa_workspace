# Saropa Workspace — Recipe book

Twenty-five high-impact pins that Saropa Workspace can **auto-create by scanning a
project**. The user runs one command ("Detect recipes"), the extension reads a
handful of well-known files (never a full disk crawl), and proposes a checklist of
ready-to-add pins — each already configured with the right action, icon, group,
and (where relevant) a placeholder token. The user ticks the ones they want.

This is the catalog and the design intent. It feeds the roadmap item
**Non-file run targets** (a pin may be a URL or a VS Code command id, not only a
file) and **Command sequences / macros**, plus a new **recipe detector**.

---

## How auto-creation works

1. **Scan** a fixed set of marker files in each workspace folder: `.git/config`,
   `package.json`, `pyproject.toml`, `pubspec.yaml`, `Cargo.toml`, `go.mod`,
   `Makefile`, `docker-compose.yml`, `.env.example`, common config files. No
   recursive crawl; only the folder root and a couple of known subpaths.
2. **Derive** each applicable recipe from what was found (e.g. the GitHub URL from
   the `origin` remote, the dev-server script from `scripts.dev`).
3. **Propose** the matches in a multi-select QuickPick — pre-checked, each showing
   its name, source, and the exact action it will run/open.
4. **Add** the selected recipes as pins (into a seeded **"Recipes"** group), each
   carrying its icon, color, and run/open config. Idempotent: re-running never
   duplicates an existing recipe pin.

A recipe is never run during detection — it is only created. Running stays an
explicit, visible act (see the roadmap Principles).

---

## A. Open a place (URL pins derived from repo metadata)

These need a **URL pin kind** — a pin whose action opens an external URL
(`vscode.env.openExternal`) instead of a file. The URL is derived from project
metadata, so it is correct per-clone without hand-typing.

| # | Recipe | Detected from | Opens |
|---|--------|---------------|-------|
| 1 | **Open project on GitHub** | `.git/config` `origin` remote (normalize `git@`/`https`) | the repo home page |
| 2 | **Open current branch on GitHub** | remote + current branch (`HEAD`) | `…/tree/<branch>` |
| 3 | **Open a pull request for this branch** | remote + branch | `…/compare/<branch>?expand=1` |
| 4 | **Open Issues / file a new issue** | remote | `…/issues` and `…/issues/new` |
| 5 | **Open CI / Actions** | remote (host-aware: GitHub Actions, GitLab pipelines) | the pipelines page |
| 6 | **Open the deployed site** | `package.json` `homepage`, `vercel.json`, `netlify.toml`, `app.json` | the live URL |
| 7 | **Open the registry listing** | `package.json` name → npm; `pyproject`/`setup.cfg` → PyPI; `pubspec.yaml` → pub.dev; a VS Code `publisher` → Marketplace | the package/extension page |
| 8 | **Open the docs site** | `mkdocs.yml` `site_url`, `docusaurus.config.*`, README docs badge | the documentation site |

## B. Run the right thing (run-target pins, no command typed)

These reuse the existing **run-target inference** (npm scripts, Make targets) and
extend it to more ecosystems. Each writes a normal run config.

| # | Recipe | Detected from | Runs |
|---|--------|---------------|------|
| 9 | **Start dev server** | `scripts.dev` / `scripts.start`; `manage.py`; `flutter` project | the dev/watch command |
| 10 | **Run tests** | jest/vitest, `pytest`/`pyproject`, `dart test`, `go test`, `cargo test` | the project's test runner |
| 11 | **Lint & format** | eslint config, `ruff`/`flake8`, `dart analyze`, `golangci-lint`, `clippy` | the linter |
| 12 | **Build** | `scripts.build`, `make build`, `cargo build`, `flutter build` | the build command |
| 13 | **Install dependencies** | lockfile → npm/pnpm/yarn/bun; `poetry.lock`/`requirements.txt`; `pubspec.lock`; `go.sum`; `Cargo.lock` | the install command |
| 14 | **Type-check** | `tsconfig.json` → `tsc --noEmit`; `mypy`/`pyright` config | the type checker |
| 15 | **Compose up / down** | `docker-compose.yml` | `docker compose up` (and a sibling down pin) |
| 16 | **Run database migration** | Prisma, Alembic, Drizzle, Flyway, Rails markers | the migrate command |

## C. Workspace context (open key files, groups, sequences)

| # | Recipe | Detected from | Action |
|---|--------|---------------|--------|
| 17 | **Open the entry point** | `package.json` `main`/`module`, `pyproject` script, `lib/main.dart`, `cmd/*/main.go`, `src/main.rs` | open the app's entry file |
| 18 | **Set up your .env** | `.env.example` present, `.env` missing | **macro**: copy `.env.example` → `.env`, then open `.env` |
| 19 | **Open all config files** | every detected config (tsconfig, eslint, prettier, CI yml, etc.) | seed a **"Config"** group of file pins |
| 20 | **Start working (boot sequence)** | README + detected dev server | **macro**: open README, start the dev server, open localhost |

## D. Smart / derived

| # | Recipe | Detected from | Action |
|---|--------|---------------|--------|
| 21 | **Open localhost in the browser** | port from `vite.config.*`, `.env` `PORT`, `docker-compose` ports, framework default | open `http://localhost:<port>` (URL pin) |
| 22 | **Copy project name@version** | `package.json` / `pyproject` / `pubspec` / `Cargo.toml` | **command pin**: write `name@version` to the clipboard with a toast |
| 23 | **Open the changelog / releases** | `CHANGELOG.md` present (file pin) + remote `…/releases` (URL pin) | both, grouped |
| 24 | **Run the nearest package script** | the `package.json` nearest the active file → its `scripts` | QuickPick its scripts and run one |
| 25 | **Open the store / marketplace listing** | VS Code `publisher.name`; mobile `app.json`/`pubspec` ids | the public listing page |

---

## What each capability needs (maps to the roadmap)

| Capability | Recipes it unlocks | Roadmap home |
|------------|--------------------|--------------|
| **URL pin kind** (open an external URL) | 1–8, 21, 23, 25 | Non-file run targets (Later/Exploratory) |
| **Command pin kind** (run a VS Code command id) | 22, and user-bound commands generally | Non-file run targets |
| **Macro / sequence pin** (ordered steps) | 18, 20, 23 | Command sequences / macros (Later/Exploratory) |
| **Recipe detector** (scan → propose → add) | all 25 | new item — extends auto-pins + run-target inference (7.5) |
| **Extended run-target inference** | 9–16, 24 | 7.5 (already shipped for npm/Make; widen the matchers) |
| **Git/port tokens** (`$gitRemote`, `$branch`, `$port`) | 1–5, 21 | extends token system (2.4 / 7.1) |

---

## Recommended build order

1. **URL pin kind** — the single highest-leverage addition; unlocks 11 of the 25
   on its own and is the example the request named ("open the GitHub home page").
   Adds a `Pin.kind` discriminant (`file` | `url` | `command`) so the model stays
   one inventory; `file` is the default for every existing pin (versioned, no
   migration pain).
2. **Recipe detector** for the URL recipes (1–8, 25) — scan `.git/config` +
   `package.json`, derive URLs, propose them into a "Recipes" group.
3. **Command pin kind** (22) and **macro pin** (18, 20, 23).
4. **Widen run-target inference** (9–16, 24) and add the git/port tokens (21).

---

> Next concrete step proposed below the line — building recipe #1 end to end
> (URL pin kind + "Open project on GitHub" detector) proves the whole pattern.
