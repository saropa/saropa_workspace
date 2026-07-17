# File mapping decoration

Maps well-known filenames and extensions to a codicon glyph and a `charts.*` theme color for use in the Project Files view and the launcher. Regex matches case-insensitively against the basename (not the full path).

Colors follow the role-based palette in `fileTypeTokens.ts`: documentation and meta-project files are **foreground** (neutral/gray), source code is **blue** (JS yellow, Rust/JVM orange, Ruby red), config is **purple/orange**, data is **purple-green**, shells are **green**, media is **purple**.

> **Known divergence:** the current code (`fileTypeTokens.ts`) uses `charts.yellow` for LICENSE files. This plan recommends `foreground` to group all project-documentation files under one neutral tint. The implementation should pick one and align both the code and the plan.

> **Validation:** run `scripts/validate_file_mappings.py` to check every icon name against the installed VS Code codicon set and every regex for syntax errors.

## Project documentation

| Document | Regex | Color | Icon |
|---|---|---:|---|
| README | `^readme(\.(md|markdown|txt|rst|adoc))?$` | foreground | file-text |
| CHANGELOG | `^changelog(\.(md|markdown|txt|rst|adoc|yml|yaml))?$` | foreground | history |
| RELEASE NOTES | `^release[_-]?notes(\.(md|txt|rst|adoc))?$` | foreground | package |
| VERSION | `^version(\.(txt|md))?$` | foreground | tag |
| CONTRIBUTING | `^contributing(\.(md|markdown|txt|rst|adoc))?$` | foreground | git-pull-request |
| CODE OF CONDUCT | `^code[_-]of[_-]conduct(\.(md|markdown|txt|rst|adoc))?$` | foreground | shield |
| SECURITY | `^security(\.(md|markdown|txt|rst|adoc))?$` | foreground | shield |
| LICENSE | `^(licen[sc]e|copying|copyright)(\.(md|txt|rst|adoc))?$` | foreground | law |
| AUTHORS | `^(authors|contributors)(\.(md|txt))?$` | foreground | organization |
| MAINTAINERS | `^maintainers?(\.(md|txt))?$` | foreground | organization |
| GOVERNANCE | `^governance(\.(md|txt|rst|adoc))?$` | foreground | law |
| ROADMAP | `^roadmap(\.(md|txt|rst|adoc))?$` | foreground | map |
| TODO | `^(todo|todos|tasks)(\.(md|txt|rst))?$` | foreground | checklist |
| FAQ | `^(faq|faqs|frequently[_-]asked[_-]questions)(\.(md|txt|rst|adoc))?$` | foreground | question |
| INSTALL | `^(install|installation)(\.(md|txt|rst|adoc))?$` | foreground | desktop-download |
| SETUP | `^(setup|getting[_-]started)(\.(md|txt|rst|adoc))?$` | foreground | plug |
| QUICKSTART | `^quickstart(\.(md|txt|rst|adoc))?$` | foreground | rocket |
| USAGE | `^usage(\.(md|txt|rst|adoc))?$` | foreground | play |
| EXAMPLES | `^examples?(\.(md|txt|rst|adoc))?$` | foreground | code |
| DEMO | `^demo(\.(md|txt|rst|adoc))?$` | foreground | play |
| TUTORIAL | `^tutorials?(\.(md|txt|rst|adoc))?$` | foreground | mortar-board |
| GUIDE | `^guides?(\.(md|txt|rst|adoc))?$` | foreground | book |
| MANUAL | `^manual(\.(md|txt|rst|adoc))?$` | foreground | book |
| DOCS | `^docs(\.(md|txt|rst|adoc))?$` | foreground | book |
| ARCHITECTURE | `^(architecture|design)(\.(md|txt|rst|adoc))?$` | foreground | layers |
| SPEC | `^(spec|specification)(\.(md|txt|rst|adoc))?$` | foreground | note |
| REQUIREMENTS | `^requirements(\.(md|txt|rst|adoc))?$` | foreground | tasklist |
| DECISIONS | `^(adr|decisions?)(\.(md|txt|rst|adoc))?$` | foreground | git-merge |
| CHANGE REQUEST | `^(change[_-]request|changes)(\.(md|txt|rst|adoc))?$` | foreground | git-compare |
| TROUBLESHOOTING | `^troubleshooting(\.(md|txt|rst|adoc))?$` | foreground | tools |
| SUPPORT | `^support(\.(md|txt|rst|adoc))?$` | foreground | comment-discussion |
| PRIVACY | `^privacy(\.(md|txt|rst|adoc))?$` | foreground | eye-closed |
| DISCLAIMER | `^disclaimer(\.(md|txt|rst|adoc))?$` | foreground | warning |
| MIGRATION | `^migration(\.(md|txt|rst|adoc))?$` | foreground | arrow-swap |
| DEPLOYMENT | `^deployment(\.(md|txt|rst|adoc))?$` | foreground | cloud-upload |
| ACKNOWLEDGMENTS | `^acknowledg(e?ments|ing)(\.(md|txt))?$` | foreground | heart |
| CREDITS | `^credits(\.(md|txt))?$` | foreground | heart |
| NOTICES | `^(notice|notices|third[_-]party[_-]notices)(\.(md|txt))?$` | foreground | info |
| PATENTS | `^patents?(\.(md|txt))?$` | foreground | law |
| CODEOWNERS | `^codeowners$` | foreground | organization |
| FUNDING | `^\.?funding(\.(yml|yaml))?$` | foreground | heart |
| CITATION | `^citation(\.(cff|bib|md))?$` | foreground | quote |
| PROFESSIONAL SERVICES | `^professional[_-]services(\.(md|txt))?$` | foreground | briefcase |

