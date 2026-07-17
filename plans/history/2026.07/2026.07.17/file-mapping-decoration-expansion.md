# File mapping decoration plan expansion

The `plans/FILE_MAPPING_DECORATION.md` plan document — which maps well-known filenames and extensions to codicon glyphs and `charts.*` theme colors for the Project Files view and launcher — was expanded from ~73 lines covering only project documentation files to ~500 lines covering the full spectrum of developer file types.

## Finish Report (2026-07-17)

### What changed

The plan document was rewritten from scratch. The original contained only a "Project documentation" section with ~25 rows, several inconsistencies with the actual codebase (`scale` instead of `law`, `gray` instead of `foreground`), and duplicate entries (FAQ/FAQS, overlapping GETTING STARTED/SETUP rows, WEB/FLUTTER-prefixed duplicates with identical regexes).

The new document contains 16 sections (~340 mapped entries):

1. **Project documentation** — README, CHANGELOG, LICENSE, CONTRIBUTING, SECURITY, etc.
2. **Git files** — `.gitignore`, `.gitattributes`, `.gitmodules`, `.gitkeep`
3. **CI/build** — Dockerfile, Jenkinsfile, Procfile, Vagrantfile, Makefile, Justfile, Taskfile, Rakefile, Cakefile, Earthfile, Tiltfile
4. **Package managers** — npm, yarn, pnpm, bun, deno, Cargo, Go, Maven, Gradle, pip, Poetry, Composer, NuGet, Mix, CocoaPods, CMake, Bazel, melos
5. **Editor/formatter/linter config** — `.editorconfig`, `.prettierrc`, `.eslintrc`, `.stylelintrc`, `.commitlintrc`, `analysis_options.yaml`, `.rubocop.yml`, `.pylintrc`, `.clang-format`, `.swiftlint.yml`
6. **Test config** — Jest, Vitest, Cypress, Playwright, pytest, `.codecov.yml`, `.coveragerc`
7. **Environment/secrets** — `.env*`, `.secret*`, `.credentials`
8. **Infrastructure** — Terraform, Ansible, Kubernetes, Helm, Vagrant, Packer, Pulumi, serverless, docker-compose, nginx, Apache
9. **Flutter/Dart** — `pubspec.yaml`, `analysis_options.yaml`, `build.yaml`, `l10n.yaml`, `devtools_options.yaml`
10. **Source code extensions** — 40+ languages grouped by ecosystem color
11. **Config/data extensions** — JSON variants, GraphQL, protobuf, HCL, WASM
12. **Database extensions** — SQL, SQLite, MongoDB query files, Redis, Prisma, migration files
13. **Documentation extensions** — Markdown, RST, AsciiDoc, LaTeX, man pages, PDF
14. **Shells/scripts** — bash, zsh, fish, PowerShell, bat/cmd, AppleScript, Lua
15. **Web extensions** — HTML, CSS preprocessors, templating (Handlebars, Pug, EJS, Jinja, Twig, ERB, Blade, Slim, Haml)
16. **Media** — images, audio, video, fonts
17. **Archives/binaries** — zip, tar, gz, whl, deb, rpm, dmg, exe, msi, AppImage, snap, flatpak
18. **Locks/logs** — lock files, log files

### Corrections applied

- Icon names now match actual VS Code codicons (`law` not `scale`, `question` not `help-circle`, `checklist` not `check-square`, `mortar-board` not `graduation-cap`)
- Color names now match the actual `charts.*` theme color API (`foreground` not `gray`)
- All regex patterns are lowercase with a note that matching is case-insensitive (removed `UPPER|lower` alternations)
- Removed duplicate entries that had identical regexes under different section headings

### Relationship to code

The plan covers far more file types than the current `fileTypeTokens.ts` implementation (which has ~28 named-file entries and ~55 extension entries). The plan serves as the reference for future implementation expansion — it is not yet code.

### No code changes

No TypeScript, test, or configuration files were modified. The plan document is in `plans/` (git-ignored working notes).