## Git and version control

| File | Regex | Color | Icon |
|---|---|---:|---|
| .gitignore | `^\.gitignore$` | foreground | git-commit |
| .gitattributes | `^\.gitattributes$` | foreground | git-commit |
| .gitmodules | `^\.gitmodules$` | foreground | git-commit |
| .gitkeep | `^\.gitkeep$` | foreground | git-commit |
| .mailmap | `^\.mailmap$` | foreground | git-commit |

## CI and build

| File | Regex | Color | Icon |
|---|---|---:|---|
| Dockerfile | `^dockerfile(\..*)?$` | blue | vm |
| .dockerignore | `^\.dockerignore$` | blue | vm |
| docker-compose | `^docker-compose(\..*)?\.ya?ml$` | blue | vm |
| Makefile | `^(makefile|gnumakefile)$` | foreground | settings-gear |
| Jenkinsfile | `^jenkinsfile$` | foreground | server-process |
| Procfile | `^procfile$` | foreground | server-process |
| Vagrantfile | `^vagrantfile$` | foreground | vm |
| Rakefile | `^rakefile$` | red | ruby |
| Justfile | `^justfile$` | foreground | terminal |
| Taskfile | `^taskfile(\.ya?ml)?$` | foreground | tasklist |
| .travis.yml | `^\.travis\.ya?ml$` | foreground | server-process |
| .gitlab-ci.yml | `^\.gitlab-ci\.ya?ml$` | foreground | server-process |
| .circleci | `^\.circleci$` | foreground | server-process |
| appveyor.yml | `^appveyor\.ya?ml$` | foreground | server-process |
| azure-pipelines | `^azure-pipelines(\.ya?ml)?$` | foreground | server-process |
| Earthfile | `^earthfile$` | foreground | vm |
| Tiltfile | `^tiltfile$` | foreground | vm |
| Caddyfile | `^caddyfile$` | foreground | server-process |
| Brewfile | `^brewfile$` | foreground | package |
| Gemfile | `^gemfile$` | red | ruby |

## Package managers and manifests

| File | Regex | Color | Icon |
|---|---|---:|---|
| package.json | `^package\.json$` | yellow | json |
| package-lock.json | `^package-lock\.json$` | foreground | lock |
| npm-shrinkwrap.json | `^npm-shrinkwrap\.json$` | foreground | lock |
| .npmrc | `^\.npmrc$` | foreground | settings-gear |
| .npmignore | `^\.npmignore$` | foreground | settings-gear |
| .yarnrc | `^\.yarnrc(\.ya?ml)?$` | foreground | settings-gear |
| yarn.lock | `^yarn\.lock$` | foreground | lock |
| pnpm-lock.yaml | `^pnpm-lock\.ya?ml$` | foreground | lock |
| pnpm-workspace.yaml | `^pnpm-workspace\.ya?ml$` | foreground | settings-gear |
| .pnpmfile.cjs | `^\.pnpmfile\.cjs$` | foreground | settings-gear |
| bun.lockb | `^bun\.lockb$` | foreground | lock |
| bunfig.toml | `^bunfig\.toml$` | orange | settings-gear |
| deno.json | `^deno\.jsonc?$` | foreground | json |
| deno.lock | `^deno\.lock$` | foreground | lock |
| pubspec.yaml | `^pubspec\.ya?ml$` | blue | package |
| pubspec.lock | `^pubspec\.lock$` | foreground | lock |
| Cargo.toml | `^cargo\.toml$` | orange | package |
| Cargo.lock | `^cargo\.lock$` | foreground | lock |
| go.mod | `^go\.mod$` | blue | package |
| go.sum | `^go\.sum$` | foreground | lock |
| pom.xml | `^pom\.xml$` | orange | package |
| build.gradle | `^build\.gradle(\.kts)?$` | orange | package |
| settings.gradle | `^settings\.gradle(\.kts)?$` | orange | settings-gear |
| gradlew | `^gradlew(\.bat)?$` | orange | terminal |
| gradle.properties | `^gradle\.properties$` | orange | settings-gear |
| Pipfile | `^pipfile$` | blue | package |
| Pipfile.lock | `^pipfile\.lock$` | foreground | lock |
| pyproject.toml | `^pyproject\.toml$` | blue | package |
| setup.py | `^setup\.py$` | blue | package |
| setup.cfg | `^setup\.cfg$` | blue | settings-gear |
| requirements.txt | `^requirements([-_].+)?\.txt$` | blue | package |
| poetry.lock | `^poetry\.lock$` | foreground | lock |
| Gemfile.lock | `^gemfile\.lock$` | foreground | lock |
| composer.json | `^composer\.json$` | purple | package |
| composer.lock | `^composer\.lock$` | foreground | lock |
| .csproj | `.*\.csproj$` | purple | package |
| .sln | `.*\.sln$` | purple | project |
| nuget.config | `^nuget\.config$` | purple | settings-gear |
| packages.config | `^packages\.config$` | purple | package |
| mix.exs | `^mix\.exs$` | purple | package |
| mix.lock | `^mix\.lock$` | foreground | lock |
| rebar.config | `^rebar\.config$` | foreground | package |
| Package.swift | `^package\.swift$` | orange | package |
| Podfile | `^podfile$` | orange | package |
| Podfile.lock | `^podfile\.lock$` | foreground | lock |
| CMakeLists.txt | `^cmakelists\.txt$` | foreground | settings-gear |
| Makefile.am | `^makefile\.am$` | foreground | settings-gear |
| configure.ac | `^configure\.ac$` | foreground | settings-gear |
| meson.build | `^meson\.build$` | foreground | settings-gear |
| BUILD | `^build(\.bazel)?$` | foreground | settings-gear |
| WORKSPACE | `^workspace(\.bazel)?$` | foreground | settings-gear |

## Editor and formatter config

| File | Regex | Color | Icon |
|---|---|---:|---|
| .editorconfig | `^\.editorconfig$` | foreground | settings-gear |
| .prettierrc | `^\.prettierrc(\.(json|ya?ml|js|cjs|mjs|toml))?$` | foreground | settings-gear |
| .prettierignore | `^\.prettierignore$` | foreground | settings-gear |
| .eslintrc | `^\.eslintrc(\.(json|ya?ml|js|cjs|mjs))?$` | foreground | settings-gear |
| .eslintignore | `^\.eslintignore$` | foreground | settings-gear |
| eslint.config | `^eslint\.config\.(js|cjs|mjs|ts)$` | foreground | settings-gear |
| .stylelintrc | `^\.stylelintrc(\.(json|ya?ml|js|cjs))?$` | foreground | settings-gear |
| .markdownlint | `^\.markdownlint(rc)?(\.(json|ya?ml))?$` | foreground | settings-gear |
| .commitlintrc | `^\.commitlintrc(\.(json|ya?ml|js|cjs))?$` | foreground | settings-gear |
| .lintstagedrc | `^\.lintstagedrc(\.(json|ya?ml|js|cjs|mjs))?$` | foreground | settings-gear |
| lint-staged.config | `^lint-staged\.config\.(js|cjs|mjs)$` | foreground | settings-gear |
| .huskyrc | `^\.huskyrc(\.(json|ya?ml|js))?$` | foreground | settings-gear |
| tsconfig.json | `^tsconfig(\..+)?\.json$` | blue | json |
| jsconfig.json | `^jsconfig\.json$` | yellow | json |
| babel.config | `^(babel\.config\.(js|cjs|mjs|json)|\.babelrc(\.(js|cjs|mjs|json))?)$` | yellow | settings-gear |
| webpack.config | `^webpack\.config(\..+)?\.(js|ts|cjs|mjs)$` | blue | settings-gear |
| rollup.config | `^rollup\.config(\..+)?\.(js|ts|cjs|mjs)$` | blue | settings-gear |
| vite.config | `^vite\.config\.(js|ts|cjs|mjs)$` | purple | settings-gear |
| esbuild | `^esbuild\.(js|mjs|cjs)$` | yellow | settings-gear |
| postcss.config | `^postcss\.config\.(js|cjs|mjs)$` | foreground | settings-gear |
| tailwind.config | `^tailwind\.config\.(js|ts|cjs|mjs)$` | blue | settings-gear |
| next.config | `^next\.config\.(js|ts|cjs|mjs)$` | foreground | settings-gear |
| nuxt.config | `^nuxt\.config\.(js|ts)$` | foreground | settings-gear |
| svelte.config | `^svelte\.config\.(js|ts)$` | foreground | settings-gear |
| angular.json | `^angular\.json$` | red | json |
| analysis_options.yaml | `^analysis_options\.ya?ml$` | blue | settings-gear |
| .clang-format | `^\.clang-format$` | foreground | settings-gear |
| .clang-tidy | `^\.clang-tidy$` | foreground | settings-gear |
| rustfmt.toml | `^rustfmt\.toml$` | orange | settings-gear |
| clippy.toml | `^clippy\.toml$` | orange | settings-gear |
| .rubocop.yml | `^\.rubocop\.ya?ml$` | red | settings-gear |
| .flake8 | `^\.flake8$` | blue | settings-gear |
| .pylintrc | `^\.pylintrc$` | blue | settings-gear |
| ruff.toml | `^ruff\.toml$` | blue | settings-gear |
| mypy.ini | `^(mypy\.ini|\.mypy\.ini)$` | blue | settings-gear |
| .golangci.yml | `^\.golangci\.ya?ml$` | blue | settings-gear |
| biome.json | `^biome\.jsonc?$` | foreground | settings-gear |

## Test config

| File | Regex | Color | Icon |
|---|---|---:|---|
| jest.config | `^jest\.config\.(js|ts|cjs|mjs|json)$` | foreground | beaker |
| vitest.config | `^vitest\.config\.(js|ts|cjs|mjs)$` | foreground | beaker |
| .mocharc | `^\.mocharc\.(json|ya?ml|js|cjs)$` | foreground | beaker |
| karma.conf | `^karma\.conf\.(js|ts)$` | foreground | beaker |
| cypress.config | `^cypress\.config\.(js|ts|cjs|mjs)$` | foreground | beaker |
| playwright.config | `^playwright\.config\.(js|ts)$` | foreground | beaker |
| .nycrc | `^\.nycrc(\.(json|ya?ml))?$` | foreground | beaker |
| pytest.ini | `^(pytest\.ini|conftest\.py|tox\.ini)$` | blue | beaker |
| .coveragerc | `^(\.coveragerc|coverage\.xml)$` | foreground | beaker |
| codecov.yml | `^(\.?codecov\.ya?ml)$` | foreground | beaker |

## Environment and secrets

| File | Regex | Color | Icon |
|---|---|---:|---|
| .env | `^\.env(\..+)?$` | yellow | key |
| .env.example | `^\.env\.(example|sample|template|defaults)$` | foreground | key |
| .secret | `^\.secrets?$` | yellow | key |
| vault.yml | `^vault\.ya?ml$` | yellow | key |
| .age | `^\.age$` | yellow | key |
| .sops.yaml | `^\.sops\.ya?ml$` | yellow | key |

## Infrastructure

| File | Regex | Color | Icon |
|---|---|---:|---|
| terraform | `.*\.tf$` | purple | cloud |
| terraform vars | `.*\.tfvars$` | purple | cloud |
| terraform lock | `^\.terraform\.lock\.hcl$` | foreground | lock |
| ansible | `^(playbook|site|hosts|inventory)\.ya?ml$` | foreground | server |
| kubernetes | `^(deployment|service|ingress|configmap|secret|pod|statefulset|daemonset|job|cronjob|namespace|pvc|pv|role|rolebinding|clusterrole|networkpolicy|hpa)\.ya?ml$` | blue | cloud |
| helm | `^(chart|values)(\..*)?\.ya?ml$` | blue | cloud |
| skaffold.yaml | `^skaffold\.ya?ml$` | blue | cloud |
| serverless.yml | `^serverless\.(ya?ml|json)$` | foreground | cloud |
| SAM template | `^(template|sam)\.ya?ml$` | orange | cloud |
| CDK | `^cdk\.json$` | orange | cloud |
| pulumi | `^pulumi\.(ya?ml|json)$` | purple | cloud |
| nginx.conf | `^nginx\.conf$` | foreground | server |
| .htaccess | `^\.htaccess$` | foreground | server |

## Flutter and Dart

| File | Regex | Color | Icon |
|---|---|---:|---|
| .metadata | `^\.metadata$` | foreground | info |
| .flutter-plugins | `^\.flutter-plugins(-dependencies)?$` | foreground | info |
| .packages | `^\.packages$` | foreground | info |
| build.yaml | `^build\.ya?ml$` | foreground | settings-gear |
| l10n.yaml | `^l10n\.ya?ml$` | foreground | globe |
| dartdoc_options.yaml | `^dartdoc_options\.ya?ml$` | foreground | settings-gear |
| mono_repo.yaml | `^mono_repo\.ya?ml$` | foreground | settings-gear |
| melos.yaml | `^melos\.ya?ml$` | foreground | settings-gear |
| dart_test.yaml | `^dart_test\.ya?ml$` | foreground | beaker |

## Source code (by extension)

| Extension | Color | Icon |
|---|---:|---|
| .ts | blue | file-code |
| .tsx | blue | file-code |
| .mts | blue | file-code |
| .cts | blue | file-code |
| .js | yellow | file-code |
| .jsx | yellow | file-code |
| .mjs | yellow | file-code |
| .cjs | yellow | file-code |
| .dart | blue | symbol-class |
| .py | blue | snake |
| .go | blue | file-code |
| .rs | orange | file-code |
| .java | orange | file-code |
| .kt | orange | file-code |
| .kts | orange | file-code |
| .scala | orange | file-code |
| .c | blue | file-code |
| .cpp | blue | file-code |
| .cc | blue | file-code |
| .cxx | blue | file-code |
| .h | blue | file-code |
| .hpp | blue | file-code |
| .hxx | blue | file-code |
| .cs | purple | file-code |
| .fs | blue | file-code |
| .fsx | blue | file-code |
| .vb | blue | file-code |
| .rb | red | file-code |
| .php | purple | file-code |
| .swift | orange | file-code |
| .m | foreground | file-code |
| .mm | foreground | file-code |
| .r | blue | file-code |
| .jl | purple | file-code |
| .lua | blue | file-code |
| .ex | purple | file-code |
| .exs | purple | file-code |
| .erl | red | file-code |
| .hrl | red | file-code |
| .hs | purple | file-code |
| .lhs | purple | file-code |
| .ml | orange | file-code |
| .mli | orange | file-code |
| .clj | green | file-code |
| .cljs | green | file-code |
| .cljc | green | file-code |
| .elm | blue | file-code |
| .purs | foreground | file-code |
| .nim | yellow | file-code |
| .zig | orange | file-code |
| .v | blue | file-code |
| .d | red | file-code |
| .pl | foreground | file-code |
| .pm | foreground | file-code |
| .groovy | foreground | file-code |
| .sol | purple | file-code |

## Config and data (by extension)

| Extension | Color | Icon |
|---|---:|---|
| .json | yellow | json |
| .jsonc | yellow | json |
| .json5 | yellow | json |
| .jsonl | yellow | json |
| .ndjson | yellow | json |
| .geojson | yellow | json |
| .yaml | purple | settings-gear |
| .yml | purple | settings-gear |
| .toml | orange | settings-gear |
| .ini | foreground | settings-gear |
| .cfg | foreground | settings-gear |
| .conf | foreground | settings-gear |
| .properties | foreground | settings-gear |
| .env | yellow | key |
| .xml | orange | code |
| .xsl | orange | code |
| .xsd | orange | code |
| .dtd | orange | code |
| .wsdl | orange | code |
| .plist | orange | code |
| .hcl | purple | code |
| .dhall | purple | code |
| .graphql | purple | symbol-interface |
| .gql | purple | symbol-interface |
| .proto | blue | symbol-interface |
| .avro | blue | symbol-interface |
| .thrift | blue | symbol-interface |

## Data and database (by extension)

| Extension | Color | Icon |
|---|---:|---|
| .sql | purple | database |
| .db | blue | database |
| .sqlite | blue | database |
| .sqlite3 | blue | database |
| .csv | green | graph |
| .tsv | green | graph |
| .parquet | green | graph |
| .arrow | green | graph |
| .avsc | blue | database |

## Documentation (by extension)

| Extension | Color | Icon |
|---|---:|---|
| .md | blue | markdown |
| .markdown | blue | markdown |
| .mdx | blue | markdown |
| .rst | foreground | book |
| .txt | foreground | file |
| .pdf | red | file-pdf |
| .adoc | foreground | book |
| .tex | foreground | book |
| .latex | foreground | book |
| .org | foreground | book |
| .wiki | foreground | book |
| .man | foreground | book |
| .pod | foreground | book |
| .rtf | foreground | file |
| .doc | blue | file |
| .docx | blue | file |
| .odt | blue | file |

## Shells and scripts (by extension)

| Extension | Color | Icon |
|---|---:|---|
| .sh | green | terminal-bash |
| .bash | green | terminal-bash |
| .zsh | green | terminal-bash |
| .fish | green | terminal-bash |
| .ksh | green | terminal-bash |
| .csh | green | terminal-bash |
| .ps1 | blue | terminal-powershell |
| .psm1 | blue | terminal-powershell |
| .psd1 | blue | terminal-powershell |
| .bat | foreground | terminal |
| .cmd | foreground | terminal |
| .com | foreground | terminal |

## Web (by extension)

| Extension | Color | Icon |
|---|---:|---|
| .html | orange | code |
| .htm | orange | code |
| .xhtml | orange | code |
| .css | blue | paintcan |
| .scss | purple | paintcan |
| .sass | purple | paintcan |
| .less | purple | paintcan |
| .styl | purple | paintcan |
| .vue | green | code |
| .svelte | orange | code |
| .astro | orange | code |
| .njk | foreground | code |
| .hbs | foreground | code |
| .ejs | foreground | code |
| .pug | foreground | code |
| .liquid | foreground | code |
| .wasm | purple | file-binary |

## Media (by extension)

| Extension | Color | Icon |
|---|---:|---|
| .png | purple | file-media |
| .jpg | purple | file-media |
| .jpeg | purple | file-media |
| .gif | purple | file-media |
| .webp | purple | file-media |
| .avif | purple | file-media |
| .ico | purple | file-media |
| .bmp | purple | file-media |
| .tiff | purple | file-media |
| .tif | purple | file-media |
| .svg | purple | symbol-color |
| .mp3 | purple | file-media |
| .wav | purple | file-media |
| .ogg | purple | file-media |
| .flac | purple | file-media |
| .aac | purple | file-media |
| .wma | purple | file-media |
| .mp4 | purple | file-media |
| .mkv | purple | file-media |
| .avi | purple | file-media |
| .mov | purple | file-media |
| .webm | purple | file-media |
| .wmv | purple | file-media |
| .flv | purple | file-media |
| .ttf | purple | text-size |
| .otf | purple | text-size |
| .woff | purple | text-size |
| .woff2 | purple | text-size |
| .eot | purple | text-size |

## Archives and binaries (by extension)

| Extension | Color | Icon |
|---|---:|---|
| .zip | foreground | file-zip |
| .tar | foreground | file-zip |
| .gz | foreground | file-zip |
| .bz2 | foreground | file-zip |
| .xz | foreground | file-zip |
| .7z | foreground | file-zip |
| .rar | foreground | file-zip |
| .tgz | foreground | file-zip |
| .jar | orange | file-zip |
| .war | orange | file-zip |
| .ear | orange | file-zip |
| .whl | blue | file-zip |
| .gem | red | file-zip |
| .nupkg | purple | file-zip |
| .deb | foreground | file-zip |
| .rpm | foreground | file-zip |
| .apk | green | file-zip |
| .ipa | foreground | file-zip |
| .dmg | foreground | file-zip |
| .msi | foreground | file-zip |
| .exe | foreground | file-binary |
| .dll | foreground | file-binary |
| .so | foreground | file-binary |
| .dylib | foreground | file-binary |
| .o | foreground | file-binary |
| .a | foreground | file-binary |
| .lib | foreground | file-binary |

## Locks and logs (by extension)

| Extension | Color | Icon |
|---|---:|---|
| .lock | foreground | lock |
| .log | foreground | output |
| .pid | foreground | output |

## Notebook and data science (by extension)

| Extension | Color | Icon |
|---|---:|---|
| .ipynb | orange | notebook |
| .rmd | blue | notebook |
| .qmd | blue | notebook |
