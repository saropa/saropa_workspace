"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/test/sabitovvtImport.test.ts
var import_node_test = require("node:test");
var import_strict = __toESM(require("node:assert/strict"));
var nodeFs2 = __toESM(require("node:fs"));
var os2 = __toESM(require("node:os"));
var nodePath2 = __toESM(require("node:path"));

// src/test/_stub/vscode.ts
var nodeFs = __toESM(require("node:fs"));
var nodePath = __toESM(require("node:path"));
var FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64
};
var Uri = class _Uri {
  constructor(scheme, fsPath, raw) {
    this.scheme = scheme;
    this.fsPath = fsPath;
    this.raw = raw;
  }
  static file(p) {
    return new _Uri("file", p, p);
  }
  static parse(value) {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(value);
    const scheme = match ? match[1] : "file";
    return new _Uri(scheme, value, value);
  }
  // Compose a child file URI. Mirrors vscode.Uri.joinPath: append the segments to
  // the base path with "/" separators (the store always passes POSIX-style
  // relative segments). A trailing slash on the base is collapsed so the result
  // never contains a double slash.
  static joinPath(base, ...segments) {
    const head = base.fsPath.replace(/[\\/]+$/, "");
    const joined = [head, ...segments].join("/");
    return new _Uri("file", joined, joined);
  }
  toString() {
    return this.raw;
  }
};
var RelativePattern = class {
  constructor(base, pattern) {
    this.base = base;
    this.pattern = pattern;
  }
};
var folders;
function __setWorkspaceFolders(next) {
  folders = next;
}
function ownerFolder(uri) {
  const target = uri.fsPath.replace(/\\/g, "/");
  return (folders ?? []).find((f) => {
    const base = f.uri.fsPath.replace(/\\/g, "/").replace(/\/+$/, "");
    return target === base || target.startsWith(base + "/");
  });
}
var configValues = /* @__PURE__ */ new Map();
function __setConfig(section, key, value) {
  configValues.set(section ? `${section}.${key}` : key, value);
}
function __resetConfig() {
  configValues.clear();
  installedExtensions.clear();
}
function getConfiguration(section) {
  return {
    get(key, defaultValue) {
      const full = section ? `${section}.${key}` : key;
      return configValues.has(full) ? configValues.get(full) : defaultValue;
    }
  };
}
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}
async function findFiles(include, exclude, maxResults) {
  const root = include.base.uri.fsPath;
  const matcher = globToRegExp(include.pattern);
  const excludeName = exclude ? exclude.replace(/[*/]/g, "") : void 0;
  const out = [];
  const walk = (dir) => {
    if (maxResults !== void 0 && out.length >= maxResults) {
      return;
    }
    for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      if (excludeName && entry.name === excludeName) {
        continue;
      }
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = nodePath.relative(root, full).replace(/\\/g, "/");
        if (matcher.test(rel)) {
          out.push(Uri.joinPath(include.base.uri, rel));
        }
      }
    }
  };
  walk(root);
  return out;
}
var fsApi = {
  async stat(uri) {
    const s = nodeFs.statSync(uri.fsPath);
    return {
      type: s.isDirectory() ? FileType.Directory : FileType.File,
      size: s.size,
      ctime: Math.trunc(s.ctimeMs),
      mtime: Math.trunc(s.mtimeMs)
    };
  },
  async readFile(uri) {
    return nodeFs.readFileSync(uri.fsPath);
  },
  async writeFile(uri, content) {
    nodeFs.writeFileSync(uri.fsPath, content);
  },
  async createDirectory(uri) {
    nodeFs.mkdirSync(uri.fsPath, { recursive: true });
  },
  async delete(uri, options) {
    nodeFs.rmSync(uri.fsPath, { recursive: !!options?.recursive, force: true });
  }
};
var workspace = {
  getConfiguration,
  get workspaceFolders() {
    return folders;
  },
  getWorkspaceFolder(uri) {
    return ownerFolder(uri);
  },
  fs: fsApi,
  findFiles
};
var installedExtensions = /* @__PURE__ */ new Set();
var extensions = {
  getExtension(id) {
    return installedExtensions.has(id) ? { id } : void 0;
  }
};
var inputHandler = async () => void 0;
var pickHandler = async () => void 0;
var EventEmitter = class {
  listeners = /* @__PURE__ */ new Set();
  event = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(data) {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }
  dispose() {
    this.listeners.clear();
  }
};
var windowStateEmitter = new EventEmitter();
var selectionEmitter = new EventEmitter();
var activeEditorEmitter = new EventEmitter();
function createOutputChannel(name) {
  return {
    name,
    appendLine() {
    },
    append() {
    },
    clear() {
    },
    show() {
    },
    hide() {
    },
    replace() {
    },
    dispose() {
    }
  };
}
var window = {
  showInputBox(opts) {
    return inputHandler(opts);
  },
  // The real signature takes (items, options); the second arg is unused by the
  // tested code paths, so the stub ignores it.
  showQuickPick(items) {
    return pickHandler(items);
  },
  // The branch-set binder and several command handlers emit toasts via these. No
  // test asserts on their text, so they are inert no-ops that resolve to undefined
  // (the "no action button chosen" result) — they must only exist and not throw.
  showInformationMessage(_message, ..._items) {
    return Promise.resolve(void 0);
  },
  showWarningMessage(_message, ..._items) {
    return Promise.resolve(void 0);
  },
  createOutputChannel,
  onDidChangeWindowState: windowStateEmitter.event,
  onDidChangeTextEditorSelection: selectionEmitter.event,
  onDidChangeActiveTextEditor: activeEditorEmitter.event
};

// src/test/_stub/context.ts
function memento() {
  const store = /* @__PURE__ */ new Map();
  return {
    get(key, defaultValue) {
      return store.has(key) ? store.get(key) : defaultValue;
    },
    update(key, value) {
      if (value === void 0) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
      return Promise.resolve();
    },
    keys() {
      return [...store.keys()];
    },
    setKeysForSync() {
    }
  };
}
function fakeContext() {
  return {
    globalState: memento(),
    workspaceState: memento()
  };
}

// src/model/pin.ts
function pinKind(pin) {
  return pin.action?.kind ?? "file";
}
var PROJECT_PINS_VERSION = 3;
var DEFAULT_SET_NAME = "Default";
function emptyProjectPinsFile() {
  return {
    version: PROJECT_PINS_VERSION,
    pins: [],
    groups: [],
    activeSet: DEFAULT_SET_NAME,
    sets: [],
    removedAutoPins: [],
    removedRecipes: [],
    autoGroups: {}
  };
}
var PROJECT_FILE_RELATIVE = ".vscode/saropa-workspace.json";

// src/model/pinPaths.ts
function parseGlobalPath(stored) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(stored) ? Uri.parse(stored) : Uri.file(stored);
}
function globalStoredPath(uri) {
  return uri.scheme === "file" ? uri.fsPath : uri.toString();
}

// src/recipes/gitMeta.ts
async function readText(uri) {
  try {
    const bytes = await workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return void 0;
  }
}
async function getGitRemote(folder2) {
  const config = await readText(
    Uri.joinPath(folder2.uri, ".git", "config")
  );
  if (!config) {
    return void 0;
  }
  const originUrl = extractRemoteUrl(config, "origin") ?? extractAnyRemoteUrl(config);
  if (!originUrl) {
    return void 0;
  }
  return normalizeRemote(originUrl);
}
function extractRemoteUrl(config, remote) {
  const section = new RegExp(
    `\\[remote "${remote}"\\]([\\s\\S]*?)(?:\\n\\[|$)`,
    "i"
  ).exec(config);
  if (!section) {
    return void 0;
  }
  const url4 = /\burl\s*=\s*(.+)/.exec(section[1]);
  return url4 ? url4[1].trim() : void 0;
}
function extractAnyRemoteUrl(config) {
  const url4 = /\burl\s*=\s*(.+)/.exec(config);
  return url4 ? url4[1].trim() : void 0;
}
function normalizeRemote(raw) {
  let url4 = raw.trim();
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(url4);
  let host;
  let pathPart;
  if (scp) {
    host = scp[1];
    pathPart = scp[2];
  } else {
    const m = /^[a-z]+:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(url4);
    if (!m) {
      return void 0;
    }
    host = m[1];
    pathPart = m[2];
  }
  pathPart = pathPart.replace(/\.git$/i, "").replace(/\/+$/, "");
  const slash = pathPart.indexOf("/");
  if (slash < 0) {
    return void 0;
  }
  const owner = pathPart.slice(0, slash);
  const repo = pathPart.slice(slash + 1);
  const kind = host.includes("github") ? "github" : host.includes("gitlab") ? "gitlab" : host.includes("bitbucket") ? "bitbucket" : "other";
  return {
    webBase: `https://${host}/${pathPart}`,
    host: kind,
    owner,
    repo
  };
}
async function getCurrentBranch(folder2) {
  const head = await readText(Uri.joinPath(folder2.uri, ".git", "HEAD"));
  if (!head) {
    return void 0;
  }
  const ref = /ref:\s*refs\/heads\/(.+)/.exec(head.trim());
  return ref ? ref[1].trim() : void 0;
}

// src/recipes/detectorHelpers.ts
async function readText2(folder2, ...segments) {
  try {
    const bytes = await workspace.fs.readFile(
      Uri.joinPath(folder2.uri, ...segments)
    );
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return void 0;
  }
}
async function exists(folder2, ...segments) {
  try {
    await workspace.fs.stat(Uri.joinPath(folder2.uri, ...segments));
    return true;
  } catch {
    return false;
  }
}
async function readJson(folder2, name) {
  const text = await readText2(folder2, name);
  if (!text) {
    return void 0;
  }
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function shell(folder2, commandLine) {
  return {
    kind: "shell",
    shellCommand: commandLine,
    cwd: folder2.uri.fsPath,
    useIntegratedTerminal: true
  };
}
function url(target) {
  return { kind: "url", url: target };
}
async function packageManager(folder2) {
  if (await exists(folder2, "pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (await exists(folder2, "yarn.lock")) {
    return "yarn";
  }
  if (await exists(folder2, "bun.lockb")) {
    return "bun";
  }
  return "npm";
}
function branchUrl(r, branch) {
  return r.host === "gitlab" ? `${r.webBase}/-/tree/${branch}` : `${r.webBase}/tree/${branch}`;
}
function compareUrl(r, branch) {
  switch (r.host) {
    case "gitlab":
      return `${r.webBase}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${branch}`;
    case "bitbucket":
      return `${r.webBase}/pull-requests/new?source=${branch}`;
    default:
      return `${r.webBase}/compare/${branch}?expand=1`;
  }
}
function commitsUrl(r, branch) {
  switch (r.host) {
    case "gitlab":
      return `${r.webBase}/-/commits/${branch}`;
    case "bitbucket":
      return `${r.webBase}/commits`;
    default:
      return `${r.webBase}/commits/${branch}`;
  }
}
function issuesUrl(r) {
  return r.host === "gitlab" ? `${r.webBase}/-/issues` : `${r.webBase}/issues`;
}
function ciUrl(r) {
  switch (r.host) {
    case "gitlab":
      return `${r.webBase}/-/pipelines`;
    case "bitbucket":
      return `${r.webBase}/addon/pipelines/home`;
    default:
      return `${r.webBase}/actions`;
  }
}
async function firstExisting(folder2, names) {
  for (const name of names) {
    if (await exists(folder2, name)) {
      return name;
    }
  }
  return void 0;
}
function hostName(r) {
  switch (r.host) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    default:
      return "the remote";
  }
}
function nameFromYaml(text) {
  if (!text) {
    return void 0;
  }
  const m = /^name:\s*(\S+)/m.exec(text);
  return m ? m[1].replace(/['"]/g, "") : void 0;
}
function nameFromToml(text) {
  if (!text) {
    return void 0;
  }
  const m = /name\s*=\s*["']([^"']+)["']/.exec(text);
  return m ? m[1] : void 0;
}

// src/recipes/detectorEcosystem.ts
async function detectDevCommand(folder2, pkg) {
  const scripts = pkg?.scripts ?? {};
  const pm = await packageManager(folder2);
  if (scripts.dev) {
    return `${pm} run dev`;
  }
  if (scripts.start) {
    return `${pm} start`;
  }
  if (await exists(folder2, "manage.py")) {
    return "python manage.py runserver";
  }
  if (await exists(folder2, "pubspec.yaml")) {
    const text = await readText2(folder2, "pubspec.yaml") ?? "";
    if (/(\n|^)\s*flutter:/.test(text)) {
      return "flutter run";
    }
  }
  return void 0;
}
async function detectMigrate(folder2, pkg) {
  if (await exists(folder2, "prisma", "schema.prisma")) {
    const pm = await packageManager(folder2);
    return `${pm} exec prisma migrate dev`;
  }
  if (await exists(folder2, "alembic.ini") || await exists(folder2, "migrations", "env.py")) {
    return "alembic upgrade head";
  }
  if (pkg && /drizzle/.test(JSON.stringify(pkg.devDependencies ?? {}) + JSON.stringify(pkg.dependencies ?? {}))) {
    const pm = await packageManager(folder2);
    return `${pm} exec drizzle-kit migrate`;
  }
  if (await exists(folder2, "bin", "rails")) {
    return "bin/rails db:migrate";
  }
  return void 0;
}
async function detectEntryPoint(folder2, pkg) {
  const candidates = [];
  if (pkg) {
    if (typeof pkg.main === "string") {
      candidates.push(pkg.main);
    }
    if (typeof pkg.module === "string") {
      candidates.push(pkg.module);
    }
  }
  candidates.push(
    "lib/main.dart",
    "src/main.rs",
    "src/main.ts",
    "src/index.ts",
    "src/main.py",
    "main.go",
    "main.py"
  );
  for (const candidate of candidates) {
    if (await exists(folder2, ...candidate.split("/"))) {
      return candidate;
    }
  }
  return void 0;
}
async function detectPort(folder2, pkg) {
  for (const envFile of [".env", ".env.example"]) {
    const text = await readText2(folder2, envFile);
    const m = text ? /^\s*PORT\s*=\s*(\d{2,5})/m.exec(text) : null;
    if (m) {
      return Number(m[1]);
    }
  }
  for (const cfg of ["vite.config.ts", "vite.config.js", "vite.config.mjs"]) {
    const text = await readText2(folder2, cfg);
    const m = text ? /port\s*:\s*(\d{2,5})/.exec(text) : null;
    if (m) {
      return Number(m[1]);
    }
  }
  for (const cfg of ["docker-compose.yml", "compose.yaml"]) {
    const text = await readText2(folder2, cfg);
    const m = text ? /-\s*["']?(\d{2,5}):\d{2,5}/.exec(text) : null;
    if (m) {
      return Number(m[1]);
    }
  }
  const scripts = pkg?.scripts ?? {};
  if (scripts.dev || scripts.start) {
    return 3e3;
  }
  return void 0;
}
async function hasEslint(folder2, pkg) {
  if (pkg && "eslintConfig" in pkg) {
    return true;
  }
  for (const name of [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs"
  ]) {
    if (await exists(folder2, name)) {
      return true;
    }
  }
  return false;
}
async function hasPrettier(folder2, pkg) {
  if (pkg && "prettier" in pkg) {
    return true;
  }
  for (const name of [
    ".prettierrc",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.json",
    ".prettierrc.yml",
    ".prettierrc.yaml",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs"
  ]) {
    if (await exists(folder2, name)) {
      return true;
    }
  }
  return false;
}
async function hasVersionSource(folder2, pkg) {
  if (pkg && typeof pkg.version === "string") {
    return true;
  }
  return await exists(folder2, "pubspec.yaml") || await exists(folder2, "Cargo.toml") || await exists(folder2, "pyproject.toml");
}

// src/recipes/detectorRunTargets.ts
async function pushRunTargets(folder2, pkg, out) {
  const pm = await packageManager(folder2);
  const scripts = pkg?.scripts ?? {};
  const isDart = await exists(folder2, "pubspec.yaml");
  const isFlutter = isDart && /(\n|^)\s*flutter:/.test(await readText2(folder2, "pubspec.yaml") ?? "");
  const isGo = await exists(folder2, "go.mod");
  const isRust = await exists(folder2, "Cargo.toml");
  const isPy = await exists(folder2, "pyproject.toml") || await exists(folder2, "requirements.txt");
  const dev = await detectDevCommand(folder2, pkg);
  if (dev) {
    out.push({ recipeId: "dev", label: "Start dev server", description: `Runs the project's dev/watch command (${dev}). Detected from package.json scripts.dev/start, a Django manage.py, or a Flutter project.`, icon: "debug-start", color: "charts.green", action: shell(folder2, dev) });
  }
  const test2 = scripts.test ? `${pm} test` : isDart ? "dart test" : isGo ? "go test ./..." : isRust ? "cargo test" : isPy ? "pytest" : void 0;
  if (test2) {
    out.push({ recipeId: "test", label: "Run tests", description: `Runs the project's test suite (${test2}). Detected from the test runner for the ecosystem (npm test, dart test, go test, cargo test, pytest).`, icon: "beaker", action: shell(folder2, test2) });
  }
  const lint = await hasEslint(folder2, pkg) ? `${pm} exec eslint .` : isDart ? isFlutter ? "flutter analyze" : "dart analyze" : await exists(folder2, ".golangci.yml") || await exists(folder2, ".golangci.yaml") ? "golangci-lint run" : isRust ? "cargo clippy" : isPy && (await exists(folder2, "ruff.toml") || /\[tool\.ruff\]/.test(await readText2(folder2, "pyproject.toml") ?? "")) ? "ruff check ." : void 0;
  if (lint) {
    out.push({ recipeId: "lint", label: "Lint", description: `Runs the project's linter (${lint}). Detected from the lint config for the ecosystem (eslint, dart/flutter analyze, golangci-lint, clippy, ruff).`, icon: "checklist", action: shell(folder2, lint) });
  }
  const build = scripts.build ? `${pm} run build` : isRust ? "cargo build" : isFlutter ? "flutter build" : await exists(folder2, "Makefile") && /(\n|^)build:/.test(await readText2(folder2, "Makefile") ?? "") ? "make build" : void 0;
  if (build) {
    out.push({ recipeId: "build", label: "Build", description: `Runs the project's build command (${build}). Detected from package.json scripts.build, a Makefile build target, cargo, or flutter.`, icon: "tools", action: shell(folder2, build) });
  }
  const install = pkg ? `${pm} install` : await exists(folder2, "poetry.lock") ? "poetry install" : await exists(folder2, "requirements.txt") ? "pip install -r requirements.txt" : isFlutter ? "flutter pub get" : isDart ? "dart pub get" : isGo ? "go mod download" : isRust ? "cargo fetch" : void 0;
  if (install) {
    out.push({ recipeId: "install", label: "Install dependencies", description: `Installs the project's dependencies (${install}). Detected from the lockfile / manifest for the ecosystem (npm/pnpm/yarn/bun, poetry/pip, pub, go, cargo).`, icon: "cloud-download", action: shell(folder2, install) });
  }
  if (await exists(folder2, "tsconfig.json")) {
    out.push({ recipeId: "typecheck", label: "Type-check", description: "Runs the TypeScript type checker (tsc --noEmit). Detected from a tsconfig.json in the folder root.", icon: "symbol-type", action: shell(folder2, `${pm} exec tsc --noEmit`) });
  } else if (isPy && (await exists(folder2, "mypy.ini") || /\[tool\.mypy\]/.test(await readText2(folder2, "pyproject.toml") ?? ""))) {
    out.push({ recipeId: "typecheck", label: "Type-check", description: "Runs the Python type checker (mypy). Detected from mypy.ini or a [tool.mypy] section in pyproject.toml.", icon: "symbol-type", action: shell(folder2, "mypy .") });
  }
  if (await exists(folder2, "docker-compose.yml") || await exists(folder2, "compose.yaml")) {
    out.push({ recipeId: "compose.up", label: "Docker compose up", description: "Brings the Docker Compose stack up (docker compose up). Detected from a docker-compose.yml or compose.yaml in the folder root.", icon: "server-environment", action: shell(folder2, "docker compose up") });
  }
  const migrate = await detectMigrate(folder2, pkg);
  if (migrate) {
    out.push({ recipeId: "db.migrate", label: "Run database migration", description: `Runs the database migration (${migrate}). Detected from Prisma, Alembic, Drizzle, or Rails markers.`, icon: "database", action: shell(folder2, migrate) });
  }
  const ruffConfigured = isPy && (await exists(folder2, "ruff.toml") || /\[tool\.ruff\]/.test(await readText2(folder2, "pyproject.toml") ?? ""));
  const blackConfigured = isPy && /\[tool\.black\]/.test(await readText2(folder2, "pyproject.toml") ?? "");
  const format = await hasPrettier(folder2, pkg) ? `${pm} exec prettier --write .` : isDart ? "dart format ." : isRust ? "cargo fmt" : isGo ? "gofmt -w ." : ruffConfigured ? "ruff format ." : blackConfigured ? "black ." : void 0;
  if (format) {
    out.push({ recipeId: "format", label: "Format code", description: `Rewrites the project's source to its canonical style (${format}). Distinct from lint \u2014 this reformats rather than reports. Detected from the formatter config for the ecosystem (prettier, dart format, cargo fmt, gofmt, ruff/black).`, icon: "symbol-color", action: shell(folder2, format) });
  }
  const clean = isFlutter ? "flutter clean" : isRust ? "cargo clean" : isGo ? "go clean" : scripts.clean ? `${pm} run clean` : void 0;
  if (clean) {
    out.push({ recipeId: "clean", label: "Clean build artifacts", description: `Removes the project's build output so the next build starts fresh (${clean}). Detected from flutter, cargo, go, or a package.json clean script.`, icon: "trash", action: shell(folder2, clean) });
  }
  const upgrade = pkg ? `${pm} update` : isFlutter ? "flutter pub upgrade" : isDart ? "dart pub upgrade" : isRust ? "cargo update" : isGo ? "go get -u ./... && go mod tidy" : void 0;
  if (upgrade) {
    out.push({ recipeId: "upgrade", label: "Upgrade dependencies", description: `Moves the project's dependencies to newer versions (${upgrade}). Distinct from install, which only restores the locked versions. Detected from the manifest for the ecosystem (npm, pub, cargo, go).`, icon: "arrow-up", action: shell(folder2, upgrade) });
  }
}

// src/recipes/detectors.ts
async function detectOnDemandRecipes(folder2) {
  const out = [];
  const pkg = await readJson(folder2, "package.json");
  const remote = await getGitRemote(folder2);
  if (remote) {
    out.push({
      recipeId: "github.home",
      label: `Open ${remote.repo} on ${hostName(remote)}`,
      description: `Opens the repository home page on ${hostName(remote)}. Derived from the origin remote in .git/config, so it is correct per clone without hand-typing a URL.`,
      icon: "github",
      color: "charts.purple",
      action: url(remote.webBase)
    });
    const branch = await getCurrentBranch(folder2);
    if (branch) {
      out.push({
        recipeId: "github.branch",
        label: `Open branch ${branch}`,
        description: `Opens the current branch (${branch}) on the remote's web view. Derived from the origin remote and the checked-out HEAD.`,
        icon: "git-branch",
        action: url(branchUrl(remote, branch))
      });
      out.push({
        recipeId: "github.pr",
        label: `Open a pull request for ${branch}`,
        description: `Opens the "new pull request / merge request" page pre-filled with the current branch (${branch}). Derived from the origin remote and HEAD.`,
        icon: "git-pull-request",
        action: url(compareUrl(remote, branch))
      });
      out.push({
        recipeId: "github.commits",
        label: `Open commit history for ${branch}`,
        description: `Opens the commit history for the current branch (${branch}) on the remote's web view. Host-aware, derived from the origin remote and HEAD.`,
        icon: "git-commit",
        action: url(commitsUrl(remote, branch))
      });
    }
    out.push({
      recipeId: "github.issues",
      label: "Open Issues",
      description: "Opens the project's issue tracker on the remote. Derived from the origin remote in .git/config.",
      icon: "issues",
      action: url(issuesUrl(remote))
    });
    out.push({
      recipeId: "ci",
      label: remote.host === "gitlab" ? "Open Pipelines" : "Open CI / Actions",
      description: remote.host === "gitlab" ? "Opens the GitLab pipelines page for this project. Host-aware, derived from the origin remote." : "Opens the CI / Actions page for this project. Host-aware (GitHub Actions / GitLab pipelines), derived from the origin remote.",
      icon: "pulse",
      action: url(ciUrl(remote))
    });
    if (remote.host === "github" || remote.host === "gitlab") {
      out.push({
        recipeId: "releases",
        label: "Open Releases",
        description: "Opens the releases page on the remote. Derived from the origin remote in .git/config.",
        icon: "tag",
        action: url(
          remote.host === "gitlab" ? `${remote.webBase}/-/releases` : `${remote.webBase}/releases`
        )
      });
    }
  }
  const homepage = pkg && typeof pkg.homepage === "string" ? pkg.homepage : void 0;
  if (homepage && /^https?:\/\//i.test(homepage)) {
    out.push({
      recipeId: "deployed",
      label: "Open the deployed site",
      description: "Opens the live deployed site. Detected from the package.json homepage field (an http(s) URL).",
      icon: "globe",
      color: "charts.blue",
      action: url(homepage)
    });
  }
  if (pkg && typeof pkg.name === "string") {
    const name = pkg.name;
    const publisher = typeof pkg.publisher === "string" ? pkg.publisher : void 0;
    if (publisher) {
      out.push({
        recipeId: "store",
        label: "Open the Marketplace listing",
        description: "Opens this extension's Visual Studio Marketplace page. Detected from the package.json publisher and name.",
        icon: "extensions",
        action: url(
          `https://marketplace.visualstudio.com/items?itemName=${publisher}.${name}`
        )
      });
    } else if (pkg.private !== true) {
      out.push({
        recipeId: "registry",
        label: "Open the npm package page",
        description: "Opens this package's page on npm. Detected from the package.json name (only when the package is not marked private).",
        icon: "package",
        action: url(`https://www.npmjs.com/package/${name}`)
      });
    }
  }
  const pubName = nameFromYaml(await readText2(folder2, "pubspec.yaml"));
  if (pubName) {
    out.push({
      recipeId: "registry.pub",
      label: "Open the pub.dev page",
      description: "Opens this package's page on pub.dev. Detected from the name field in pubspec.yaml.",
      icon: "package",
      action: url(`https://pub.dev/packages/${pubName}`)
    });
  }
  const pyName = nameFromToml(await readText2(folder2, "pyproject.toml"));
  if (pyName) {
    out.push({
      recipeId: "registry.pypi",
      label: "Open the PyPI page",
      description: "Opens this project's page on PyPI. Detected from the name in pyproject.toml.",
      icon: "package",
      action: url(`https://pypi.org/project/${pyName}`)
    });
  }
  const mkdocs = await readText2(folder2, "mkdocs.yml");
  const siteUrl = mkdocs ? /site_url:\s*(\S+)/.exec(mkdocs)?.[1] : void 0;
  if (siteUrl) {
    out.push({
      recipeId: "docs",
      label: "Open the docs site",
      description: "Opens the project's documentation site. Detected from the site_url field in mkdocs.yml.",
      icon: "book",
      action: url(siteUrl.replace(/['"]/g, ""))
    });
  }
  await pushRunTargets(folder2, pkg, out);
  const entry = await detectEntryPoint(folder2, pkg);
  if (entry) {
    out.push({
      recipeId: "entry",
      label: "Open the entry point",
      description: `Opens the application's entry file (${entry}). Detected from the package.json main/module, or the conventional entry path for the project's language.`,
      icon: "symbol-event",
      filePath: entry
    });
  }
  const docPins = [
    {
      recipeId: "doc.readme",
      label: "Open the README",
      description: "Opens the project's README. Detected from a README file at the folder root.",
      icon: "book",
      names: ["README.md", "readme.md", "README"]
    },
    {
      recipeId: "doc.changelog",
      label: "Open the CHANGELOG",
      description: "Opens the project's changelog. Detected from a CHANGELOG file at the folder root.",
      icon: "history",
      names: ["CHANGELOG.md", "changelog.md", "CHANGELOG"]
    },
    {
      recipeId: "doc.license",
      label: "Open the LICENSE",
      description: "Opens the project's license. Detected from a LICENSE file at the folder root.",
      icon: "law",
      names: ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"]
    },
    {
      recipeId: "doc.contributing",
      label: "Open the contributing guide",
      description: "Opens the project's contributing guide. Detected from a CONTRIBUTING file at the folder root.",
      icon: "organization",
      names: ["CONTRIBUTING.md", "contributing.md", "CONTRIBUTING"]
    }
  ];
  for (const doc of docPins) {
    const found = await firstExisting(folder2, doc.names);
    if (found) {
      out.push({
        recipeId: doc.recipeId,
        label: doc.label,
        description: doc.description,
        icon: doc.icon,
        filePath: found
      });
    }
  }
  if (await exists(folder2, ".env.example") && !await exists(folder2, ".env")) {
    out.push({
      recipeId: "env.setup",
      label: "Set up your .env",
      description: "Copies .env.example to a new .env (never overwriting an existing one), then opens it. Offered only when .env.example is present and .env is missing.",
      icon: "gear",
      action: {
        kind: "command",
        commandId: "saropaWorkspace.recipe.setupEnv",
        commandArgs: [folder2.uri.fsPath]
      }
    });
  }
  out.push({
    recipeId: "config.open",
    label: "Open all config files",
    description: "Opens every recognized config file present in the folder root (tsconfig, eslint, prettier, analysis_options, vite, Makefile, docker-compose, and more) in one action.",
    icon: "settings-gear",
    action: {
      kind: "command",
      commandId: "saropaWorkspace.recipe.openConfigFiles",
      commandArgs: [folder2.uri.fsPath]
    }
  });
  const readme = await firstExisting(folder2, ["README.md", "readme.md", "README"]);
  const devCommand = await detectDevCommand(folder2, pkg);
  if (readme && devCommand) {
    const port2 = await detectPort(folder2, pkg);
    const steps = [
      { kind: "open", path: Uri.joinPath(folder2.uri, readme).fsPath },
      { kind: "shell", shellCommand: devCommand, cwd: folder2.uri.fsPath }
    ];
    if (port2) {
      steps.push({ kind: "url", url: `http://localhost:${port2}` });
    }
    out.push({
      recipeId: "boot",
      label: "Start working (boot sequence)",
      description: "A macro that opens the README, starts the dev server, and (when a port is known) opens localhost \u2014 one action to bring the project up. Detected from the README plus the project's dev command.",
      icon: "rocket",
      color: "charts.green",
      action: { kind: "macro", steps }
    });
  }
  const port = await detectPort(folder2, pkg);
  if (port) {
    out.push({
      recipeId: "localhost",
      label: `Open localhost:${port}`,
      description: `Opens http://localhost:${port} in the browser. Port detected from vite config, an .env PORT, docker-compose ports, or the framework default.`,
      icon: "browser",
      action: url(`http://localhost:${port}`)
    });
  }
  if (await hasVersionSource(folder2, pkg)) {
    out.push({
      recipeId: "copy.version",
      label: "Copy project name@version",
      description: "Writes the project's name@version to the clipboard with a confirming toast. Read from package.json, pubspec.yaml, Cargo.toml, or pyproject.toml.",
      icon: "tag",
      action: {
        kind: "command",
        commandId: "saropaWorkspace.recipe.copyVersion",
        commandArgs: [folder2.uri.fsPath]
      }
    });
  }
  if (pkg && pkg.scripts && typeof pkg.scripts === "object") {
    out.push({
      recipeId: "nearest.script",
      label: "Run a package script",
      description: "Finds the package.json nearest the active file, lists its scripts in a picker, and runs the chosen one in a terminal. Detected from a package.json carrying a scripts block.",
      icon: "play-circle",
      action: {
        kind: "command",
        commandId: "saropaWorkspace.recipe.runNearestScript",
        commandArgs: [folder2.uri.fsPath]
      }
    });
  }
  const RUN = /* @__PURE__ */ new Set([
    "dev",
    "test",
    "lint",
    "build",
    "install",
    "typecheck",
    "compose.up",
    "db.migrate",
    "nearest.script",
    "format",
    "clean",
    "upgrade"
  ]);
  const WORKSPACE = /* @__PURE__ */ new Set([
    "entry",
    "env.setup",
    "config.open",
    "boot",
    "copy.version"
  ]);
  for (const r of out) {
    r.group = RUN.has(r.recipeId) ? "run" : WORKSPACE.has(r.recipeId) ? "workspace" : "open";
  }
  return out;
}

// src/recipes/scheduledRecipes.ts
async function readText3(folder2, ...segments) {
  try {
    const bytes = await workspace.fs.readFile(
      Uri.joinPath(folder2.uri, ...segments)
    );
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return void 0;
  }
}
async function exists2(folder2, ...segments) {
  try {
    await workspace.fs.stat(Uri.joinPath(folder2.uri, ...segments));
    return true;
  } catch {
    return false;
  }
}
function daily(atTime) {
  return { atTime, enabled: false };
}
function report(folder2, command2, reportFile, autoOpen) {
  return {
    kind: "shell",
    shellCommand: command2,
    cwd: folder2.uri.fsPath,
    reportFile,
    autoOpen
  };
}
async function detectScheduledRecipes(folder2) {
  const out = [];
  const isGit = await exists2(folder2, ".git");
  const linter = await detectLinter(folder2);
  if (linter) {
    out.push({
      recipeId: "ritual.lint",
      label: "Dawn lint sweep",
      description: "Scheduled (daily, default 05:00): runs the project's linter unattended into a background channel and writes a dated report under reports/, so the project's health is known before the day starts. Seeds disabled \u2014 enable it by promoting the recipe to a stored pin. Detected from the analyzer/linter config for the ecosystem.",
      icon: "checklist",
      color: "charts.yellow",
      schedule: daily("05:00"),
      action: report(folder2, linter, "reports/$stamp_lint.txt", false)
    });
  }
  if (isGit) {
    out.push({
      recipeId: "ritual.stats",
      label: "Sunrise project stats",
      description: "Scheduled (daily, default 06:00): writes and opens a dated report breaking the tracked codebase down by language (files, lines, and each language's share) alongside recent commits and the contributor shortlog \u2014 a dashboard waiting each morning. Seeds disabled. Detected from a git repository.",
      icon: "dashboard",
      color: "charts.blue",
      schedule: daily("06:00"),
      action: {
        kind: "command",
        commandId: "saropaWorkspace.recipe.projectStats",
        commandArgs: [folder2.uri.fsPath]
      }
    });
    out.push({
      recipeId: "ritual.standup",
      label: "Standup digest (since yesterday)",
      description: "Scheduled (daily, default 08:30): writes and opens a dated report of your commits and touched files from the last 24 hours \u2014 your standup, pre-written. Seeds disabled. Detected from a git repository.",
      icon: "comment-discussion",
      schedule: daily("08:30"),
      action: report(
        folder2,
        'git log --since="24 hours ago" --oneline --stat',
        "reports/$stamp_standup.md",
        true
      )
    });
    out.push({
      recipeId: "ritual.eod",
      label: "End-of-day uncommitted guard",
      description: "Scheduled (daily, default 18:00): writes and opens a dated summary of every uncommitted / untracked file so nothing is lost overnight. Seeds disabled. Detected from a git repository.",
      icon: "warning",
      color: "charts.orange",
      schedule: daily("18:00"),
      action: report(
        folder2,
        "git status --branch --porcelain=v1",
        "reports/$stamp_uncommitted.md",
        true
      )
    });
    out.push({
      recipeId: "ritual.debt",
      label: "Tech-debt harvest",
      description: "Scheduled (daily, default 16:00): scans tracked files for TODO / FIXME / HACK / XXX markers and writes an opened, dated report \u2014 debt you can see growing or shrinking. Seeds disabled. Detected from a git repository.",
      icon: "flame",
      schedule: daily("16:00"),
      action: report(
        folder2,
        'git grep -n -E "TODO|FIXME|HACK|XXX"',
        "reports/$stamp_debt.md",
        true
      )
    });
    out.push({
      recipeId: "ritual.branches",
      label: "Branch hygiene",
      description: "Scheduled (daily, default 09:00): writes a dated report of local branches already merged into the default branch (safe to delete) and their tracking state \u2014 nothing is deleted automatically. Seeds disabled. Detected from a git repository.",
      icon: "git-branch",
      schedule: daily("09:00"),
      action: report(
        folder2,
        "git branch --merged && git branch -vv",
        "reports/$stamp_branches.md",
        false
      )
    });
    out.push({
      recipeId: "ritual.journal",
      label: "Dev journal",
      description: "Scheduled (daily, default 17:30): appends today's commits and touched files to a running journal under reports/ \u2014 an effortless, durable record of what shipped. Seeds disabled. Detected from a git repository.",
      icon: "book",
      schedule: daily("17:30"),
      action: report(
        folder2,
        'git log --since="00:00" --oneline --stat',
        "reports/$stamp_journal.md",
        false
      )
    });
  }
  const deps = await detectOutdated(folder2);
  if (deps) {
    out.push({
      recipeId: "ritual.deps",
      label: "Dependency freshness",
      description: "Scheduled (daily, default 07:00): writes a dated report of what is behind latest plus the audit/advisory summary for the ecosystem \u2014 the staleness and security picture in one file. Seeds disabled. Detected from the lockfile / manifest.",
      icon: "cloud-download",
      schedule: daily("07:00"),
      action: report(folder2, deps, "reports/$stamp_deps.md", false)
    });
  }
  const test2 = await detectTest(folder2);
  if (test2) {
    out.push({
      recipeId: "ritual.tests",
      label: "Test trend tracker",
      description: "Scheduled (daily, default 05:30): runs the test suite unattended into a channel and writes a dated report under reports/. Seeds disabled. Detected from the project's test runner.",
      icon: "beaker",
      schedule: daily("05:30"),
      action: report(folder2, test2, "reports/$stamp_tests.txt", false)
    });
  }
  const remote = await getGitRemote(folder2);
  if (remote?.host === "github") {
    out.push({
      recipeId: "ritual.prs",
      label: "PR review queue",
      description: "Scheduled (daily, default 09:00): writes and opens a dated report of the PRs awaiting your review, so the queue finds you. Requires the gh CLI. Seeds disabled. Detected from a GitHub remote.",
      icon: "git-pull-request",
      schedule: daily("09:00"),
      action: report(
        folder2,
        'gh pr list --search "review-requested:@me" --state open',
        "reports/$stamp_prs.md",
        true
      )
    });
  }
  for (const r of out) {
    r.group = "scheduled";
  }
  return out;
}
async function detectLinter(folder2) {
  const analysis = await readText3(folder2, "analysis_options.yaml");
  if (analysis !== void 0) {
    const isFlutter = (await readText3(folder2, "pubspec.yaml"))?.match(/(\n|^)\s*flutter:/);
    const usesCustomLint = /custom_lint|saropa_lints/.test(analysis);
    const base = isFlutter ? "flutter analyze" : "dart analyze";
    return usesCustomLint ? `${base} && dart run custom_lint` : base;
  }
  if (await hasAny(folder2, [".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs"])) {
    return "npx eslint .";
  }
  if (await exists2(folder2, "ruff.toml") || /\[tool\.ruff\]/.test(await readText3(folder2, "pyproject.toml") ?? "")) {
    return "ruff check .";
  }
  if (await exists2(folder2, ".golangci.yml") || await exists2(folder2, ".golangci.yaml")) {
    return "golangci-lint run";
  }
  if (await exists2(folder2, "Cargo.toml")) {
    return "cargo clippy";
  }
  return void 0;
}
async function detectTest(folder2) {
  const pkg = await readText3(folder2, "package.json");
  if (pkg && /"test"\s*:/.test(pkg)) {
    return "npm test";
  }
  if (await exists2(folder2, "pubspec.yaml")) {
    return "dart test";
  }
  if (await exists2(folder2, "Cargo.toml")) {
    return "cargo test";
  }
  if (await exists2(folder2, "go.mod")) {
    return "go test ./...";
  }
  if (await exists2(folder2, "pyproject.toml") || await exists2(folder2, "pytest.ini")) {
    return "pytest";
  }
  return void 0;
}
async function detectOutdated(folder2) {
  if (await exists2(folder2, "package.json")) {
    return "npm outdated; npm audit";
  }
  if (await exists2(folder2, "pubspec.yaml")) {
    return "dart pub outdated";
  }
  if (await exists2(folder2, "requirements.txt") || await exists2(folder2, "pyproject.toml")) {
    return "pip list --outdated";
  }
  if (await exists2(folder2, "Cargo.toml")) {
    return "cargo outdated";
  }
  if (await exists2(folder2, "go.mod")) {
    return "go list -u -m all";
  }
  return void 0;
}
async function hasAny(folder2, names) {
  for (const name of names) {
    if (await exists2(folder2, name)) {
      return true;
    }
  }
  return false;
}

// src/recipes/suiteRecipes.ts
var LINTS_EXT = "saropa.saropa-lints";
var DRIFT_EXT = "saropa.drift-viewer";
var LOG_EXT = "saropa.saropa-log-capture";
var SUB_LINTS = "lints";
var SUB_DRIFT = "drift";
var SUB_LOG = "log";
async function readText4(folder2, ...segments) {
  try {
    const bytes = await workspace.fs.readFile(
      Uri.joinPath(folder2.uri, ...segments)
    );
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return void 0;
  }
}
async function exists3(folder2, ...segments) {
  try {
    await workspace.fs.stat(Uri.joinPath(folder2.uri, ...segments));
    return true;
  } catch {
    return false;
  }
}
function extensionInstalled(id) {
  return extensions.getExtension(id) !== void 0;
}
function command(commandId) {
  return { kind: "command", commandId };
}
function url2(target) {
  return { kind: "url", url: target };
}
function shell2(folder2, commandLine) {
  return {
    kind: "shell",
    shellCommand: commandLine,
    cwd: folder2.uri.fsPath,
    useIntegratedTerminal: true
  };
}
async function detectSuiteRecipes(folder2) {
  const out = [];
  await pushLints(folder2, out);
  await pushDrift(folder2, out);
  await pushLogCapture(folder2, out);
  pushSuiteMacro(out);
  return out;
}
function pushSuiteMacro(out) {
  const bootSteps = [
    {
      proof: "suite.drift.browser",
      step: { kind: "command", label: "Open Drift Advisor", commandId: "driftViewer.openInBrowser" }
    },
    {
      proof: "suite.lints.analysis",
      step: { kind: "command", label: "Run lint analysis", commandId: "saropaLints.runAnalysis" }
    },
    {
      proof: "suite.log.open",
      step: { kind: "command", label: "Open a capture log", commandId: "saropaLogCapture.openLogFile" }
    }
  ];
  const seeded = new Set(out.map((r) => r.recipeId));
  const steps = bootSteps.filter((b) => seeded.has(b.proof)).map((b) => b.step);
  if (steps.length < 2) {
    return;
  }
  out.push({
    recipeId: "suite.boot",
    label: "Boot the Saropa suite",
    description: "A macro that brings every detected Saropa Suite tool up in one action \u2014 opening the Drift Advisor inspector, running a Saropa Lints analysis, and opening a capture log, for whichever tools are installed. Offered only when two or more suite tools are detected.",
    icon: "rocket",
    color: "charts.green",
    group: "suite",
    action: { kind: "macro", steps }
  });
}
async function pushLints(folder2, out) {
  const pubspec = await readText4(folder2, "pubspec.yaml") ?? "";
  const analysis = await readText4(folder2, "analysis_options.yaml") ?? "";
  const violationsPath = ".saropa_lints/violations.json";
  const hasViolations = await exists3(folder2, "reports", ".saropa_lints", "violations.json");
  const hasPackage = /saropa_lints/.test(pubspec) || /saropa_lints/.test(analysis) || hasViolations;
  const hasExt = extensionInstalled(LINTS_EXT);
  if (!hasPackage && !hasExt) {
    return;
  }
  const color2 = "charts.blue";
  if (hasExt) {
    out.push(suite("suite.lints.score", "Show Code Health score", "Reads the Saropa Lints public API and reports the exact 0-100 Code Health score with its error/warning/info breakdown \u2014 no report file to open. Offers to run the analysis first if no data exists yet. From the saropa.saropa-lints extension.", "pulse", color2, command("saropaWorkspace.recipe.lintsHealth"), SUB_LINTS));
    out.push(suite("suite.lints.analysis", "Run lint analysis", "Runs Saropa Lints analysis and writes the violations report. From the saropa.saropa-lints extension.", "checklist", color2, command("saropaLints.runAnalysis"), SUB_LINTS));
    out.push(suite("suite.lints.health", "Open Code Health dashboard", "Opens the Saropa Lints Code Health (project vibrancy) dashboard. From the saropa.saropa-lints extension.", "graph", color2, command("saropaLints.openProjectVibrancyReport"), SUB_LINTS));
    out.push(suite("suite.lints.config", "Manage rule packs", "Opens the Saropa Lints config dashboard to manage rule packs. From the saropa.saropa-lints extension.", "settings-gear", color2, command("saropaLints.openConfigDashboard"), SUB_LINTS));
    out.push(suite("suite.lints.packages", "Open Package Vibrancy", "Opens the Saropa Lints Package Vibrancy view. From the saropa.saropa-lints extension.", "package", color2, command("saropaLints.openPackageVibrancy"), SUB_LINTS));
    out.push(suite("suite.lints.owasp", "Export OWASP report", "Exports a Saropa Lints OWASP report. From the saropa.saropa-lints extension.", "shield", color2, command("saropaLints.exportOwaspReport"), SUB_LINTS));
  }
  if (hasPackage) {
    out.push(suite("suite.lints.crossfile", "Lints: cross-file audit", "Runs the Saropa Lints cross-file audit CLI, producing an HTML report under reports/. Detected from saropa_lints in the project.", "references", color2, shell2(folder2, "dart run saropa_lints:cross_file report"), SUB_LINTS));
    out.push(suite("suite.lints.baseline", "Lints: refresh baseline", "Refreshes the Saropa Lints baseline so existing violations are suppressed going forward. Detected from saropa_lints in the project.", "history", color2, shell2(folder2, "dart run saropa_lints:baseline --update"), SUB_LINTS));
    out.push(suite("suite.lints.gate", "Lints: quality gate", "Runs the Saropa Lints CI-style quality gate against the violations report. Detected from saropa_lints in the project.", "pass", color2, shell2(folder2, `dart run saropa_lints:quality_gate --report reports/${violationsPath}`), SUB_LINTS));
  }
  if (hasViolations) {
    out.push({
      recipeId: "suite.lints.violations",
      label: "Open the violations report",
      description: "Opens the Saropa Lints violations report file. Offered only once the report has been written under reports/.saropa_lints/.",
      icon: "warning",
      color: color2,
      group: "suite",
      subGroup: SUB_LINTS,
      filePath: `reports/${violationsPath}`
    });
  }
}
async function pushDrift(folder2, out) {
  const pubspec = await readText4(folder2, "pubspec.yaml") ?? "";
  const hasPackage = /saropa_drift_advisor/.test(pubspec);
  const hasExt = extensionInstalled(DRIFT_EXT);
  if (!hasPackage && !hasExt) {
    return;
  }
  const color2 = "charts.purple";
  if (hasExt) {
    out.push(suite("suite.drift.browser", "Open Drift Advisor (browser)", "Opens the Drift Advisor DB inspector in the browser. Pairs with an active debug session (server on 8642). From the saropa.drift-viewer extension.", "browser", color2, command("driftViewer.openInBrowser"), SUB_DRIFT));
    out.push(suite("suite.drift.sql", "Open the SQL Notebook", "Opens the Drift Advisor SQL notebook. From the saropa.drift-viewer extension.", "notebook", color2, command("driftViewer.openSqlNotebook"), SUB_DRIFT));
    out.push(suite("suite.drift.scan", "Scan Dart schema (offline)", "Scans the Dart schema definitions offline \u2014 no running app needed. From the saropa.drift-viewer extension.", "search", color2, command("driftViewer.scanDartSchemaDefinitions"), SUB_DRIFT));
    out.push(suite("suite.drift.diagram", "Open the schema diagram", "Opens the Drift Advisor schema diagram. From the saropa.drift-viewer extension.", "type-hierarchy", color2, command("driftViewer.schemaDiagram"), SUB_DRIFT));
    out.push(suite("suite.drift.report", "Export a portable DB report", "Exports a portable Drift Advisor DB report. From the saropa.drift-viewer extension.", "output", color2, command("driftViewer.exportReport"), SUB_DRIFT));
    out.push(suite("suite.drift.forward", "Forward the emulator port", "Forwards the Android emulator port to the debug server (adb forward 8642). From the saropa.drift-viewer extension.", "plug", color2, command("driftViewer.forwardPortAndroid"), SUB_DRIFT));
  }
  if (hasPackage || hasExt) {
    out.push(suite("suite.drift.issues", "Open the DB issues feed", "Opens the Drift Advisor issues feed (index suggestions + anomalies as JSON) from the local debug server on 8642. Requires an active debug session.", "link-external", color2, url2("http://127.0.0.1:8642/api/issues"), SUB_DRIFT));
  }
}
async function pushLogCapture(folder2, out) {
  const hasExt = extensionInstalled(LOG_EXT);
  if (!hasExt) {
    return;
  }
  const color2 = "charts.orange";
  out.push(suite("suite.log.open", "Open a capture log", "Opens a Saropa Log Capture log file. From the saropa.saropa-log-capture extension.", "output", color2, command("saropaLogCapture.openLogFile"), SUB_LOG));
  out.push(suite("suite.log.search", "Search all logs", "Searches across all captured logs. From the saropa.saropa-log-capture extension.", "search", color2, command("saropaLogCapture.searchLogs"), SUB_LOG));
  out.push(suite("suite.log.flowmap", "Export a session Flow Map", "Exports a Flow Map for a capture session. From the saropa.saropa-log-capture extension.", "git-merge", color2, command("saropaLogCapture.exportFlowMap"), SUB_LOG));
  out.push(suite("suite.log.compare", "Compare two sessions", "Compares two capture sessions side by side. From the saropa.saropa-log-capture extension.", "diff", color2, command("saropaLogCapture.compareSessions"), SUB_LOG));
  out.push(suite("suite.log.signals", "Show the Signals panel", "Opens the Saropa Log Capture Signals panel. From the saropa.saropa-log-capture extension.", "lightbulb", color2, command("saropaLogCapture.showSignals"), SUB_LOG));
  out.push(suite("suite.log.start", "Start capture", "Starts a Saropa Log Capture session. From the saropa.saropa-log-capture extension.", "record", color2, command("saropaLogCapture.start"), SUB_LOG));
}
function suite(recipeId, label, description, icon, color2, action, subGroup) {
  return { recipeId, label, description, icon, color: color2, group: "suite", subGroup, action };
}

// src/recipes/processRecipes.ts
async function detectProcessRecipes(_folder) {
  return [
    {
      recipeId: "monitor.live",
      label: "Open the toolchain monitor",
      description: "Opens the live process monitor (the Saropa Dashboard): only your detected toolchain's processes \u2014 editor, language servers, AI agents, dev servers, shells \u2014 grouped per tool with a live CPU bar and total RAM, sorted by load so the hog leads. Expand a tool to see its PIDs; end a single runaway with a confirm-gated End task. CPU is a two-sample live delta, not cumulative CPU time.",
      icon: "pulse",
      color: "charts.red",
      group: "monitor",
      action: { kind: "command", commandId: "saropaWorkspace.openProcessMonitor" }
    },
    {
      recipeId: "monitor.snapshot",
      label: "Snapshot the toolchain",
      description: "Writes the grouped toolchain process table to a dated report under reports/ and opens it \u2014 a shareable record of what was resident and how hard it was working, to attach to a bug or a slow-machine report. The CPU column is a live two-sample delta (load right now), rolled up per tool with a per-PID breakdown.",
      icon: "device-desktop",
      color: "charts.red",
      group: "monitor",
      action: { kind: "command", commandId: "saropaWorkspace.recipe.snapshotProcesses" }
    }
  ];
}

// src/recipes/hygieneRecipes.ts
async function detectHygieneRecipes(_folder) {
  return [
    {
      recipeId: "hygiene.scan",
      label: "Scan for empty & oversized files",
      description: "Recursively crawls the project and reports outliers at the extremes \u2014 empty (zero-byte files, zero-child folders) and oversized (files and folders past a size ceiling) \u2014 then writes a dated reports/<date>/<time>_filereport.json and raises a sticky notification naming the issue count with an Open report action. Mode, thresholds, .gitignore handling, and exclude globs are configurable under saropaWorkspace.hygiene; the built-in ignore set keeps the crawl out of node_modules / .git / build output.",
      icon: "search",
      color: "charts.blue",
      group: "workspace",
      action: { kind: "command", commandId: "saropaWorkspace.recipe.runHygieneScan" }
    },
    {
      // #63 "Workspace bloat scan": the directory-bloat half. VS Code crawls the whole
      // workspace on folder-open except node_modules / .git, so any immediate child
      // dir that has grown large and is not in files.watcherExclude pins a CPU core
      // and freezes the window. Seeds DISABLED at 04:45 (ahead of the 05:00 dawn lint)
      // so a bloated tree is caught before the heavier morning members.
      recipeId: "hygiene.bloat",
      label: "Workspace bloat scan",
      description: "Scheduled (daily, default 04:45, seeds disabled): measures the directories VS Code crawls on folder-open (each immediate child except node_modules / .git) and flags any past a size or file-count ceiling that is NOT in files.watcherExclude \u2014 the bloat that pins a CPU core and freezes the editor. Also flags a project that depends on @vscode/test-(electron|cli) but does not exclude **/.vscode-test/** (the test downloader grows that cache without bound). Writes reports/<stamp>_workspace_hygiene.md with the exact files.watcherExclude line to add; auto-opens and warns only when a finding crosses a ceiling, silent when clean. Offers Guard this project / Prune .vscode-test for the open workspace. Ceilings and an optional cross-project root list are configurable under saropaWorkspace.hygiene.",
      icon: "warning",
      color: "charts.orange",
      group: "scheduled",
      schedule: { atTime: "04:45", enabled: false },
      action: { kind: "command", commandId: "saropaWorkspace.recipe.runBloatScan" }
    }
  ];
}

// src/recipes/routineRecipes.ts
var MORNING_MEMBER_ORDER = [
  { recipeId: "hygiene.bloat", label: "Workspace bloat scan" },
  { recipeId: "ritual.lint", label: "Dawn lint sweep" },
  { recipeId: "ritual.stats", label: "Sunrise project stats" },
  { recipeId: "ritual.standup", label: "Standup digest" },
  { recipeId: "ritual.prs", label: "PR review queue" }
];
var MIN_MEMBERS = 2;
function detectRoutineRecipes(detected) {
  const present = new Set(detected.map((r) => r.recipeId));
  const members = MORNING_MEMBER_ORDER.filter(
    (m) => present.has(m.recipeId)
  ).map((m) => ({ recipeId: m.recipeId, label: m.label }));
  if (members.length < MIN_MEMBERS) {
    return [];
  }
  const memberNames = members.map((m) => m.label).join(", ");
  return [
    {
      recipeId: "routine.morning",
      label: "Morning routine",
      description: `A routine (a recipe of recipes): runs this morning's scheduled checks in sequence as one action \u2014 ${memberNames}. Scheduled daily at 08:00, seeds disabled; enable it by promoting the recipe to a stored pin. One timer drives the whole block (the members keep their own times only when run standalone). Each member writes its own report; the routine writes a one-screen summary linking them and badges red if any member needs attention. Run now fires the whole block on demand. Edit the membership and order freely afterward.`,
      icon: "run-all",
      color: "charts.green",
      group: "scheduled",
      // The routine carries the schedule (disabled by default, like every scheduled
      // ritual); one fire runs all members in sequence.
      schedule: { atTime: "08:00", enabled: false },
      action: { kind: "routine", members }
    }
  ];
}

// src/recipes/aiContextRecipes.ts
var DEFAULT_FOLDERS = [".claude", ".cline/tasks", "docs/chats"];
var MAX_THREADS = 10;
var MAX_LABEL = 80;
var color = "charts.foreground";
async function readText5(uri) {
  try {
    const bytes = await workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return void 0;
  }
}
function url3(target) {
  return { kind: "url", url: target };
}
function recipeIdFor(relPath) {
  return `ai.chat.${relPath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}
function baseName(relPath) {
  const file = relPath.split("/").pop() ?? relPath;
  return file.replace(/\.(md|json)$/i, "");
}
function clampLabel(text) {
  const trimmed = text.trim();
  return trimmed.length > MAX_LABEL ? `${trimmed.slice(0, MAX_LABEL - 1)}\u2026` : trimmed;
}
async function detectAiContextRecipes(folder2) {
  const cfg = workspace.getConfiguration("saropaWorkspace");
  if (!cfg.get("aiContext.enabled", true)) {
    return [];
  }
  const folders2 = cfg.get(
    "aiContext.claudeChatFolders",
    DEFAULT_FOLDERS
  );
  const { candidates, anyFolderPresent } = await collectCandidates(folder2, folders2);
  candidates.sort((a, b) => b.mtime - a.mtime);
  const freshest = candidates.slice(0, MAX_THREADS);
  const out = [];
  if (anyFolderPresent) {
    out.push({
      recipeId: "ai.new",
      label: "Start a new Claude chat",
      description: "Opens a fresh conversation at https://claude.ai/new in your browser (or the Claude desktop app, if it is registered to handle the link). Offered because this workspace has a configured AI chat folder.",
      icon: "add",
      color,
      group: "ai",
      action: url3("https://claude.ai/new")
    });
  }
  for (const candidate of freshest) {
    const recipe = await parseThread(candidate);
    if (recipe) {
      out.push(recipe);
    }
  }
  return out;
}
async function collectCandidates(folder2, folders2) {
  const candidates = [];
  let anyFolderPresent = false;
  for (const rel of folders2) {
    const dirUri = Uri.joinPath(folder2.uri, ...rel.split("/"));
    let entries;
    try {
      entries = await workspace.fs.readDirectory(dirUri);
    } catch {
      continue;
    }
    anyFolderPresent = true;
    for (const [name, type] of entries) {
      if (type !== FileType.File || !/\.(md|json)$/i.test(name)) {
        continue;
      }
      const uri = Uri.joinPath(dirUri, name);
      try {
        const stat = await workspace.fs.stat(uri);
        candidates.push({ uri, relPath: `${rel}/${name}`, mtime: stat.mtime });
      } catch {
        continue;
      }
    }
  }
  return { candidates, anyFolderPresent };
}
async function parseThread(candidate) {
  const text = await readText5(candidate.uri);
  if (text === void 0) {
    return void 0;
  }
  const parsed = /\.json$/i.test(candidate.relPath) ? parseJsonThread(text) : parseMarkdownThread(text);
  if (!parsed) {
    return void 0;
  }
  const label = clampLabel(parsed.title ?? baseName(candidate.relPath));
  const action = parsed.chatUrl ? url3(parsed.chatUrl) : void 0;
  const where = parsed.chatUrl ? `opens the conversation at ${parsed.chatUrl}` : "opens the local transcript file";
  return {
    recipeId: recipeIdFor(candidate.relPath),
    label,
    description: `Pinned AI conversation "${label}", detected from ${candidate.relPath}. Single-click ${where}. Only the most recently modified chats are offered; remove one to keep it from re-appearing.`,
    icon: "sparkle",
    color,
    group: "ai",
    action,
    filePath: action ? void 0 : candidate.relPath
  };
}
function parseJsonThread(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return void 0;
  }
  const title = typeof obj.title === "string" ? obj.title : void 0;
  if (!title) {
    return void 0;
  }
  const id = typeof obj.id === "string" ? obj.id : typeof obj.uuid === "string" ? obj.uuid : void 0;
  return { title, chatUrl: id ? `https://claude.ai/chat/${id}` : void 0 };
}
function parseMarkdownThread(text) {
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
  const raw = /https?:\/\/claude\.ai\/\S+/i.exec(text)?.[0];
  const chatUrl = raw?.replace(/[)>\]"'.,;]+$/, "");
  if (!title && !chatUrl) {
    return void 0;
  }
  return { title, chatUrl };
}

// src/exec/telemetry.ts
var KEY = "saropaWorkspace.telemetry";
var LEGACY_RECENT_KEY = "saropaWorkspace.recentRuns";
var RECENT_EXPANDED_KEY = "saropaWorkspace.recentGroupExpanded";
var MAX_RECENT = 20;
var Telemetry = class {
  // Set by activate(); until then every method is an inert no-op, so importing the
  // singleton at module load (e.g. in the runner) is safe before activation.
  context;
  _onDidChange = new EventEmitter();
  // Fires when a run is recorded or the history is reset, so the tree repaints.
  onDidChange = this._onDidChange.event;
  init(context) {
    this.context = context;
    this.migrateLegacy();
  }
  // Whether collection is on. Default true; the feature is opt-out, not opt-in,
  // because everything stays on the machine (no remote telemetry to consent to).
  enabled() {
    return workspace.getConfiguration("saropaWorkspace").get("telemetry.enabled", true);
  }
  // Ordered, de-duplicated pin ids, most-recent first. Used by the "Run Pin..."
  // palette to list recents above the full set.
  list() {
    return this.read().recent.map((r) => r.pinId);
  }
  // The recent run records (with timestamps and source) for the Recent group.
  recent() {
    return this.read().recent;
  }
  // Lifetime run count for a pin (0 if never run / after a reset).
  count(pinId) {
    return this.read().counts[pinId] ?? 0;
  }
  // A copy of the lifetime per-pin run counts, keyed by pin id. Read by the run-
  // analytics summary to rank most-run pins and total runs. Copied so a caller
  // cannot mutate the stored data through the returned object.
  counts() {
    return { ...this.read().counts };
  }
  // Record a run. Gated on enabled() so a disabled user collects nothing. Moves
  // the pin to the front of recents, refreshes its timestamp, and increments its
  // lifetime count.
  async record(pinId, source) {
    if (!this.context || !this.enabled()) {
      return;
    }
    const data = this.read();
    const at = Date.now();
    data.recent = [
      { pinId, at, source },
      ...data.recent.filter((r) => r.pinId !== pinId)
    ].slice(0, MAX_RECENT);
    data.counts[pinId] = (data.counts[pinId] ?? 0) + 1;
    await this.write(data);
    this._onDidChange.fire();
  }
  // Clear the entire local history (recents and counts). The user-facing reset.
  async reset() {
    if (!this.context) {
      return;
    }
    await this.write({ recent: [], counts: {} });
    this._onDidChange.fire();
  }
  // Recent group open/closed posture, persisted so it stays the way the user left
  // it. Default COLLAPSED — the Pins/Recipes views are the primary surface, so
  // Recent starts out of the way and expands only when the user opens it (the
  // gesture is then remembered). A first-run user sees their own pins first, not a
  // run-history list pushing them down.
  recentExpanded() {
    return this.context?.globalState.get(RECENT_EXPANDED_KEY, false) ?? false;
  }
  async setRecentExpanded(expanded) {
    await this.context?.globalState.update(RECENT_EXPANDED_KEY, expanded);
  }
  read() {
    const data = this.context?.globalState.get(KEY);
    return {
      recent: Array.isArray(data?.recent) ? data.recent : [],
      counts: data?.counts && typeof data.counts === "object" ? data.counts : {}
    };
  }
  async write(data) {
    await this.context?.globalState.update(KEY, data);
  }
  // One-time fold of the old bare-id recents list into the richer store. Synthetic
  // descending timestamps preserve the prior order; the legacy key is then dropped
  // so this runs at most once.
  migrateLegacy() {
    const ctx = this.context;
    if (!ctx) {
      return;
    }
    const legacy = ctx.globalState.get(LEGACY_RECENT_KEY);
    if (!Array.isArray(legacy) || legacy.length === 0) {
      return;
    }
    const existing = this.read();
    if (existing.recent.length === 0) {
      const now = Date.now();
      const counts = { ...existing.counts };
      const recent = legacy.slice(0, MAX_RECENT).map((pinId, i) => {
        counts[pinId] = (counts[pinId] ?? 0) + 1;
        return { pinId, at: now - i * 1e3, source: "manual" };
      });
      void this.write({ recent, counts });
    }
    void ctx.globalState.update(LEGACY_RECENT_KEY, void 0);
  }
};
var telemetry = new Telemetry();

// src/exec/pinEvents.ts
var PinEventBus = class {
  _onDidComplete = new EventEmitter();
  // Fires after any pin run reaches a terminal state (real exit or dispatch).
  onDidComplete = this._onDidComplete.event;
  fireComplete(pinId, outcome) {
    this._onDidComplete.fire({ pinId, outcome });
  }
};
var pinEvents = new PinEventBus();

// src/exec/promptMemory.ts
var KEY2 = "saropaWorkspace.promptMemory";
var PromptMemory = class {
  // Set by activate(); until then every method is an inert no-op, so importing the
  // singleton at module load (in promptTokens) is safe before activation.
  context;
  init(context) {
    this.context = context;
  }
  // The last value entered for a token on this pin, or undefined if never answered.
  getValue(pinId, tokenRaw) {
    return this.read()[pinId]?.[tokenRaw];
  }
  // Whether any remembered value exists for the pin (used to decide if a bypass run
  // can skip prompts at all).
  has(pinId) {
    const forPin = this.read()[pinId];
    return forPin !== void 0 && Object.keys(forPin).length > 0;
  }
  // Merge freshly entered token values into the pin's memory and persist. Only the
  // tokens just answered are written, so a partial run does not erase other tokens'
  // remembered values.
  async remember(pinId, values) {
    if (!this.context || values.size === 0) {
      return;
    }
    const data = this.read();
    const forPin = { ...data[pinId] ?? {} };
    for (const [raw, value] of values) {
      forPin[raw] = value;
    }
    data[pinId] = forPin;
    await this.write(data);
  }
  // Drop a pin's remembered values (called when a pin is removed, so stale entries
  // do not accumulate). No-op when the pin has no memory.
  async forget(pinId) {
    if (!this.context) {
      return;
    }
    const data = this.read();
    if (data[pinId] === void 0) {
      return;
    }
    delete data[pinId];
    await this.write(data);
  }
  read() {
    const data = this.context?.workspaceState.get(KEY2);
    return data && typeof data === "object" ? data : {};
  }
  async write(data) {
    await this.context?.workspaceState.update(KEY2, data);
  }
};
var promptMemory = new PromptMemory();

// src/i18n/locales/en.json
var en_default = {
  "pin.added": "Pinned {name}",
  "pin.removed": "Unpinned {name}",
  "pin.alreadyPinned": "{name} is already pinned here.",
  "pin.notPinned": "{name} is not pinned in {scope}.",
  "pin.renamePrompt": "New label for {name}",
  "pin.noActiveFile": "No active file to pin.",
  "linePin.label": "{name}:{line}",
  "linePin.added": "Pinned {name} at line {line}. Opening it jumps back here.",
  "tail.enabled": "Following {name} like tail -f. Opening it scrolls to new lines as the file grows.",
  "tail.disabled": "Stopped following {name}.",
  "tail.openNow": "Open now",
  "tail.fileOnly": "{name} is not a file pin; log follow applies to file pins only.",
  "mask.label": "Protected file",
  "mask.tooltip": "Masked pin. Opening it asks to reveal the file first, so it never appears from a stray click.",
  "mask.revealAction": "Reveal",
  "mask.revealConfirm": "Reveal {name}?",
  "mask.revealDetail": "This pin is masked to avoid showing a sensitive file by accident. Choose Reveal to open it.",
  "mask.on": "Masked {name}. Its name is hidden and opening it now asks to reveal first.",
  "mask.off": "Revealed {name}. It shows its name again and opens without a prompt.",
  "mask.fileOnly": "{name} is not a file pin; masking applies to file pins only.",
  "mask.unsupported": "{name} is an auto/recipe pin and cannot be masked. Pin the file explicitly first.",
  "scratch.placeholder": "Pick a format for the scratchpad (it never touches disk)",
  "scratch.format.markdown": "Markdown",
  "scratch.format.json": "JSON",
  "scratch.format.sql": "SQL",
  "scratch.format.javascript": "JavaScript",
  "scratch.format.plaintext": "Plain text",
  "scratch.created": "Opened a {format} scratchpad. It lives in memory only \u2014 nothing is written to disk or git until you save it.",
  "ghost.none": "No commands found that you have typed at least {count} times. The scan reads your local shell history only and is never transmitted.",
  "ghost.placeholder": "Pick the commands to save as global shell pins",
  "ghost.ranCount": "typed {count} times",
  "ghost.added": "Saved {count} command(s) as global shell pins. They never run on their own \u2014 double-click to run.",
  "env.noWorkspace": "Open a workspace folder to switch .env profiles.",
  "env.noProfiles": "No .env profiles found. Create .env.staging, .env.prod, etc. to switch between them.",
  "env.folderPlaceholder": "Pick the folder whose .env to switch",
  "env.profileCount": "{count} profile(s)",
  "env.placeholder": "Pick the environment to make active (.env)",
  "env.activeTag": "active now",
  "env.alreadyActive": "{name} is already the active .env.",
  "env.profileGone": "{name} no longer exists.",
  "env.unsavedConfirm": "Your current .env has changes that match no profile. Back it up to .env.bak and switch to {name}?",
  "env.backupAction": "Back up & switch",
  "env.switched": "Switched .env to {name}. Restart your dev server to apply the new environment.",
  "layout.empty": "No text editors are open to save as a layout.",
  "layout.namePrompt": "Name this editor layout",
  "layout.namePlaceholder": "e.g. Hero feature, API debugging",
  "layout.saved": "Saved layout {name} ({count} editor(s)). Restore it from the Pins toolbar.",
  "layout.none": "No saved layouts yet. Arrange your editors, then Save Editor Layout.",
  "layout.placeholder": "Pick a layout to restore",
  "layout.itemDetail": "{count} editor(s), {columns} column(s)",
  "layout.restored": "Restored layout {name} ({opened} editor(s)).",
  "layout.restoredPartial": "Restored layout {name}: opened {opened}, skipped {failed} that no longer exist.",
  "pin.sampleConfig": "Workspace config",
  "pin.group.project": "Project Pins",
  "pin.group.global": "Global Pins",
  "pin.missingFile": "File not found: {path}",
  "pin.missingTooltip": "File not found \u2014 this pin's target no longer exists.",
  "pin.gestureHint": "Single-click opens \xB7 double-click runs",
  "pin.gestureToast": "Tip: single-click a pin to open it, double-click to run it.",
  "pin.missing.message": "Can't open {name} \u2014 the file no longer exists at {path}.",
  "pin.missing.unpin": "Unpin",
  "pin.missing.reveal": "Show in Folder",
  "pin.missing.relocate": "Relocate...",
  "pin.missing.relocateOpenLabel": "Re-point Pin",
  "pin.missing.relocateTitle": "Pick the new location for {name}",
  "pin.relocated": "Re-pointed {name} to {file}.",
  "pin.relocateOutsideFolder": "A project pin must stay inside its workspace folder. Pin {name} globally to point outside it.",
  "pin.autoRestored": "Restored {count} auto-pin(s).",
  "pin.autoNoneRemoved": "No auto-pins were removed.",
  "group.addPrompt": "Name for the new group",
  "group.addPlaceholder": "e.g. Build, Lint, Deploy",
  "group.added": "Created group {name}. Drag pins into it to organize them.",
  "group.nameEmpty": "Enter a group name.",
  "group.noWorkspace": "Open a workspace folder before adding a project group.",
  "annotation.commentPrompt": "Comment text to show in the pin list",
  "annotation.commentPlaceholder": "e.g. Deploy scripts, Daily checks",
  "annotation.commentEmptyError": "Enter the comment text.",
  "annotation.commentEmpty": "(empty comment)",
  "annotation.commentAdded": "Added comment {text}",
  "annotation.separatorAdded": "Added a separator to the pin list.",
  "annotation.separatorTooltip": "Separator (divides the pin list)",
  "annotation.noWorkspace": "Open a workspace folder before adding a project comment or separator.",
  "group.renamePrompt": "New name for group {name}",
  "group.deleteConfirm": "Delete the group {name}? Its pins move to the top level (they are not removed).",
  "group.deleteConfirmAction": "Delete Group",
  "group.deleted": "Deleted group {name}; moved {count} pin(s) to the top level.",
  "configure.title": "Configure Run: {name}",
  "configure.hubPlaceholder": "Pick a setting to edit, or Save to apply.",
  "configure.autoUnsupported": "Run parameters cannot be set on an auto-pin. Pin the file explicitly first.",
  "configure.saved": "Saved run parameters for {name}.",
  "configure.save": "$(save) Save changes",
  "configure.saveHint": "Apply and close",
  "configure.field.command": "$(terminal) Command prefix",
  "configure.field.args": "$(symbol-array) Arguments",
  "configure.field.cwd": "$(folder) Working directory",
  "configure.field.env": "$(symbol-variable) Environment variables",
  "configure.field.terminal": "$(window) Run in",
  "configure.value.commandDefault": "(default for file type)",
  "configure.value.cwdDefault": "(owning folder)",
  "configure.value.none": "(none)",
  "configure.value.envCount": "{count} set",
  "configure.command.prompt": "Command prefix placed before the file path (e.g. python, node). Tokens: $workspaceRoot, $dir, $file, $fileName, $fileNameWithoutExt. Ask at run time with ${prompt:Label} or ${pick:a,b,c}.",
  "configure.command.placeholder": "Leave empty to use the default for this file type",
  "configure.args.prompt": "Arguments appended after the file path. Wrap an argument with spaces in double quotes. Tokens: $workspaceRoot, $dir, $file, $fileName, $fileNameWithoutExt. Ask at run time with ${prompt:Label} or ${pick:a,b,c}.",
  "configure.args.placeholder": "--out $dir/result.txt $fileNameWithoutExt",
  "configure.cwd.placeholder": "Choose the working directory for the run",
  "configure.cwd.default": "$(discard) Use default",
  "configure.cwd.workspace": "$(root-folder) Workspace folder",
  "configure.cwd.fileDir": "$(folder) File's folder",
  "configure.cwd.custom": "$(edit) Custom path...",
  "configure.cwd.customPrompt": "Absolute path to the working directory.",
  "configure.cwd.empty": "Enter a path.",
  "configure.cwd.notFound": "No directory exists at that path.",
  "configure.env.placeholder": "Add, edit, or remove an environment variable",
  "configure.env.add": "$(add) Add variable...",
  "configure.env.edit": "$(edit) Edit value",
  "configure.env.delete": "$(trash) Remove",
  "configure.env.actionPlaceholder": "{key}",
  "configure.env.keyPrompt": "Variable name",
  "configure.env.valuePrompt": "Value for {key}",
  "configure.env.keyEmpty": "Enter a variable name.",
  "configure.env.keyEquals": "A variable name cannot contain '='.",
  "configure.env.keyDuplicate": "{key} is already set.",
  "configure.terminal.placeholder": "Where should this pin run?",
  "configure.terminal.default": "Follow the default setting",
  "configure.terminal.integrated": "Integrated terminal",
  "configure.terminal.background": "Background output channel",
  "configure.terminal.external": "New external window",
  "configure.terminal.externalDetail": "Open a separate OS terminal window outside VS Code.",
  "configure.field.elevated": "$(shield) Administrator privileges",
  "configure.elevated.on": "On (run elevated)",
  "configure.elevated.off": "Off",
  "configure.elevated.placeholder": "Run the external window with administrator privileges?",
  "configure.elevated.offChoice": "$(discard) No - run with normal privileges",
  "configure.elevated.onChoice": "$(shield) Yes - run as administrator",
  "configure.elevated.detail": "Prompts for elevation (Windows UAC). Per-pin environment variables are not passed to an elevated window.",
  "configure.field.extract": "$(regex) Extract from output",
  "configure.extract.prompt": "Regular expression matched against a background run's output when it finishes. The first capture group (or the whole match) is copied to your clipboard. Only applies to runs in the background output channel.",
  "configure.extract.placeholder": "Live at: (https://\\S+)",
  "configure.extract.invalid": "Enter a valid regular expression, or leave empty to clear.",
  "configure.field.dependsOn": "$(checklist) Depends on",
  "configure.dependsOn.placeholder": "Pick a pin that must succeed before this one runs, or clear it.",
  "configure.dependsOn.none": "$(circle-slash) No dependency",
  "configure.dependsOn.unknown": "(unknown pin)",
  "configure.field.sound": "$(unmute) Audio cues",
  "configure.sound.placeholder": "Play audio cues for this pin?",
  "configure.sound.followDefault": "Follow the sound settings",
  "configure.sound.on": "Always (chime on every event for this pin)",
  "configure.sound.off": "Never (silence this pin)",
  "configure.field.runOnSave": "$(save) Run on save",
  "configure.runOnSave.placeholder": "Run this pin automatically when its file is saved?",
  "configure.runOnSave.on": "On (run when the file is saved)",
  "configure.runOnSave.off": "Off",
  "configure.field.concurrency": "$(run-all) Concurrent runs",
  "configure.concurrency.placeholder": "Allow this pin to run while one of its runs is already in progress?",
  "configure.concurrency.block": "Block (one run at a time)",
  "configure.concurrency.allow": "Allow (runs may overlap)",
  "configure.concurrency.blockChoice": "Block - one run at a time (default)",
  "configure.concurrency.blockDetail": "A scheduled, chained, or saved run is skipped while a previous run is still in progress; a manual run asks first.",
  "configure.concurrency.allowChoice": "Allow - runs may overlap",
  "configure.concurrency.allowDetail": "The pin may start again before a previous run finishes.",
  "configure.field.lock": "$(lock) Cross-process lock",
  "configure.lock.prompt": "Lock name shared with other windows or scripts. While a live holder owns it, this pin will not start. Leave empty for none.",
  "configure.lock.placeholder": "e.g. nllb-gpu",
  "configure.field.fileArg": "$(file-code) Pass file path to command",
  "configure.fileArg.placeholder": "Insert the pinned file's path into the command?",
  "configure.fileArg.on": "Yes - run the file (default)",
  "configure.fileArg.off": "No - run from args only (e.g. npm run build)",
  "simulate.title": "Simulate Run: {name}",
  "simulate.intro": "Dry run \u2014 nothing was executed. This is what a real run would do.",
  "simulate.canceled": "Simulation canceled for {name}.",
  "simulate.notRunnable": "{name} has no run command, so running it would open the file in the editor instead.",
  "simulate.commandHeading": "Command",
  "simulate.cwdHeading": "Working directory",
  "simulate.locationHeading": "Run location",
  "simulate.envHeading": "Environment overrides",
  "simulate.promptsHeading": "Answered prompts",
  "simulate.unknownHeading": "Unrecognized placeholders",
  "simulate.unknownNote": "Left literal in the command (they may be intentional shell variables).",
  "simulate.none": "(none)",
  "simulate.location.terminal": "Integrated terminal",
  "simulate.location.background": "Background output channel",
  "simulate.location.external": "New external window",
  "simulate.location.externalElevated": "New external window (administrator)",
  "simulate.action.url": "Opens this URL in your browser:",
  "simulate.action.shell": "Runs this shell command:",
  "simulate.action.command": "Invokes the VS Code command `{id}`.",
  "simulate.action.macro": "Runs these steps in order:",
  "drop.notRunnable": "{name} has no run command, so a dropped file has nothing to run. Set one with Configure Run.",
  "depends.treeBadge": "waiting on {dep}",
  "depends.lockedTooltip": "Locked: run {dep} successfully first.",
  "depends.blocked": "{name} is waiting on {dep}. Run {dep} successfully first.",
  "depends.runAction": "Run {dep}",
  "extract.copied": "Copied from {name}: {value}",
  "extract.invalid": "[{name}] invalid extract pattern: {pattern}",
  "extract.noMatch": "[{name}] extract pattern matched nothing: {pattern}",
  "diffRuns.needTwo": "Run {name} in the background at least twice to compare its output.",
  "diffRuns.title": "{name}: previous vs latest run",
  "diffRuns.header": "Run ended {when} (exit {code})",
  "share.copied": "Copied a shareable link for {name} to the clipboard.",
  "share.import.invalid": "That Saropa import link is not valid.",
  "share.import.confirm": 'Import the pin "{name}"?',
  "share.import.action": "Import",
  "share.import.done": "Imported {name}.",
  "share.import.noFolder": "Open a workspace folder to import this pin as a project pin.",
  "share.import.fallbackName": "shared pin",
  "external.title": "Pin a file from anywhere",
  "external.openLabel": "Pin File",
  "template.notFile": "Only a file pin can be used as a template.",
  "template.prompt": "New name for the copy of {source} (any case style).",
  "template.placeholder": "e.g. UserController or user_account",
  "template.empty": "Enter a name.",
  "template.exists": "A file named {name} already exists here.",
  "template.created": "Created {name} from {source}.",
  "fileOps.notFile": "{name} is not a file pin, so there is no file to act on.",
  "fileOps.newTitle": "New File",
  "fileOps.newPrompt": "Name for the new file, created next to this pin.",
  "fileOps.newEmpty": "Enter a file name.",
  "fileOps.exists": "A file named {name} already exists here.",
  "fileOps.created": "Created and pinned {name}.",
  "fileOps.copySuffix": "copy",
  "fileOps.copyNoName": "Could not find a free name to duplicate {name}.",
  "fileOps.duplicated": "Duplicated {source} to {name}.",
  "fileOps.renameTitle": "Rename {name}",
  "fileOps.renamePrompt": "New file name. The pin follows the file to its new name.",
  "fileOps.renamed": "Renamed {from} to {to}.",
  "fileOps.copyToOpenLabel": "Copy Here",
  "fileOps.copyToTitle": "Copy {name} to folder",
  "fileOps.copiedTo": "Copied {name} to {folder}.",
  "fileOps.revealAction": "Reveal",
  "fileOps.deleteConfirmAction": "Delete File",
  "fileOps.deleteConfirm": "Delete {name}?",
  "fileOps.deleteDetail": "The file is moved to your system trash, so it can be recovered.",
  "fileOps.deleted": "Deleted {name}.",
  "fileOps.deleteUnpinAction": "Unpin",
  "fileOps.locked": "Locked {name} (read-only). Unlock it to edit.",
  "fileOps.unlocked": "Unlocked {name}. It is writable again.",
  "fileOps.lockFailed": "Could not change the read-only state of {name}: {error}",
  "focus.noWorkspace": "Open a workspace folder before focusing on pinned files.",
  "focus.nothingToHide": "Nothing to focus: no folder has pinned files below its root to hide siblings of.",
  "focus.entered": "Focused the Explorer on your pinned files ({count} entries hidden). Exit Focus to restore.",
  "focus.exited": "Restored the Explorer. Your previous file filters are back.",
  "runTarget.title": "Run targets in {name}",
  "runTarget.placeholder": "Pick how to run this pin, or press Escape to run the file directly.",
  "runTarget.applied": "Set {name} to run: {target}",
  "action.opened": "Opened {url}",
  "action.macroSteps": "{count} steps",
  "action.routineMembers": "{count} recipes",
  "action.commandFailed": `Couldn't run "{name}". The tool may not be installed or activated yet.`,
  "macro.done": "Ran {name} ({count} steps).",
  "macro.stepFailed": "[{name}] step {step} failed: {error}",
  "report.wrote": "Wrote report for {name}: {path}",
  "report.failed": "[{name}] report failed: {error}",
  "routine.notReady": "[{name}] the routine engine is not ready yet; try again in a moment.",
  "routine.empty": 'Routine "{name}" has no members to run.',
  "routine.starting": 'Running routine "{name}" ({count} members)\u2026',
  "routine.step": 'Routine "{name}" \u2014 {index}/{count}: {member}\u2026',
  "routine.memberMissing": '  skipped: "{member}" \u2014 its recipe is not present in this folder.',
  "routine.nestedSkipped": '  skipped: "{member}" \u2014 a routine cannot run another routine.',
  "routine.nestedSkippedDetail": "nested routine (not supported)",
  "routine.interactiveSkipped": '  skipped: "{member}" \u2014 needs input, cannot run unattended.',
  "routine.interactiveSkippedDetail": "interactive; skipped in an unattended run",
  "routine.memberFailed": '  failed: "{member}" \u2014 {error}',
  "routine.new.needTwo": "Select at least two pins (Ctrl/Cmd-click) to compose into a routine.",
  "routine.new.title": "New routine from selection",
  "routine.new.prompt": "Name this routine ({count} members, run in sequence)",
  "routine.new.defaultName": "My routine",
  "routine.new.nameEmpty": "Enter a name for the routine.",
  "routine.new.saved": 'Created routine "{name}" with {count} members. Double-click to run them in sequence.',
  "routine.new.notSaved": "Could not create the routine (no workspace folder for a project pin).",
  "recipe.clickHint": "Click for details; use the play button to run.",
  "recipe.info.title": "{name}",
  "recipe.info.run": "Run now",
  "recipe.info.promote": "Promote to Pin",
  "recipe.info.scheduled": "Scheduled for {time} (disabled until promoted and enabled).",
  "recipe.desc.url": "Opens {url}",
  "recipe.desc.shell": "Runs: {command}",
  "recipe.desc.command": "Runs the {id} command.",
  "recipe.desc.macro": "Runs these steps: {steps}",
  "recipe.promoted": "Promoted {name} to a pin you can edit.",
  "recipe.restored": "Restored {count} recipe(s).",
  "recipe.noneRemoved": "No recipes were removed.",
  "recipe.env.exists": "An .env already exists; opened it.",
  "recipe.env.failed": "Could not copy .env.example to .env.",
  "recipe.env.done": "Created .env from .env.example.",
  "recipe.config.opened": "Opened {count} config file(s).",
  "recipe.config.none": "No recognized config files to open.",
  "recipe.version.none": "No name and version found in the project manifest.",
  "recipe.version.copied": "Copied {value} to the clipboard.",
  "recipe.script.none": "No package.json with scripts found near the active file.",
  "recipe.script.placeholder": "Pick a script to run.",
  "recipe.script.terminal": "Package Script",
  "monitor.panel.title": "Saropa Dashboard",
  "monitor.copied": "Copied the toolchain process report to the clipboard.",
  "monitor.kill.confirm": "End {name} (PID {pid})? This terminates the process immediately.",
  "monitor.kill.confirmAction": "End task",
  "monitor.kill.done": "Ended {name} (PID {pid}).",
  "monitor.kill.failed": "Could not end {name} (PID {pid}): {error}",
  "monitor.kill.protected": "{tool} processes are not killable from the monitor.",
  "monitor.snapshot.noFolder": "Open a folder to snapshot the toolchain.",
  "monitor.snapshot.sampling": "Sampling toolchain processes\u2026",
  "monitor.snapshot.wrote": "Wrote the toolchain snapshot to {path}.",
  "monitor.snapshot.failed": "Could not write the toolchain snapshot: {error}",
  "monitor.heartbeat.ram": "{tool} is using {rss} of RAM (over the {ceiling} ceiling).",
  "monitor.heartbeat.helpers": "{tool} has {count} processes (over the {ceiling} ceiling).",
  "monitor.heartbeat.openMonitor": "Open monitor",
  "hygiene.noFolder": "Open a folder to scan for empty and oversized files.",
  "hygiene.scanning": "Scanning for empty and oversized files\u2026",
  "hygiene.found": "Hygiene scan found {count} issue(s){more}.",
  "hygiene.truncated": " (showing the first {max})",
  "hygiene.openReport": "Open report",
  "hygiene.clean": "Hygiene scan: no issues across {files} files in {dirs} folders.",
  "hygiene.failed": "Could not write the hygiene report: {error}",
  "hygiene.savedInvalid": "This saved scan's configuration is invalid. Recreate it with New Hygiene Scan.",
  "hygiene.new.title": "New Hygiene Scan",
  "hygiene.new.scopePlaceholder": "Choose the folder to scan",
  "hygiene.new.browse": "$(folder-opened) Choose a folder\u2026",
  "hygiene.new.browseOpen": "Scan This Folder",
  "hygiene.new.modePlaceholder": "What should this scan report?",
  "hygiene.new.mode.both": "Empty and oversized",
  "hygiene.new.mode.empty": "Empty files and folders only",
  "hygiene.new.mode.oversized": "Oversized files and folders only",
  "hygiene.new.fileCeilingPrompt": "Flag files larger than how many megabytes?",
  "hygiene.new.folderCeilingPrompt": "Flag folders whose total exceeds how many megabytes?",
  "hygiene.new.numberInvalid": "Enter a number of megabytes greater than zero.",
  "hygiene.new.name": "Hygiene: {scope} ({detail})",
  "hygiene.new.saved": "Saved scan pin {name}. Double-click it to run, or schedule it.",
  "hygiene.new.notSaved": "Could not save the scan pin (no workspace folder for a project pin).",
  "bloat.noFolder": "Open a folder to scan for workspace bloat.",
  "bloat.scanning": "Scanning for oversized directories VS Code crawls on open\u2026",
  "bloat.clean": "Workspace bloat scan: {count} project(s) clean \u2014 nothing oversized or unguarded.",
  "bloat.found": "Workspace bloat scan found {count} finding(s) VS Code crawls on open.",
  "bloat.openReport": "Open report",
  "bloat.guardAction": "Guard this project",
  "bloat.failed": "Could not write the workspace bloat report: {error}",
  "bloat.guardForeign": "{project} is not the open workspace. Its remediation is in the report; apply it in that project yourself.",
  "bloat.guardUnparseable": "Could not safely update {path} (it has comments or syntax this action can't round-trip). Add the files.watcherExclude entry by hand.",
  "bloat.guarded": "Added {count} files.watcherExclude entr(ies) to {project}. Reload the window to stop crawling them.",
  "bloat.guardedNoop": "{project} already excludes those directories from the watcher.",
  "bloat.guardFailed": "Could not update settings.json: {error}",
  "bloat.pruneMeasuring": "Measuring the .vscode-test cache\u2026",
  "bloat.pruneAbsent": "No .vscode-test cache to prune in this project.",
  "bloat.pruneConfirm": "Delete cache",
  "bloat.pruneMessage": "Delete {project}'s .vscode-test cache and reclaim {size}? The test runner re-downloads what it needs next run.",
  "bloat.pruneFailed": "Could not prune the cache: {error}",
  "bloat.pruned": "Pruned {project}'s .vscode-test cache, reclaiming {size}.",
  "runAny.placeholder": "Run a pin by name (recently run first).",
  "runAny.empty": "No pins to run yet. Pin a file first.",
  "runAny.recent": "Recently run",
  "runAny.all": "All pins",
  "runTop.noPin": "No pin in position {slot}. Pin or reorder pins to fill it.",
  "runTop.notFound": 'No pin matches "{ref}".',
  "override.pickPlaceholder": "Pick a pin to run with one-off overrides.",
  "override.title": "Run with overrides: {name}",
  "override.argsPrompt": "Arguments for this run only (the stored pin is unchanged).",
  "override.cwdPrompt": "Working directory for this run only. Leave empty for the default.",
  "override.envPrompt": "Environment for this run only, as KEY=value pairs separated by spaces.",
  "override.envPlaceholder": "NODE_ENV=production PORT=8080",
  "suggest.prompt": "You have opened {name} {count} times. Pin it for quick access?",
  "suggest.pin": "Pin it",
  "suggest.never": "Don't ask again",
  "tabSuggest.prompt": "You've kept {name} pinned as a tab for over {hours}h. Add it to your Saropa pins?",
  "tabSuggest.pinWorkspace": "Pin to workspace",
  "tabSuggest.pinGlobal": "Pin globally",
  "tabSuggest.never": "Don't ask again",
  "tabSuggest.restored": "Restored {count} dismissed pinned-tab suggestion(s). Tabs kept pinned past the threshold can be offered again.",
  "appearance.title": "Icon & Color: {name}",
  "appearance.autoUnsupported": "An icon cannot be set on an auto-pin. Pin the file explicitly first.",
  "appearance.saved": "Updated the icon for {name}.",
  "appearance.icon.placeholder": "Pick an icon by category, or type to search.",
  "appearance.icon.default": "$(discard) Default file icon",
  "appearance.iconGroup.files": "Files & code",
  "appearance.iconGroup.run": "Run & build",
  "appearance.iconGroup.source": "Source control & cloud",
  "appearance.iconGroup.data": "Data & terminal",
  "appearance.iconGroup.status": "Status & alerts",
  "appearance.iconGroup.shapes": "Shapes & color",
  "appearance.iconGroup.objects": "Objects & places",
  "appearance.color.placeholder": "Pick a color for the icon.",
  "appearance.color.default": "$(discard) Default color",
  "appearance.color.red": "$(circle-filled) Red",
  "appearance.color.orange": "$(circle-filled) Orange",
  "appearance.color.yellow": "$(circle-filled) Yellow",
  "appearance.color.green": "$(circle-filled) Green",
  "appearance.color.blue": "$(circle-filled) Blue",
  "appearance.color.purple": "$(circle-filled) Purple",
  "appearance.color.neutral": "$(circle-filled) Neutral",
  "metric.title": "Live Metric: {name}",
  "metric.autoUnsupported": "A live metric cannot be set on an auto-pin. Pin the file explicitly first.",
  "metric.fileOnly": "A live metric can only be set on a file pin.",
  "metric.kindPlaceholder": "Pick what to show on this pin, or turn it off.",
  "metric.kind.size": "$(dashboard) File size",
  "metric.kind.sizeDetail": "Show the file's size, and optionally warn when it grows past a limit.",
  "metric.kind.lines": "$(list-ordered) Line count",
  "metric.kind.linesDetail": "Show the number of lines (large files fall back to size).",
  "metric.kind.modified": "$(clock) Last modified",
  "metric.kind.modifiedDetail": "Show how long ago the file last changed.",
  "metric.kind.off": "$(discard) Off",
  "metric.kind.offDetail": "Remove the live metric from this pin.",
  "metric.name.size": "file size",
  "metric.name.lines": "line count",
  "metric.name.modified": "last modified",
  "metric.thresholdPrompt": "Warn when the file grows past this size (leave blank for no limit).",
  "metric.thresholdPlaceholder": "e.g. 250kb, 5mb, 1gb \u2014 or blank for none",
  "metric.thresholdInvalid": "Enter a size like 250kb, 5mb, or 1gb (or leave blank).",
  "metric.lines": "{count} lines",
  "metric.tooltip": "Live metric: {value}",
  "metric.overTooltip": "Live metric: {value} \u2014 over its size limit.",
  "metric.saved": "Showing {kind} on {name}.",
  "metric.savedThreshold": "Showing {kind} on {name}; warns past {limit}.",
  "metric.cleared": "Removed the live metric from {name}.",
  "metric.overToast": "{name} is now {size} \u2014 over your {limit} limit.",
  "schedule.title": "Configure Schedule: {name}",
  "schedule.hubPlaceholder": "Pick a setting to edit, or Save to apply.",
  "schedule.autoUnsupported": "A schedule cannot be set on an auto-pin. Pin the file explicitly first.",
  "expiry.autoUnsupported": "An auto-pin cannot be time-bombed. Pin the file explicitly first.",
  "expiry.pick.title": "Pin Until: {name}",
  "expiry.pick.placeholder": "When should this pin remove itself?",
  "expiry.preset.hour": "In 1 hour",
  "expiry.preset.endOfDay": "End of today",
  "expiry.preset.tomorrow": "End of tomorrow",
  "expiry.preset.friday": "End of Friday",
  "expiry.preset.custom": "Custom date / time...",
  "expiry.custom.title": "Pin Until a Custom Date",
  "expiry.custom.prompt": "Enter a date (and optional time). The pin removes itself after it.",
  "expiry.custom.placeholder": "YYYY-MM-DD or YYYY-MM-DD HH:mm",
  "expiry.custom.invalid": "Enter a valid date as YYYY-MM-DD or YYYY-MM-DD HH:mm.",
  "expiry.set": "{name} will remove itself {when}.",
  "expiry.noRepo": "{name}: no workspace folder to read a git branch from.",
  "expiry.noBranch": "{name}: could not read the current git branch (no repo, or a detached / unreadable HEAD).",
  "expiry.branchSet": "{name} will remove itself when you leave branch {branch}.",
  "expiry.noneSet": "{name} has no expiry set.",
  "expiry.cleared": "Cleared the expiry on {name}.",
  "expiry.chip.branch": "until you leave {branch}",
  "expiry.left.due": "due",
  "expiry.left.minutes": "{count}m left",
  "expiry.left.hours": "{count}h left",
  "expiry.left.days": "{count}d left",
  "expiry.tooltip.at": "Expires {when}",
  "expiry.tooltip.branch": "Removes itself when you leave branch {branch}",
  "expiry.sweptOne": "Removed expired pin: {name}",
  "expiry.sweptMany": "Removed {count} expired pins: {names}",
  "expiry.undo": "Undo",
  "expiry.restored": "Restored {count} pin(s); the expiry was cleared.",
  "schedule.saved": "Saved schedule for {name}.",
  "schedule.save": "$(save) Save changes",
  "schedule.saveHint": "Apply and close",
  "schedule.field.atTime": "$(clock) Daily time",
  "schedule.field.days": "$(calendar) Days of week",
  "schedule.field.interval": "$(sync) Repeat interval",
  "schedule.field.enabled": "$(check) Enabled",
  "schedule.value.none": "(none)",
  "schedule.value.on": "On",
  "schedule.value.off": "Off",
  "schedule.atTime.prompt": "Time of day to run, 24-hour HH:mm. Leave empty for no daily run.",
  "schedule.atTime.placeholder": "e.g. 09:30",
  "schedule.atTime.invalid": "Enter a 24-hour time as HH:mm (00:00-23:59).",
  "schedule.days.everyDay": "Every day",
  "schedule.days.weekdays": "Weekdays (Mon-Fri)",
  "schedule.days.weekends": "Weekends (Sat-Sun)",
  "schedule.days.needsTime": "Set a daily time first",
  "schedule.days.placeholder": "Pick the days the daily time runs on (none = every day)",
  "schedule.days.shortcut.weekdays": "$(briefcase) Weekdays (Mon-Fri)",
  "schedule.days.shortcut.weekends": "$(home) Weekends (Sat-Sun)",
  "schedule.days.individualSeparator": "Individual days",
  "schedule.interval.placeholder": "How often should this pin repeat?",
  "schedule.interval.clear": "$(circle-slash) No repeat",
  "schedule.interval.custom": "$(edit) Custom...",
  "schedule.interval.customPrompt": "Repeat every N of the chosen unit.",
  "schedule.interval.invalid": "Enter a whole number greater than zero.",
  "schedule.interval.everyMinutes": "Every {count} minutes",
  "schedule.interval.everyHours": "Every {count} hour(s)",
  "schedule.interval.everyDays": "Every {count} day(s)",
  "schedule.unit.placeholder": "Choose a unit for the custom interval",
  "schedule.unit.minutes": "$(watch) Minutes",
  "schedule.unit.hours": "$(clock) Hours",
  "schedule.unit.days": "$(calendar) Days",
  "schedule.field.cron": "$(calendar) Cron schedule",
  "schedule.field.runOnStartup": "$(rocket) Run on workspace open",
  "schedule.cron.placeholder": "Build a cron schedule, or type one directly",
  "schedule.cron.clear": "$(circle-slash) No cron schedule",
  "schedule.cron.preset.weekdayAt": "$(briefcase) Every weekday at a time...",
  "schedule.cron.preset.dailyAt": "$(clock) Every day at a time...",
  "schedule.cron.preset.weeklyAt": "$(calendar) On a weekday each week at a time...",
  "schedule.cron.preset.monthlyAt": "$(calendar) On the 1st of each month at a time...",
  "schedule.cron.preset.workHours": "$(watch) Every few minutes during work hours (Mon-Fri 9-5)...",
  "schedule.cron.preset.hourly": "$(sync) Every hour, on the hour",
  "schedule.cron.advanced": "$(edit) Advanced: type a cron expression...",
  "schedule.cron.timePrompt": "Time of day to run, 24-hour HH:mm.",
  "schedule.cron.weekdayPlaceholder": "Which day of the week?",
  "schedule.cron.workHoursPlaceholder": "How often during work hours?",
  "schedule.cron.advancedPrompt": "5-field cron: minute hour day-of-month month day-of-week. Leave empty to clear.",
  "schedule.cron.advancedPlaceholder": "0 9 * * 1-5",
  "schedule.cron.invalid": "Enter a valid 5-field cron expression (e.g. 0 9 * * 1-5), or leave empty to clear.",
  "statusBar.next": "$(clock) {name} {time}",
  "statusBar.tooltip": "Next scheduled run: {name} at {time}. Click to reveal it.",
  "schedule.treeBadge": "next {time}",
  "schedule.nextRun": "Next run: {time}",
  "pause.treeBadge": "paused",
  "pause.tooltip": "Paused: automatic runs (schedule, triggers, on save) are suspended. A manual run still works.",
  "pause.paused": "Paused {name}. It will not run automatically until you unpause it.",
  "pause.unpaused": "Unpaused {name}. Automatic runs have resumed.",
  "schedule.fired": "[{time}] Scheduled run: {name} - {command}",
  "schedule.missing": "[{time}] Scheduled run skipped: {name} - file not found.",
  "schedule.interactiveSkipped": "[{time}] Scheduled run skipped: {name} needs interactive input (${prompt} / ${pick}).",
  "schedule.skipped": "[{time}] Scheduled run skipped: {name} - {reason}.",
  "concurrency.reasonRunning": "a previous run is still in progress",
  "concurrency.reasonLocked": "its lock is held by another process",
  "badge.diagTooltip": "Last sweep: {errors} error(s), {warnings} warning(s), {infos} info",
  "badge.testTooltip": "Last test run: {passed} passed, {failed} failed",
  "lints.notInstalled": "Saropa Lints is not installed, so there is no Code Health score to read. Install the saropa.saropa-lints extension to use it.",
  "lints.noData": "Saropa Lints has no analysis data yet. Run an analysis to compute the Code Health score?",
  "lints.runAnalysis": "Run analysis",
  "lints.analyzing": "Saropa Lints: analyzing...",
  "lints.analysisFailed": "Saropa Lints analysis did not complete. Open the Saropa Lints output for details.",
  "lints.stillNoData": "Analysis finished but no violations data was produced.",
  "lints.scoreUnavailable": "Saropa Lints has data, but not a full enough sweep to score yet (a partial/incremental analysis). Run a full analysis to get the score.",
  "lints.score": "Code Health {score}/100 - {band}. {errors} error(s), {warnings} warning(s), {infos} info across {files} file(s).",
  "lints.band.good": "good shape",
  "lints.band.fair": "needs work",
  "lints.band.poor": "serious problems",
  "lints.openDashboard": "Open Code Health dashboard",
  "stats.noFolder": "Open a workspace folder to collect project stats.",
  "stats.collecting": "Collecting project stats...",
  "stats.failed": "Could not write the project stats report: {error}",
  "stats.done": "Project stats: {languages} language(s), {files} file(s), {lines} line(s). Report opened.",
  "planner.title": "Schedule & Workflow Planner",
  "planner.subtitle": "Day and week timelines, plus a graph of chained and event-triggered pins. Drag to retime; link pins to chain them.",
  "planner.linked": "Linked {name}. It will auto-run when the source fires.",
  "chain.firing": "[Chain] Running {name} ({cause}).",
  "chain.cooldown": "[Chain] Skipped {name} ({cause}) - cooling down to avoid a trigger loop.",
  "chain.skipped": "[Chain] Skipped {name} ({cause}) - {reason}.",
  "save.skipped": "[Run on save] Skipped {name} - {reason}.",
  "watch.firing": "[Watch] Running {name} - {file} changed.",
  "watch.skipped": "[Watch] Skipped {name} - {reason}.",
  "watch.cooldown": "[Watch] Skipped {name} ({file} changed) - cooling down to avoid a run storm.",
  "watch.title": "Run {name} when a file changes",
  "watch.hubPlaceholder": "Add or remove watched paths, then Save.",
  "watch.hubPlaceholderEmpty": "No watched paths yet. Add a file or a glob.",
  "watch.remove": "Remove: {glob}",
  "watch.addFile": "Watch a file...",
  "watch.addFileDetail": "Pick a file; saving it runs this pin.",
  "watch.addGlob": "Watch a glob pattern...",
  "watch.addGlobDetail": "e.g. **/*.graphql or src/**",
  "watch.save": "Save",
  "watch.saveDetail": "Save the watched paths for {name}.",
  "watch.openLabel": "Watch this file",
  "watch.openTitle": "Pick a file to watch",
  "watch.globPrompt": "Glob pattern (workspace-relative). Saving a matching file runs {name} in the background.",
  "watch.globPlaceholder": "**/*.graphql",
  "watch.globEmpty": "Enter a non-empty pattern.",
  "watch.saved": "{name} runs when a watched path changes: {globs}.",
  "watch.cleared": "{name} no longer watches any files.",
  "chain.failed": "[Chain] {name} failed to start: {error}",
  "chain.cause.afterPin": "after {name}",
  "chain.cause.event": "on {event}",
  "chain.cause.idle": "while idle {minutes}m",
  "chain.idleInteractiveSkipped": "[Chain] Skipped {name} on idle - it needs interactive input (${prompt} / ${pick}) and cannot run unattended.",
  "chain.event.build": "build",
  "chain.event.publish": "publish",
  "chain.event.gitCommit": "git commit",
  "chain.event.gitPush": "git push",
  "triggers.title": "Triggers - {name}",
  "triggers.autoUnsupported": "Auto-pins cannot carry triggers. Promote it to a pin first.",
  "triggers.saved": "Saved triggers for {name}.",
  "triggers.hubPlaceholder": "What should auto-run this pin?",
  "triggers.addPin": "$(git-merge) Run after a pin...",
  "triggers.addEvent": "$(zap) Run after an event...",
  "triggers.addIdle": "$(coffee) Run when idle...",
  "triggers.field.emits": "$(broadcast) This pin emits",
  "triggers.emits.none": "(nothing)",
  "triggers.emits.placeholder": "Mark the events this pin's completion should fire",
  "triggers.listSeparator": "Triggers (what runs this pin)",
  "triggers.empty": "No triggers yet - this pin runs only manually or on its schedule.",
  "triggers.removeHint": "Select to remove",
  "triggers.successOnly.on": "    $(pass-filled) Only when the source succeeds",
  "triggers.successOnly.off": "    $(circle-large-outline) Runs on any completion (select to require success)",
  "triggers.actionsSeparator": "Actions",
  "triggers.save": "$(save) Save changes",
  "triggers.saveHint": "Apply and close",
  "triggers.row.pin": "$(git-merge) After {name}",
  "triggers.row.event": "$(zap) On {event}",
  "triggers.row.idle": "$(coffee) When idle {minutes}m (runs in the background)",
  "triggers.row.missingPin": "(removed pin)",
  "triggers.addPin.none": "No other pins to chain from.",
  "triggers.addPin.placeholder": "Run this pin after which pin completes?",
  "triggers.addEvent.none": "All events are already added.",
  "triggers.addEvent.placeholder": "Run this pin after which event?",
  "triggers.idle.prompt": "Run this pin after how many minutes of no VS Code interaction? It runs once in the background each time you step away.",
  "triggers.idle.placeholder": "Minutes of inactivity (e.g. 3)",
  "triggers.idle.invalid": "Enter a whole number of minutes greater than 0.",
  "triggers.event.build": "$(tools) After a build",
  "triggers.event.publish": "$(rocket) After a publish",
  "triggers.event.gitCommit": "$(git-commit) After a git commit",
  "triggers.event.gitPush": "$(repo-push) After a git push",
  "triggers.eventDetail.build": "Runs when a pin marked as a build step finishes.",
  "triggers.eventDetail.publish": "Runs when a pin marked as a publish step finishes.",
  "triggers.eventDetail.gitCommit": "Runs when a commit is recorded in this repo.",
  "triggers.eventDetail.gitPush": "Runs when a push updates a remote-tracking branch.",
  "triggers.emitDetail.build": "Other pins can run after a build by triggering on it.",
  "triggers.emitDetail.publish": "Other pins can run after a publish by triggering on it.",
  "run.starting": "Running {name}",
  "run.treeBadge": "running",
  "run.stoppingBadge": "stopping...",
  "run.runningTooltip": "Running in the background. Use Stop to terminate.",
  "run.stoppingTooltip": "Stopping... it will be force-killed if it does not exit. Use Force Kill to terminate now.",
  "run.stopped": "[{time}] Stopping: {name}",
  "run.stopMessage": "Stopping {name}...",
  "run.forceKilled": "[{time}] Force-killed: {name}",
  "run.forceKillMessage": "Force-killed {name}.",
  "run.notRunning": "{name} is not running in the background.",
  "run.alreadyRunning": "{name} is already running. Stop it first, run another anyway, or view its output.",
  "run.alreadyLocked": '{name} is locked by another process (lock "{lock}", pid {pid}). Run anyway, or view output.',
  "run.stopAndRerun": "Stop and re-run",
  "run.runAnyway": "Run anyway",
  "run.unknownTokens": "Unknown placeholder(s) left as-is: {tokens}",
  "run.openedNotRunnable": "{name} has no run command, so it was opened. Use Configure Run to make it runnable.",
  "run.succeeded": "{name} finished in {duration}.",
  "run.failed": "{name} failed (exit {code}) after {duration}.",
  "run.externalStarted": "Launched {name} in a new external window.",
  "run.externalElevatedStarted": "Launched {name} in a new administrator window (approve the elevation prompt).",
  "run.externalFailed": "Couldn't open an external window for {name}: {error}",
  "run.elevatedEnvDropped": "{name} ran elevated, so its custom environment variables were not applied.",
  "run.showOutput": "Show Output",
  "run.runFix": "Run: {command}",
  "run.statusOk": "ok {duration}",
  "run.statusFailed": "exit {code} {duration}",
  "run.countTooltip": "Run {count} time(s) on this machine",
  "run.tooltipOk": "Last run: succeeded in {duration} at {time}",
  "run.tooltipFailed": "Last run: failed (exit {code}) in {duration} at {time}",
  "run.canceledPrompt": "[{time}] Run canceled: {name} - no value entered.",
  "run.canceledPromptToast": "Run canceled for {name}.",
  "portUnwedge.blocked": "Port {port} is held by {process} (PID {pid}), so {name} couldn't start.",
  "portUnwedge.blockedUnknown": "Port {port} is in use, so {name} couldn't start, but the process holding it couldn't be identified.",
  "portUnwedge.unknownProcess": "an unknown process",
  "portUnwedge.killAndRetry": "Kill process & retry",
  "portUnwedge.inspectPort": "Inspect Port",
  "portUnwedge.confirmBody": "Kill {process} (PID {pid}) holding port {port}? This stops that process immediately.",
  "portUnwedge.confirmKill": "Kill & Retry",
  "portUnwedge.killed": "Killed {process} (PID {pid}) and freed port {port}. Retrying {name}.",
  "portUnwedge.killFailed": "Couldn't kill {process} (PID {pid}) \u2014 it may need elevated permissions. Port {port} is still in use.",
  "prompt.inputFallback": "Enter a value",
  "prompt.pickPlaceholder": "Select a value",
  "import.none": "No favorites from other extensions were found.",
  "import.done": "Imported {count} pin(s) from {file}.",
  "import.doneWithSkips": "Imported {count} pin(s) from {file}. Skipped {skipped} entry(ies) \u2014 open the output channel for details.",
  "import.nothingNew": "No new pins to import from {file}.",
  "import.log.malformed": "[Import] {file}: could not be parsed \u2014 {error}",
  "import.log.skipFolder": '[Import] {file}: skipped folder favorite "{name}" \u2014 a folder has no pin equivalent (its grouped files were imported).',
  "import.log.skipNoPath": "[Import] {file}: skipped an entry with no file path.",
  "import.log.skipBlankPath": "[Import] {file}: skipped a line with no path.",
  "import.log.skipSetting": "[Import] {key}: skipped a non-text entry.",
  "import.log.skipUnresolved": "[Import] {key}: skipped {path} \u2014 no workspace folder to resolve a relative path against.",
  "import.log.skipOutsideFolder": "[Import] {file}: skipped {path} \u2014 it is outside the workspace folder.",
  "import.log.skipUnsupported": '[Import] {file}: skipped "{name}" \u2014 this item type has no pin equivalent.',
  "import.log.summary": "[Import] Done: {added} added, {skipped} skipped.",
  "import.prompt": "Found {file} from another favorites extension. Import its {count} file(s) as project pins?",
  "import.promptAction": "Import",
  "import.sibling.none": "No favorites files found in sibling projects.",
  "import.sibling.placeholder": "Select sibling projects to import favorites from (added as global pins).",
  "import.sibling.done": "Imported {count} pin(s) from sibling projects as global pins.",
  "import.sibling.nothingNew": "No new pins to import from the selected sibling projects.",
  "pinSet.scope.all": "All pins (project and global)",
  "pinSet.scope.project": "Project pins only",
  "pinSet.scope.global": "Global pins only",
  "pinSet.scope.placeholder": "Which pins?",
  "pinSet.statusBar": "$(layers) {name}",
  "pinSet.statusBarTooltip": "Active pin set: {name} ({count} set(s)). Click to switch or manage sets.",
  "pinSet.noWorkspace": "Open a workspace folder to use pin sets.",
  "pinSet.switch.placeholder": "Switch to a pin set, or manage sets.",
  "pinSet.switch.setsSeparator": "Pin sets",
  "pinSet.switch.actionsSeparator": "Manage",
  "pinSet.switch.activeTag": "active",
  "pinSet.switch.new": "$(add) New pin set...",
  "pinSet.switch.rename": '$(edit) Rename "{name}"...',
  "pinSet.switch.duplicate": '$(copy) Duplicate "{name}"...',
  "pinSet.switch.delete": '$(trash) Delete "{name}"...',
  "pinSet.switched": "Switched to pin set {name}.",
  "pinSet.nameEmpty": "Enter a name for the pin set.",
  "pinSet.nameExists": "A pin set named {name} already exists.",
  "pinSet.new.prompt": "Name the new pin set",
  "pinSet.new.placeholder": "e.g. Frontend, Release, Debugging",
  "pinSet.created": "Switched to new pin set {name}. Its project pins start empty; global pins stay shared across all sets.",
  "pinSet.rename.prompt": "New name for pin set {name}",
  "pinSet.renamed": "Renamed pin set {from} to {to}.",
  "pinSet.duplicate.prompt": "Name for the copy of pin set {name}",
  "pinSet.duplicate.suffix": "{name} copy",
  "pinSet.duplicated": "Duplicated pin set {source} to {name} and switched to it.",
  "pinSet.delete.confirm": "Delete pin set {name}? Its project pins are removed. Global pins are unaffected.",
  "pinSet.delete.confirmAction": "Delete Pin Set",
  "pinSet.delete.lastOne": "{name} is the only pin set; create another before deleting it.",
  "pinSet.deleted": "Deleted pin set {name}; switched to {active}.",
  "export.saveTitle": "Export Pins to File",
  "export.saveLabel": "Export",
  "export.empty": "There are no pins to export in the chosen scope.",
  "export.done": "Exported {count} pin(s) to {file}.",
  "import.set.openTitle": "Import Pins from File",
  "import.set.openLabel": "Import",
  "import.set.invalid": "That file is not a Saropa pin set, or its version is unsupported.",
  "import.set.nothing": "The pin set was empty for the chosen scope.",
  "import.set.done": "Imported {added} pin(s).",
  "import.set.doneWithSkips": "Imported {added} pin(s). Skipped {skipped} already present.",
  "pinsConfig.title": "Edit Pins Config",
  "pinsConfig.noFolder": "Open a workspace folder to edit its pins config.",
  "pinsConfig.pickFolder": "Pick the workspace folder whose pins config to edit.",
  "projectFiles.openTitle": "Open File",
  "projectFiles.descVersioned": "v{version} \xB7 {when}",
  "projectFiles.justNow": "just now",
  "projectFiles.minutesAgo": "{count}m ago",
  "projectFiles.hoursAgo": "{count}h ago",
  "projectFiles.daysAgo": "{count}d ago",
  "projectFiles.tooltipVersion": "Version: {version}",
  "projectFiles.tooltipModified": "Last modified: {date}",
  "projectFiles.tooltipPinned": "Pinned to this project. Use the pin button to unpin.",
  "projectFiles.descPinned": "{base} \xB7 pinned",
  "recent.group": "Recent",
  "recent.scheduledTag": "(scheduled)",
  "badge.untapped": "{count} pinned items you haven't opened or run yet",
  "telemetry.resetConfirm": "Clear the local run history? This removes the Recent list and run counts kept on this machine. It cannot be undone.",
  "telemetry.resetConfirmAction": "Clear History",
  "telemetry.resetDone": "Cleared the local run history.",
  "analytics.title": "Run Analytics",
  "analytics.intro": "Local only \u2014 built from run history kept on this machine, never transmitted.",
  "analytics.disabled": "Run history collection is off. Turn on saropaWorkspace.telemetry.enabled to collect analytics.",
  "analytics.empty": "No runs recorded yet. Run a pin to start collecting local analytics.",
  "analytics.totalsHeading": "Totals",
  "analytics.pinsRun": "Pins run: {count}",
  "analytics.totalRuns": "Total runs: {count}",
  "analytics.mostRunHeading": "Most-run pins",
  "analytics.runsLabel": "{count} run(s)",
  "analytics.sessionHeading": "This session's results",
  "analytics.sessionNote": "Background-run outcomes from the current session (cleared on reload).",
  "analytics.sessionOk": "succeeded in {duration} (exit {code})",
  "analytics.sessionFailed": "failed (exit {code}) after {duration}",
  "analytics.recentHeading": "Recent runs",
  "analytics.unknownPin": "(removed pin)",
  "analytics.openMarkdown": "Open as Markdown preview",
  "tab.processes": "Processes",
  "tab.analytics": "Analytics",
  "tab.trends": "Trends",
  "dashboard.refresh": "Refresh",
  "dashboard.sortCpu": "CPU %",
  "dashboard.sortRam": "RAM",
  "dashboard.sortProc": "Processes",
  "dashboard.copyReport": "Copy report",
  "dashboard.sampling": "Sampling (\u22481s for a live CPU delta)\u2026",
  "dashboard.processEmpty": "No detected toolchain processes are running.",
  "dashboard.colPid": "PID",
  "dashboard.colName": "Name",
  "dashboard.colCpu": "CPU %",
  "dashboard.colRam": "RAM",
  "dashboard.hot": "hot",
  "dashboard.proc": "proc",
  "dashboard.endTask": "End task",
  "trends.cpuHeading": "Toolchain CPU over time",
  "trends.debtHeading": "Tech-debt markers over time",
  "trends.reportsHeading": "Scheduled reports",
  "trends.noCpu": "No heartbeat samples yet. Enable the toolchain heartbeat to chart CPU over time.",
  "trends.noDebt": "No tech-debt reports yet. Run the Tech-debt harvest ritual to chart markers over time.",
  "trends.noReports": "No scheduled reports yet. Promote and run a scheduled recipe to populate this list.",
  "trends.debtLatest": "Latest snapshot: {count} markers.",
  "trends.reportCount": "{count} report(s)",
  "trends.report.lint": "Dawn lint sweep",
  "trends.report.stats": "Sunrise project stats",
  "trends.report.standup": "Standup digest",
  "trends.report.eod": "End-of-day uncommitted guard",
  "trends.report.uncommitted": "End-of-day uncommitted guard",
  "trends.report.deps": "Dependency freshness",
  "trends.report.debt": "Tech-debt harvest",
  "trends.report.tests": "Test trend tracker",
  "trends.report.branches": "Branch hygiene",
  "trends.report.prs": "PR review queue",
  "trends.report.journal": "Dev journal",
  "trends.report.processes": "Process snapshot",
  "boot.configure.title": "Workspace Boot Sequence",
  "boot.configure.placeholder": "Add or arrange the pins that run when this workspace opens.",
  "boot.field.enabled": "$(rocket) Run on workspace open",
  "boot.field.stopOnError": "$(error) Stop on first failed step",
  "boot.value.on": "On",
  "boot.value.off": "Off",
  "boot.add": "$(add) Add pins to the sequence...",
  "boot.add.placeholder": "Pick pins to add (they run in the order shown).",
  "boot.add.none": "All your pins are already in the boot sequence.",
  "boot.stepsSeparator": "Steps (run in order)",
  "boot.actionsSeparator": "Actions",
  "boot.empty": "(no steps yet \u2014 add pins above)",
  "boot.member.actionRun": "will run",
  "boot.member.actionOpen": "will open",
  "boot.member.actionMissing": "(removed pin)",
  "boot.member.placeholder": "Choose what to do with {name}.",
  "boot.member.moveUp": "$(arrow-up) Move up",
  "boot.member.moveDown": "$(arrow-down) Move down",
  "boot.member.remove": "$(trash) Remove from sequence",
  "boot.run": "$(play) Run the sequence now",
  "boot.done": "$(save) Done",
  "boot.saved": "Saved the workspace boot sequence ({count} step(s)).",
  "boot.unknownPin": "(removed pin)",
  "boot.prompt": "Run this workspace's boot sequence? {count} step(s) will open files and run scripts.",
  "boot.prompt.action": "Run",
  "boot.prompt.configure": "Configure...",
  "boot.run.empty": "The workspace boot sequence is empty. Add pins with Configure Workspace Boot Sequence.",
  "boot.run.start": "[Boot] Running workspace boot sequence ({count} step(s))...",
  "boot.run.step": "[Boot] Step {index}/{total}: {name}",
  "boot.run.missing": "[Boot] Step {index}: pin no longer exists; skipped.",
  "boot.run.stepFailed": "[Boot] Step {index} failed: {error}",
  "boot.run.stopped": "[Boot] Stopped after a failed step (stop-on-error is on).",
  "boot.run.done": "Boot sequence finished: ran {ran} of {total} step(s).",
  "path.copied": "Copied {path}",
  "filter.facet.text": '"{text}"',
  "filter.facet.scripts": "Scripts",
  "filter.facet.files": "Files",
  "filter.facet.failed": "Failed",
  "filter.message": "Filter: {summary} \u2014 {hidden} hidden. Clear it from the view toolbar.",
  "filter.input.title": "Filter Pins",
  "filter.input.prompt": "Type to filter by name, path, or command. Use the buttons to limit to Scripts, Files, or Failed runs.",
  "filter.input.placeholder": "e.g. redis",
  "filter.button.scripts": "Show scripts only",
  "filter.button.scriptsOn": "Scripts only is on \u2014 click to clear",
  "filter.button.files": "Show files only",
  "filter.button.filesOn": "Files only is on \u2014 click to clear",
  "filter.button.failed": "Show failed runs only",
  "filter.button.failedOn": "Failed runs only is on \u2014 click to clear",
  "filter.button.clear": "Clear all filters",
  "filter.cleared": "Cleared the pin filter.",
  "filter.facet.tag": "#{tag}",
  "tag.title": "Tags: {name}",
  "tag.placeholder": "Pick tags for this pin, or add a new one.",
  "tag.addNew": "$(add) New tag...",
  "tag.newPrompt": "New tag(s), separated by spaces or commas (the leading # is optional).",
  "tag.newPlaceholder": "e.g. ops deploy review",
  "tag.autoUnsupported": "Tags can't be set on an auto or recipe pin. Pin the file explicitly first.",
  "tag.saved": "Tagged {name}: {tags}",
  "tag.cleared": "Cleared all tags on {name}.",
  "tag.tooltip": "Tags: {tags}",
  "branch.chip": "on {branch}",
  "branch.tooltip": "Shows only on branch {branch}.",
  "branch.linked": "{name} now shows only on branch {branch}.",
  "branch.unlinked": "{name} now shows on all branches.",
  "branch.unsupported": "{name} is an auto/recipe pin and cannot be linked to a branch.",
  "branch.noRepo": "Cannot link {name}: no git repository is open.",
  "branch.noBranch": "Cannot read a git branch for {name}; it stays on all branches.",
  "branchSet.switched": "Switched to pin set {set} for branch {branch}.",
  "branchSet.switchedAndRan": "Switched to pin set {set} for branch {branch}; running {name}.",
  "branchSet.pinMissing": "[Branch sets] On branch {branch}: activated set {set}, but its on-switch pin no longer exists; skipped.",
  "branchSet.noBranch": "No git branch to link: open a repository on a branch (a detached or unreadable HEAD has no branch to bind).",
  "branchSet.link.setPlaceholder": "Pick the pin set to activate on branch {branch}.",
  "branchSet.link.currentTag": "linked now",
  "branchSet.link.pinPlaceholder": "Optionally run a pin when switching to {set}, or pick None.",
  "branchSet.link.noPin": "$(circle-slash) No pin \u2014 just switch the set",
  "branchSet.linked": "Branch {branch} now activates pin set {set} on checkout.",
  "branchSet.linkedDisabled": "Linked branch {branch} to pin set {set}. Turn on branch-aware switching to apply it.",
  "branchSet.enableAction": "Enable",
  "branchSet.unlink.none": "Branch {branch} is not linked to a pin set.",
  "branchSet.unlinked": "Unlinked branch {branch} from pin set {set}.",
  "mode.title": "Filter Pins by Tag",
  "mode.placeholder": "Pick a tag to show only its pins, or show all.",
  "mode.noTags": "No tags yet. Right-click a pin and choose Tag Pin first.",
  "mode.showAll": "$(eye) Show all pins",
  "mode.tagsSeparator": "Tags",
  "mode.activeTag": "active",
  "mode.set": "Showing only {tag} pins. Clear the tag filter to show all.",
  "mode.allShown": "Showing all pins.",
  "mode.cleared": "Cleared the tag filter. Showing all pins."
};

// src/i18n/l10n.ts
var catalog = en_default;
function l10n(key, params) {
  let value = catalog[key] ?? key;
  if (params) {
    for (const [token, replacement] of Object.entries(params)) {
      value = value.split(`{${token}}`).join(String(replacement));
    }
  }
  return value;
}

// src/exec/processRegistry.ts
var cp = __toESM(require("child_process"));
var ESCALATE_AFTER_MS = 4e3;
var ProcessRegistry = class {
  running = /* @__PURE__ */ new Map();
  // Pins whose process has been asked to stop but has not exited yet, so the tree
  // can show a "stopping…" state until the close handler clears it.
  stopping = /* @__PURE__ */ new Set();
  // Pending auto-escalation timers, cleared when the process exits in time.
  escalateTimers = /* @__PURE__ */ new Map();
  _onDidChange = new EventEmitter();
  // Fires when a process starts or ends, so the tree can repaint running state.
  onDidChange = this._onDidChange.event;
  register(pinId, child) {
    this.running.set(pinId, child);
    this._onDidChange.fire();
    const clear = () => {
      if (this.running.get(pinId) === child) {
        this.running.delete(pinId);
        this.stopping.delete(pinId);
        const timer = this.escalateTimers.get(pinId);
        if (timer) {
          clearTimeout(timer);
          this.escalateTimers.delete(pinId);
        }
        this._onDidChange.fire();
      }
    };
    child.on("close", clear);
    child.on("error", clear);
  }
  isRunning(pinId) {
    return this.running.has(pinId);
  }
  isStopping(pinId) {
    return this.stopping.has(pinId);
  }
  // Ask a tracked process to stop gracefully, mark it "stopping", and arm an
  // auto-escalation to a forced kill if it does not exit in time. Returns false
  // if nothing was running. The child's close handler clears the state.
  stop(pinId) {
    const child = this.running.get(pinId);
    if (!child || child.pid === void 0) {
      return false;
    }
    this.stopping.add(pinId);
    this._onDidChange.fire();
    killTree(child, false);
    if (!this.escalateTimers.has(pinId)) {
      const timer = setTimeout(() => {
        this.escalateTimers.delete(pinId);
        if (this.running.get(pinId) === child) {
          killTree(child, true);
        }
      }, ESCALATE_AFTER_MS);
      this.escalateTimers.set(pinId, timer);
    }
    return true;
  }
  // Force-kill immediately (the manual escape hatch when a graceful Stop did not
  // take). Returns false if nothing was running.
  forceKill(pinId) {
    const child = this.running.get(pinId);
    if (!child || child.pid === void 0) {
      return false;
    }
    this.stopping.add(pinId);
    this._onDidChange.fire();
    killTree(child, true);
    return true;
  }
  dispose() {
    for (const timer of this.escalateTimers.values()) {
      clearTimeout(timer);
    }
    this.escalateTimers.clear();
    for (const child of this.running.values()) {
      killTree(child, true);
    }
    this.running.clear();
    this.stopping.clear();
  }
};
function killTree(child, force) {
  if (child.pid === void 0) {
    return;
  }
  if (process.platform === "win32") {
    const args = ["/pid", String(child.pid), "/T"];
    if (force) {
      args.push("/F");
    }
    cp.spawn("taskkill", args);
  } else {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
}
var processRegistry = new ProcessRegistry();

// src/exec/runLock.ts
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var LOCK_DIR = path.join(os.tmpdir(), "saropa-workspace-locks");

// src/exec/terminalRunner.ts
var outputChannel;
function getOutputChannel() {
  if (!outputChannel) {
    outputChannel = window.createOutputChannel("Saropa Workspace");
  }
  return outputChannel;
}

// src/exec/runStatus.ts
var RunStatusRegistry = class {
  last = /* @__PURE__ */ new Map();
  _onDidChange = new EventEmitter();
  // Fires when a result is recorded or cleared, so the tree can repaint.
  onDidChange = this._onDidChange.event;
  record(pinId, result) {
    this.last.set(pinId, result);
    this._onDidChange.fire();
  }
  get(pinId) {
    return this.last.get(pinId);
  }
  // Snapshot of every recorded result this session, keyed by pin id. Read by the
  // run-analytics summary to show the session's success / failure split. Returns a
  // copied array so a caller cannot mutate the registry's backing map.
  entries() {
    return [...this.last.entries()];
  }
  // Drop a pin's result, e.g. when the pin is removed so a stale badge does not
  // outlive it.
  clear(pinId) {
    if (this.last.delete(pinId)) {
      this._onDidChange.fire();
    }
  }
};
var runStatusRegistry = new RunStatusRegistry();

// src/exec/runOutputs.ts
var RunOutputs = class {
  // pinId -> up to two captured runs, oldest first ([previous, latest]).
  byPin = /* @__PURE__ */ new Map();
  // Record a finished run's output, evicting anything older than the last two.
  record(pinId, run) {
    const list = this.byPin.get(pinId) ?? [];
    list.push(run);
    while (list.length > 2) {
      list.shift();
    }
    this.byPin.set(pinId, list);
  }
  // The two most recent runs as [older, newer], or undefined when fewer than two
  // have been captured for the pin (nothing to diff yet).
  lastTwo(pinId) {
    const list = this.byPin.get(pinId);
    if (!list || list.length < 2) {
      return void 0;
    }
    return [list[0], list[1]];
  }
  // Drop a pin's captured runs (called on unpin so they do not linger).
  clear(pinId) {
    this.byPin.delete(pinId);
  }
};
var runOutputs = new RunOutputs();

// src/exec/pinBadges.ts
var PinBadgeRegistry = class {
  byPin = /* @__PURE__ */ new Map();
  _onDidChange = new EventEmitter();
  onDidChange = this._onDidChange.event;
  record(pinId, badge) {
    this.byPin.set(pinId, badge);
    this._onDidChange.fire();
  }
  get(pinId) {
    return this.byPin.get(pinId);
  }
  clear(pinId) {
    if (this.byPin.delete(pinId)) {
      this._onDidChange.fire();
    }
  }
};
var pinBadges = new PinBadgeRegistry();

// src/exec/portUnwedge.ts
var import_child_process = require("child_process");
var import_util = require("util");
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);

// src/model/pinStore.ts
var GLOBAL_STATE_KEY = "saropaWorkspace.globalPins";
var GLOBAL_GROUPS_KEY = "saropaWorkspace.globalGroups";
var RECIPE_GROUPS = [
  { category: "ai", id: "ai-threads", label: "Active AI Threads", order: 9989, icon: "sparkle", color: "charts.foreground" },
  { category: "open", id: "recipes-open", label: "GitHub", order: 9990, icon: "github", color: "charts.purple" },
  { category: "run", id: "recipes-run", label: "Build & Run", order: 9991, icon: "tools", color: "charts.green" },
  { category: "workspace", id: "recipes-workspace", label: "Workspace", order: 9992, icon: "folder-library", color: "charts.blue" },
  { category: "scheduled", id: "recipes-scheduled", label: "Scheduled", order: 9993, icon: "clock", color: "charts.yellow" },
  { category: "monitor", id: "process-monitor", label: "Process Monitor", order: 9994, icon: "pulse", color: "charts.red" },
  { category: "suite", id: "saropa-suite", label: "Saropa Suite", order: 1e4, icon: "layers", color: "charts.orange" }
];
var RECIPE_SUBGROUPS = [
  { parentId: "saropa-suite", key: "lints", id: "saropa-suite-lints", label: "Saropa Lints", order: 1, icon: "checklist", color: "charts.blue" },
  { parentId: "saropa-suite", key: "drift", id: "saropa-suite-drift", label: "Drift Advisor", order: 2, icon: "database", color: "charts.purple" },
  { parentId: "saropa-suite", key: "log", id: "saropa-suite-log", label: "Log Capture", order: 3, icon: "output", color: "charts.orange" }
];
var RECIPE_GROUP_EXPANDED_PREFIX = "saropaWorkspace.recipeGroupExpanded.";
function recipeGroupId(category) {
  return RECIPE_GROUPS.find((g) => g.category === category)?.id ?? "recipes-open";
}
function recipeSubGroupId(baseGroupId, subGroup) {
  return RECIPE_SUBGROUPS.find((s) => s.parentId === baseGroupId && s.key === subGroup)?.id ?? baseGroupId;
}
function isSyntheticRecipeGroupId(id) {
  return RECIPE_GROUPS.some((g) => g.id === id) || RECIPE_SUBGROUPS.some((s) => s.id === id);
}
function recipeGroupColor(category) {
  return RECIPE_GROUPS.find((g) => g.category === category)?.color ?? "charts.purple";
}
function isGlobPattern(pattern) {
  return /[*?{}[\]]/.test(pattern);
}
function setsEqual(a, b) {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}
function sameSetName(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
var PinStore = class {
  constructor(context) {
    this.context = context;
  }
  _onDidChange = new EventEmitter();
  onDidChange = this._onDidChange.event;
  // Cached, ready-to-render results recomputed by refresh().
  projectPins = [];
  globalPins = [];
  projectGroups = [];
  globalGroups = [];
  // Synthetic recipe groups (GitHub / Run / Workspace / Scheduled / Saropa Suite),
  // served separately from project groups so they render under their own top-level
  // "Recipes" section instead of inside the Project scope.
  recipeGroups = [];
  // Cached raw detection per folder (keyed by folder uri). Detection is the dominant
  // cost of a refresh; caching it means a pin add/remove/move/configure edit or a
  // schedule fire reuses the sweep instead of re-reading dozens of project files
  // every time (the "very slow to load" cause). New recipes from newly-added files
  // surface on the next window reload, which is the acceptable trade for the speed.
  recipeResultsCache = /* @__PURE__ */ new Map();
  // The non-recipe project pins from the last refresh. Recipe detection runs
  // asynchronously and appends to this base, so its slow filesystem work never
  // blocks the first paint (see refresh / seedRecipesAsync).
  baseProjectPins = [];
  // Monotonic token; a recipe-detection run discards itself if a newer refresh
  // has started (prevents a stale async result clobbering current state).
  recipeGen = 0;
  // Ids of file pins whose target no longer exists on disk. Recomputed after each
  // refresh by statting every resolved file pin (see recomputeMissing). Consulted
  // by the tree to flag the pin (warning glyph + "file not found" hover) and by the
  // open/run handlers to offer Unpin / Reveal instead of a raw VS Code error. The
  // stat pass is deferred off the first paint and only fires a repaint when the set
  // actually changes, so a steady state costs nothing visible.
  missingPinIds = /* @__PURE__ */ new Set();
  // Monotonic token mirroring recipeGen: a stat pass discards itself when a newer
  // refresh has started, so a slow stat cannot clobber current state.
  missingGen = 0;
  // Maps a project pin id to the workspace folder that owns it, so relative
  // paths can be resolved back to absolute URIs without storing the folder on
  // the model. Rebuilt every refresh().
  projectPinFolder = /* @__PURE__ */ new Map();
  // Maps a project group id to its owning folder, mirroring projectPinFolder.
  // A project group lives in one folder's file; a pin can only join a group in
  // its own folder (paths are folder-relative). Rebuilt every refresh().
  projectGroupFolder = /* @__PURE__ */ new Map();
  // The active pin set's name and the de-duplicated union of all set names across
  // folders, cached during refresh() so the status-bar switcher can read them
  // synchronously (the project file read is async). The first workspace folder is
  // authoritative for the active name — sets are kept in sync across folders by
  // name, so any folder would agree after a switch. See getActiveSetName / switchSet.
  activeSetName = DEFAULT_SET_NAME;
  setNamesCache = [DEFAULT_SET_NAME];
  async init() {
    await this.refresh();
  }
  getProjectPins() {
    return this.projectPins;
  }
  getGlobalPins() {
    return this.globalPins;
  }
  getProjectGroups() {
    return this.projectGroups;
  }
  getGlobalGroups() {
    return this.globalGroups;
  }
  getGroups(scope) {
    return scope === "global" ? this.globalGroups : this.projectGroups;
  }
  // The synthetic recipe groups, rendered under the top-level "Recipes" section
  // (not under the Project scope). Empty when no recipes were detected.
  getRecipeGroups() {
    return this.recipeGroups;
  }
  // True when a group id is one of the synthetic recipe groups (used by the tree to
  // route a recipe folder under the Recipes section rather than a scope root).
  isRecipeGroup(id) {
    return isSyntheticRecipeGroupId(id);
  }
  // Recipe pins live in the project scope's pin list (so findPin / resolveUri / the
  // scheduler keep working) but carry isRecipe and a recipe groupId; the tree shows
  // them only under the Recipes section. This count drives the section header.
  getRecipePins() {
    return this.projectPins.filter((p) => p.isRecipe);
  }
  // True when a file pin's target was absent at the last stat pass. The tree uses
  // this to flag the pin; click handlers re-stat at the moment of the click (the
  // authoritative check) so a file restored since the last refresh still opens.
  isMissing(id) {
    return this.missingPinIds.has(id);
  }
  // Look up a cached pin by id across both groups (used by the click dispatcher,
  // which only carries the id).
  findPin(id) {
    return this.projectPins.find((p) => p.id === id) ?? this.globalPins.find((p) => p.id === id);
  }
  // Find a cached pin in a scope by its resolved file path. Used right after a
  // pin is added, to attach an inferred run config to the pin just created.
  findPinByUri(uri, scope) {
    const list = scope === "global" ? this.globalPins : this.projectPins;
    const target = uri.toString();
    return list.find((p) => this.resolveUri(p)?.toString() === target);
  }
  // Resolve a pin to a concrete file URI. Project pins are relative to their
  // owning folder; global pins are absolute fsPaths.
  resolveUri(pin) {
    if (pin.scope === "global") {
      return parseGlobalPath(pin.path);
    }
    const folder2 = this.projectPinFolder.get(pin.id);
    if (!folder2) {
      return void 0;
    }
    return Uri.joinPath(folder2.uri, pin.path);
  }
  // Return the id of the user group with this label in `groups`, creating and
  // appending one when absent. Matching by label is what keeps a re-import
  // idempotent: a second pass reuses the same group instead of spawning a
  // duplicate. The caller persists `groups` (it is the in-memory list the caller
  // is about to write), so this never writes on its own.
  ensureGroupId(groups, label) {
    const trimmed = label.trim();
    const existing = groups.find((g) => g.label === trimmed);
    if (existing) {
      return existing.id;
    }
    const id = this.newId();
    groups.push({ id, label: trimmed, order: groups.length });
    return id;
  }
  // Pin a file. Returns false if it is already pinned in that scope (no-op).
  // An optional label sets the pin's display name up front — used by importers
  // that carry an alias for the file (e.g. the oleg-shilo `path|alias` format); a
  // blank/undefined label leaves the pin to fall back to the file basename. An
  // optional groupName drops the pin into a user group of that name within the
  // SAME scope/folder, creating the group on first use and reusing it by name
  // afterward (used by the kdcro group import to reconstruct group membership).
  async addPin(uri, scope, label, groupName) {
    const labelField = label && label.trim().length > 0 ? { label: label.trim() } : {};
    const wantGroup = groupName !== void 0 && groupName.trim().length > 0;
    if (scope === "global") {
      const pins = this.readGlobalPins();
      const stored = globalStoredPath(uri);
      if (pins.some((p) => p.path === stored)) {
        return false;
      }
      let groupField2 = {};
      if (wantGroup) {
        const groups = this.readGlobalGroups();
        const before = groups.length;
        const groupId = this.ensureGroupId(groups, groupName);
        if (groups.length !== before) {
          await this.writeGlobalGroups(groups);
        }
        groupField2 = { groupId };
      }
      pins.push({
        id: this.newId(),
        path: stored,
        scope: "global",
        order: pins.length,
        ...labelField,
        ...groupField2
      });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder2 = workspace.getWorkspaceFolder(uri);
    if (!folder2) {
      return false;
    }
    const relative2 = this.toFolderRelative(folder2, uri);
    const file = await this.readProjectFile(folder2);
    if (file.pins.some((p) => p.path === relative2 && p.scope === "project")) {
      return false;
    }
    const groupField = wantGroup ? { groupId: this.ensureGroupId(file.groups, groupName) } : {};
    file.pins.push({
      id: this.newId(),
      path: relative2,
      scope: "project",
      order: file.pins.length,
      ...labelField,
      ...groupField
    });
    await this.writeProjectFile(folder2, file);
    await this.refresh();
    return true;
  }
  // Add a "line pin" that opens a file at a specific 1-based line (WOW #22).
  // Unlike addPin, this does NOT dedupe by path: the same file can be pinned to
  // several different lines (each a distinct jump target), so a new pin is always
  // created. Returns false only when a project pin is requested for a file outside
  // any workspace folder (the caller should offer global instead).
  async addLinePin(uri, scope, line, label) {
    if (scope === "global") {
      const pins = this.readGlobalPins();
      pins.push({
        id: this.newId(),
        // Same local-fsPath / remote-URI storage as addPin, so a line pin on a
        // remote file resolves back to the right filesystem.
        path: globalStoredPath(uri),
        scope: "global",
        order: pins.length,
        line,
        label
      });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder2 = workspace.getWorkspaceFolder(uri);
    if (!folder2) {
      return false;
    }
    const file = await this.readProjectFile(folder2);
    file.pins.push({
      id: this.newId(),
      path: this.toFolderRelative(folder2, uri),
      scope: "project",
      order: file.pins.length,
      line,
      label
    });
    await this.writeProjectFile(folder2, file);
    await this.refresh();
    return true;
  }
  // Add a shell-action pin: a saved command line that runs when the pin is run.
  // Used by the shell-history suggester (WOW #2) to turn a frequently-typed command
  // into a one-click pin. Never runs it — adding only stores it. Project scope
  // writes to the first workspace folder (returns false when none is open); global
  // writes to globalState. A shell pin carries no file path, so a duplicate by path
  // is not meaningful; the same command may be saved more than once.
  async addShellPin(label, shellCommand, scope, useIntegratedTerminal) {
    const base = {
      label,
      path: "",
      action: { kind: "shell", shellCommand, useIntegratedTerminal }
    };
    if (scope === "global") {
      const pins = this.readGlobalPins();
      pins.push({ id: this.newId(), scope: "global", order: pins.length, ...base });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder2 = workspace.workspaceFolders?.[0];
    if (!folder2) {
      return false;
    }
    const file = await this.readProjectFile(folder2);
    file.pins.push({
      id: this.newId(),
      scope: "project",
      order: file.pins.length,
      ...base
    });
    await this.writeProjectFile(folder2, file);
    await this.refresh();
    return true;
  }
  // Add a non-action annotation pin — a comment label or a visual separator — that
  // divides a long pin list (Favorites-style comments/dividers). It carries no path
  // and no real action; the kind ("comment" / "separator") lives in `action.kind` so
  // pinKind / isAnnotationPin route it, and a comment's text is its `label`. When
  // `after` is given the entry is inserted immediately below that pin in the same
  // scope and group (so it annotates exactly where the user clicked); otherwise it
  // appends to the top level of `targetFolder` (the favorites importer passes the
  // file's owning folder so an annotation lands in the same folder, and the same
  // source order, as the file pins it sits between) or the first folder when none is
  // given. Returns false only when a project entry is requested with no workspace
  // folder open. Never runs anything — these are inert.
  async addAnnotationPin(kind, scope, label, after, targetFolder) {
    const targetScope = after?.scope ?? scope;
    const groupId = after?.groupId;
    const labelField = label && label.trim().length > 0 ? { label: label.trim() } : {};
    if (targetScope === "global") {
      const pins = this.readGlobalPins();
      const newPin2 = {
        id: this.newId(),
        path: "",
        scope: "global",
        order: pins.length,
        action: { kind },
        ...groupId ? { groupId } : {},
        ...labelField
      };
      pins.push(newPin2);
      this.placeAfter(pins, newPin2, after?.id);
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder2 = after ? this.projectPinFolder.get(after.id) ?? workspace.workspaceFolders?.[0] : targetFolder ?? workspace.workspaceFolders?.[0];
    if (!folder2) {
      return false;
    }
    const file = await this.readProjectFile(folder2);
    const newPin = {
      id: this.newId(),
      path: "",
      scope: "project",
      order: file.pins.length,
      action: { kind },
      ...groupId ? { groupId } : {},
      ...labelField
    };
    file.pins.push(newPin);
    this.placeAfter(file.pins, newPin, after?.id);
    await this.writeProjectFile(folder2, file);
    await this.refresh();
    return true;
  }
  // Renumber `newPin`'s group so it sits immediately after `afterPinId`, or at the
  // group's end when the anchor is absent / in another group. Mirrors reorderWithin
  // (which renumbers a single group's members from 0), so an inserted annotation
  // positions the same way a drag would. Operates on `all` in place.
  placeAfter(all, newPin, afterPinId) {
    const groupId = newPin.groupId ?? void 0;
    const members = all.filter(
      (p) => (p.groupId ?? void 0) === groupId && p.id !== newPin.id
    );
    const anchorIndex = afterPinId ? members.findIndex((p) => p.id === afterPinId) : -1;
    const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : members.length;
    const ordered = [
      ...members.slice(0, insertAt),
      newPin,
      ...members.slice(insertAt)
    ];
    ordered.forEach((pin, i) => {
      pin.order = i;
    });
  }
  // Add a pin from a shared link's portable configuration (WOW #4 import). The id
  // and order are freshly assigned; everything else (label, path, action, exec,
  // icon, color, schedule) is carried verbatim. An optional groupId drops the pin
  // straight into an existing group — used by the pin-set import to reconstruct a
  // group membership without a follow-up move. Project scope writes to the first
  // workspace folder's file (returns false when none is open); global writes to
  // globalState. Never runs the pin — importing only adds it.
  async importPin(shared, scope, groupId) {
    const base = {
      label: shared.label,
      path: shared.path ?? "",
      action: shared.action,
      exec: shared.exec,
      icon: shared.icon,
      color: shared.color,
      schedule: shared.schedule,
      // Only carry a groupId when given, so an ungrouped import stays top-level
      // rather than storing an undefined membership.
      ...groupId ? { groupId } : {}
    };
    if (scope === "global") {
      const pins = this.readGlobalPins();
      pins.push({ id: this.newId(), scope: "global", order: pins.length, ...base });
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder2 = workspace.workspaceFolders?.[0];
    if (!folder2) {
      return false;
    }
    const file = await this.readProjectFile(folder2);
    file.pins.push({
      id: this.newId(),
      scope: "project",
      order: file.pins.length,
      ...base
    });
    await this.writeProjectFile(folder2, file);
    await this.refresh();
    return true;
  }
  async removePin(pin) {
    if (pin.scope === "global") {
      const pins = this.readGlobalPins().filter((p) => p.id !== pin.id);
      await this.writeGlobalPins(pins);
      await this.refresh();
      return;
    }
    const folder2 = this.projectPinFolder.get(pin.id);
    if (!folder2) {
      return;
    }
    const file = await this.readProjectFile(folder2);
    if (pin.isAuto) {
      if (!file.removedAutoPins.includes(pin.id)) {
        file.removedAutoPins.push(pin.id);
      }
    } else if (pin.isRecipe && pin.recipeId) {
      if (!file.removedRecipes.includes(pin.recipeId)) {
        file.removedRecipes.push(pin.recipeId);
      }
    } else {
      file.pins = file.pins.filter((p) => p.id !== pin.id);
    }
    await this.writeProjectFile(folder2, file);
    await this.refresh();
  }
  async renamePin(pin, label) {
    const trimmed = label.trim();
    if (pin.scope === "global") {
      const pins = this.readGlobalPins();
      const target2 = pins.find((p) => p.id === pin.id);
      if (target2) {
        target2.label = trimmed || void 0;
        await this.writeGlobalPins(pins);
        await this.refresh();
      }
      return;
    }
    const folder2 = this.projectPinFolder.get(pin.id);
    if (!folder2) {
      return;
    }
    const file = await this.readProjectFile(folder2);
    const target = file.pins.find((p) => p.id === pin.id);
    if (target) {
      target.label = trimmed || void 0;
      await this.writeProjectFile(folder2, file);
      await this.refresh();
    }
  }
  // Re-point a pin at a different file — the "relocate" fix for a pin whose target
  // was moved or renamed. A global pin stores the absolute path; a project pin
  // stores a folder-relative path and so can only point inside its own workspace
  // folder (a relative path cannot reach a sibling folder), which is rejected with
  // `false` so the caller can tell the user. Returns whether the path was written.
  async updatePinPath(pin, uri) {
    if (pin.scope === "global") {
      return this.mutatePin(pin, (target) => {
        target.path = globalStoredPath(uri);
      });
    }
    const folder2 = this.projectPinFolder.get(pin.id);
    if (!folder2) {
      return false;
    }
    const owner = workspace.getWorkspaceFolder(uri);
    if (owner?.uri.toString() !== folder2.uri.toString()) {
      return false;
    }
    const relative2 = this.toFolderRelative(folder2, uri);
    return this.mutatePin(pin, (target) => {
      target.path = relative2;
    });
  }
  // Persist a pin's run configuration. Passing undefined clears it (the pin
  // reverts to interpreter-default behavior).
  async updatePinExec(pin, exec) {
    await this.mutatePin(pin, (target) => {
      target.exec = exec;
    });
  }
  // Persist a pin's schedule. Passing undefined clears it (the scheduler then
  // arms no timer for the pin).
  async updatePinSchedule(pin, schedule) {
    await this.mutatePin(pin, (target) => {
      target.schedule = schedule;
    });
  }
  // Persist a pin's auto-run triggers and emitted system events (recipe chaining).
  // An empty array collapses to undefined so a pin with no links reads as "manual /
  // schedule only" rather than carrying inert arrays.
  async updatePinTriggers(pin, triggers, emits) {
    await this.mutatePin(pin, (target) => {
      target.triggers = triggers && triggers.length > 0 ? triggers : void 0;
      target.emits = emits && emits.length > 0 ? emits : void 0;
    });
  }
  // Persist a pin's tree-icon and color overrides. Passing undefined for either
  // clears it (the pin reverts to the file-type default glyph / no tint).
  async updatePinAppearance(pin, icon, color2) {
    await this.mutatePin(pin, (target) => {
      target.icon = icon;
      target.color = color2;
    });
  }
  // Persist a pin's paused flag. Pausing suspends every unattended runner for the
  // pin (scheduler, chain triggers/emits, idle, run-on-save) while keeping its
  // schedule/triggers intact; a manual run still works. Cleared (dropped) on
  // unpause so an active pin carries no stale flag. Routed through mutatePin, so it
  // no-ops on an auto/recipe pin (recomputed, not stored) — the command gates those
  // out up front. The store fires onDidChange, which re-arms the scheduler (a paused
  // pin then gets no timer) and re-syncs the idle thresholds.
  async setPinPaused(pin, paused) {
    await this.mutatePin(pin, (target) => {
      target.paused = paused ? true : void 0;
    });
  }
  // Persist a pin's single-instance settings. allowConcurrent true opts the pin out
  // of the run guard (overlapping runs allowed); false/cleared restores the default
  // block. lockName names the optional cross-process lock; a blank name clears it.
  // Both collapse to undefined when off so a default pin carries no inert fields
  // (round-trip parity). Routed through mutatePin, so it no-ops on an auto/recipe pin.
  async setPinConcurrency(pin, allowConcurrent, lockName) {
    const cleaned = lockName && lockName.trim().length > 0 ? lockName.trim() : void 0;
    await this.mutatePin(pin, (target) => {
      target.allowConcurrent = allowConcurrent ? true : void 0;
      target.lockName = cleaned;
    });
  }
  // Persist a file pin's tail-follow flag (WOW #5). Passing false clears it so the
  // pin opens normally again. Stored as a plain pin field, so it round-trips like
  // any other; the open path reads it to decide whether to auto-scroll the log.
  async setPinTail(pin, follow) {
    await this.mutatePin(pin, (target) => {
      target.tailFollow = follow ? true : void 0;
    });
  }
  // Persist a pin's cross-file watch globs (#25). Empties/whitespace are trimmed out;
  // an empty result clears the field (and the now-bare exec object is left as-is —
  // other exec settings may still live on it) so an un-linked pin carries no stale
  // watch list. Lives on exec beside runOnSave so the one save listener reads both.
  // Routed through mutatePin, so it no-ops on an auto/recipe pin (recomputed, not
  // stored) — the linking command gates those out before calling.
  async setPinWatchGlobs(pin, globs) {
    const cleaned = globs.map((g) => g.trim()).filter((g) => g.length > 0);
    await this.mutatePin(pin, (target) => {
      if (cleaned.length > 0) {
        target.exec = { ...target.exec ?? {}, runOnSaveGlobs: cleaned };
      } else if (target.exec) {
        target.exec.runOnSaveGlobs = void 0;
      }
    });
  }
  // Persist a file pin's masked / vault flag (WOW #26 — the screen-share guard). On
  // masks the pin (generic label + lock glyph in the tree, real path hidden from the
  // row and hover, and a reveal confirm before the file opens); off restores the
  // normal pin. Dropped (set undefined) when off so an unmasked pin carries no stale
  // flag — round-trip parity. Routed through mutatePin, so it no-ops on an auto/recipe
  // pin (recomputed, not stored) — the toggle command gates those out up front.
  async setMasked(pin, masked) {
    await this.mutatePin(pin, (target) => {
      target.masked = masked ? true : void 0;
    });
  }
  // Persist a file pin's live-metric badge (#24). Passing undefined clears it (the
  // metric engine then disposes that pin's file watcher on the next reconcile).
  // Routed through mutatePin, so it no-ops on an auto-pin (recomputed, not stored) —
  // the setMetric command gates those out up front.
  async setPinMetric(pin, metric) {
    await this.mutatePin(pin, (target) => {
      target.metric = metric;
    });
  }
  // Persist a pin's time-bomb expiry (WOW #9). An empty/all-undefined condition
  // collapses to undefined so a defused pin carries no inert object and reads as
  // "never expires". Routed through mutatePin, so it no-ops on an auto-pin (which
  // is recomputed, not stored) — the configure command gates those out up front.
  async setPinExpiry(pin, expires) {
    const meaningful = expires && (expires.at !== void 0 || expires.onBranchAway !== void 0) ? expires : void 0;
    await this.mutatePin(pin, (target) => {
      target.expires = meaningful;
    });
  }
  // Persist a pin's classification tags (WOW #17). Lowercased, trimmed, blank-
  // stripped, and de-duplicated so the stored set is canonical; an empty result
  // collapses to undefined so an untagged pin carries no inert array. Routed
  // through mutatePin, so it no-ops on an auto/recipe pin (recomputed, not stored)
  // — the tag command gates those out up front.
  async setPinTags(pin, tags) {
    const cleaned = Array.from(
      new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))
    );
    await this.mutatePin(pin, (target) => {
      target.tags = cleaned.length > 0 ? cleaned : void 0;
    });
  }
  // Persist a pin's branch link (WOW #3). A branch name scopes the pin to that
  // branch (shown only while the owning folder is on it); undefined clears the link
  // (shown on every branch). Routed through mutatePin, so it no-ops on an auto/recipe
  // pin (recomputed, not stored) — the toggle command gates those out up front.
  async setPinBranch(pin, branch) {
    await this.mutatePin(pin, (target) => {
      target.branch = branch && branch.length > 0 ? branch : void 0;
    });
  }
  // Every distinct tag in use across stored project + global pins, sorted A->Z so
  // the tag picker and the mode filter offer a stable, de-duplicated list. Recipe
  // and auto pins carry no tags (recomputed, not stored), so they contribute none.
  tagsInUse() {
    const set = /* @__PURE__ */ new Set();
    for (const pin of [...this.projectPins, ...this.globalPins]) {
      for (const tag of pin.tags ?? []) {
        set.add(tag);
      }
    }
    return Array.from(set).sort(
      (a, b) => a.localeCompare(b, void 0, { sensitivity: "base" })
    );
  }
  // The workspace folder that owns a project pin, or undefined for a global pin or
  // when the owner cannot be resolved. Lets the expiry engine read the right
  // repo's branch for an onBranchAway pin, and the restore path re-add to the
  // correct folder.
  folderOf(pin) {
    return this.projectPinFolder.get(pin.id);
  }
  // Re-add a pin removed by the time-bomb sweep — the Undo path (WOW #9). The
  // expiry condition is dropped on the way back in, so an already-expired snapshot
  // is not swept away again the instant it returns (Undo defuses the bomb). The id
  // is preserved so any reused per-pin state lines up. A global pin is pushed back
  // to globalState; a project pin is written to its captured owning folder (passed
  // in, since the projectPinFolder map no longer holds the removed id), falling
  // back to the first workspace folder.
  async restorePin(snapshot, folder2) {
    const restored = { ...snapshot, expires: void 0 };
    if (snapshot.scope === "global") {
      const pins = this.readGlobalPins();
      restored.order = pins.length;
      pins.push(restored);
      await this.writeGlobalPins(pins);
      await this.refresh();
      return;
    }
    const owner = folder2 ?? workspace.workspaceFolders?.[0];
    if (!owner) {
      return;
    }
    const file = await this.readProjectFile(owner);
    restored.order = file.pins.length;
    file.pins.push(restored);
    await this.writeProjectFile(owner, file);
    await this.refresh();
  }
  // Record the epoch-ms of a scheduled fire. Used for reopen de-duplication and
  // interval advancement (see nextOccurrence). No-op if the pin has no schedule.
  async updatePinScheduleLastRun(pin, lastRun) {
    await this.mutatePin(pin, (target) => {
      if (target.schedule) {
        target.schedule.lastRun = lastRun;
      }
    });
  }
  // Find the stored pin by id in its owning store, apply a mutation, persist, and
  // refresh. Touches only what `apply` changes, so a concurrent edit to another
  // field is not clobbered. Auto-pins are not stored in pins[], so there is no
  // target and this is a silent no-op (callers gate them out). Returns whether a
  // target was found and written.
  async mutatePin(pin, apply) {
    if (pin.scope === "global") {
      const pins = this.readGlobalPins();
      const target2 = pins.find((p) => p.id === pin.id);
      if (!target2) {
        return false;
      }
      apply(target2);
      await this.writeGlobalPins(pins);
      await this.refresh();
      return true;
    }
    const folder2 = this.projectPinFolder.get(pin.id);
    if (!folder2) {
      return false;
    }
    const file = await this.readProjectFile(folder2);
    const target = file.pins.find((p) => p.id === pin.id);
    if (!target) {
      return false;
    }
    apply(target);
    await this.writeProjectFile(folder2, file);
    await this.refresh();
    return true;
  }
  // Re-add every removed auto-pin across all folders. Returns how many were
  // restored so the caller can report it.
  async restoreAutoPins() {
    let restored = 0;
    for (const folder2 of workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder2);
      if (file.removedAutoPins.length > 0) {
        restored += file.removedAutoPins.length;
        file.removedAutoPins = [];
        await this.writeProjectFile(folder2, file);
      }
    }
    if (restored > 0) {
      await this.refresh();
    }
    return restored;
  }
  // --- pin sets ----------------------------------------------------------
  //
  // A pin set is a named, switchable collection of the user's project pins +
  // groups (multiple-favorite-sets roadmap). Only the ACTIVE set's contents live
  // at the file's top level (so every other consumer reads it unchanged); the
  // inactive sets live in ProjectPinsFile.sets. Sets are coordinated across a
  // multi-root workspace by NAME — every operation below applies to all folders,
  // so switching to "Release" switches each folder to its own "Release" (creating
  // an empty one where a folder has never seen that name). Global pins are not part
  // of any set: a global favorite is cross-workspace by definition, so it stays
  // shared across all sets. Auto/recipe seeding is likewise workspace-level and
  // shared (it lives on ProjectPinsFile, not PinSet).
  // The active set's display name (cached from the first folder during refresh).
  getActiveSetName() {
    return this.activeSetName;
  }
  // Every distinct set name across folders (active + inactive), sorted A->Z and
  // de-duplicated, for the switcher list. Always holds at least the active name.
  getSetNames() {
    return this.setNamesCache;
  }
  // The stored (explicit) project pins of a named set WITHOUT switching to it, read
  // from the first workspace folder's file. The active set's pins are already at the
  // file's top level; an inactive set's pins live in `sets`. Used by the branch-set
  // binder's link command to offer an on-switch pin from the set being linked (which
  // may be inactive, so its pins are not in the projectPins cache). Returns [] when
  // no folder is open or the name is unknown. Excludes auto/recipe pins by nature —
  // those are recomputed, never stored in a set, so a file read yields only the
  // user's explicit pins (a meaningful run target).
  async getSetPins(name) {
    const folder2 = workspace.workspaceFolders?.[0];
    if (!folder2) {
      return [];
    }
    const file = await this.readProjectFile(folder2);
    if (file.activeSet === name) {
      return file.pins.map((p) => ({ ...p, scope: "project" }));
    }
    const set = file.sets.find((s) => s.name === name);
    return (set?.pins ?? []).map((p) => ({ ...p, scope: "project" }));
  }
  // Switch every folder to the set named `name`, repainting the tree to its pins.
  // No-op for a folder already on that set. A folder that has never seen the name
  // gets a fresh empty set for it (keeps multi-root coherent under one name).
  async switchSet(name) {
    const target = name.trim();
    if (!target) {
      return;
    }
    let changed = false;
    for (const folder2 of workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder2);
      if (file.activeSet === target) {
        continue;
      }
      this.activateSetInFile(file, target);
      await this.writeProjectFile(folder2, file);
      changed = true;
    }
    if (changed) {
      await this.refresh();
    }
  }
  // Create a new, empty set and switch to it. Returns "exists" when the name is
  // already taken (case-insensitive, no change) or "noFolder" when no workspace
  // folder is open (project sets need a folder to live in).
  async createSet(name) {
    const target = name.trim();
    const folders2 = workspace.workspaceFolders ?? [];
    if (folders2.length === 0) {
      return "noFolder";
    }
    if (this.setNamesCache.some((n) => sameSetName(n, target))) {
      return "exists";
    }
    for (const folder2 of folders2) {
      const file = await this.readProjectFile(folder2);
      if (!sameSetName(file.activeSet, target) && !file.sets.some((s) => sameSetName(s.name, target))) {
        file.sets.push({ name: target, pins: [], groups: [] });
      }
      this.activateSetInFile(file, target);
      await this.writeProjectFile(folder2, file);
    }
    await this.refresh();
    return "created";
  }
  // Rename a set (active or inactive) across all folders. A pure case change is
  // allowed; any other collision with an existing name returns "exists".
  async renameSet(oldName, newName) {
    const to = newName.trim();
    if (!to) {
      return "missing";
    }
    if (this.setNamesCache.some(
      (n) => sameSetName(n, to) && !sameSetName(n, oldName)
    )) {
      return "exists";
    }
    let found = false;
    for (const folder2 of workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder2);
      let changed = false;
      if (file.activeSet === oldName) {
        file.activeSet = to;
        changed = true;
      }
      for (const s of file.sets) {
        if (s.name === oldName) {
          s.name = to;
          changed = true;
        }
      }
      if (changed) {
        await this.writeProjectFile(folder2, file);
        found = true;
      }
    }
    if (found) {
      await this.refresh();
    }
    return found ? "renamed" : "missing";
  }
  // Delete a set across all folders. Deleting a set drops its project pins (a
  // destructive, confirmed action). Never deletes the last remaining set. When the
  // deleted set is active, the folder switches to `active` (the first remaining
  // name) so the tree is never left without an active set. The returned `active`
  // names the set now shown, so the caller can report it.
  async deleteSet(name) {
    if (this.setNamesCache.length <= 1) {
      return { outcome: "lastOne", active: this.activeSetName };
    }
    const fallback = this.setNamesCache.find((n) => !sameSetName(n, name)) ?? DEFAULT_SET_NAME;
    let found = false;
    for (const folder2 of workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder2);
      let changed = false;
      if (file.activeSet === name) {
        this.activateSetInFile(file, fallback);
        file.sets = file.sets.filter((s) => s.name !== name);
        changed = true;
      } else if (file.sets.some((s) => s.name === name)) {
        file.sets = file.sets.filter((s) => s.name !== name);
        changed = true;
      }
      if (changed) {
        await this.writeProjectFile(folder2, file);
        found = true;
      }
    }
    if (found) {
      await this.refresh();
    }
    return { outcome: found ? "deleted" : "missing", active: fallback };
  }
  // Duplicate a set's pins + groups under a new name and switch to it. The copy is
  // fully independent: contents are deep-cloned and given fresh ids (a shared id
  // could let an edit in one set leak into the other). Intra-set trigger /
  // dependsOn links reference pin ids, which are regenerated and not remapped, so
  // such links in the copy fail safe (a dangling dependsOn is treated as satisfied;
  // a dangling trigger resolves to nothing) — the rare cost of a clean copy.
  async duplicateSet(source, newName) {
    const to = newName.trim();
    const folders2 = workspace.workspaceFolders ?? [];
    if (folders2.length === 0) {
      return "noFolder";
    }
    if (this.setNamesCache.some((n) => sameSetName(n, to))) {
      return "exists";
    }
    for (const folder2 of folders2) {
      const file = await this.readProjectFile(folder2);
      const src = file.activeSet === source ? { pins: file.pins, groups: file.groups } : file.sets.find((s) => s.name === source);
      const contents = src ? this.cloneSetContents(src.pins, src.groups) : { pins: [], groups: [] };
      file.sets.push({ name: to, ...contents });
      this.activateSetInFile(file, to);
      await this.writeProjectFile(folder2, file);
    }
    await this.refresh();
    return "duplicated";
  }
  // Make `target` the active set within one file: stash the outgoing active set's
  // pins/groups into `sets` under its name, then hoist the target set's pins/groups
  // to the top level (an empty set when the folder has never seen the name).
  // Mutates `file` in place; the caller persists. Keeps exactly one copy of each
  // name across {active, sets}. Precondition: file.activeSet !== target.
  activateSetInFile(file, target) {
    const incoming = file.sets.find((s) => s.name === target);
    const outgoing = {
      name: file.activeSet,
      pins: file.pins,
      groups: file.groups
    };
    file.sets = file.sets.filter(
      (s) => s.name !== target && s.name !== outgoing.name
    );
    file.sets.push(outgoing);
    file.activeSet = target;
    file.pins = incoming?.pins ?? [];
    file.groups = incoming?.groups ?? [];
  }
  // Deep-clone a set's pins + groups with fresh ids for a duplicate. Groups get new
  // ids and each pin's groupId is remapped to the cloned group, so the copy's
  // grouping is self-contained. JSON clone first so nested exec/action/schedule
  // objects are not shared with the source set.
  cloneSetContents(pins, groups) {
    const groupIdMap = /* @__PURE__ */ new Map();
    const clonedGroups = JSON.parse(JSON.stringify(groups)).map(
      (g) => {
        const newGroupId = this.newId();
        groupIdMap.set(g.id, newGroupId);
        g.id = newGroupId;
        return g;
      }
    );
    const clonedPins = JSON.parse(JSON.stringify(pins)).map((p) => {
      p.id = this.newId();
      if (p.groupId) {
        p.groupId = groupIdMap.get(p.groupId);
      }
      return p;
    });
    return { pins: clonedPins, groups: clonedGroups };
  }
  // --- groups ------------------------------------------------------------
  // Create a new group in a scope. Global groups live in globalState; a project
  // group is created in the first workspace folder (multi-root group ownership
  // is refined in a later step). Returns the new group id, or undefined when a
  // project group is requested with no workspace folder open.
  async createGroup(scope, label) {
    const trimmed = label.trim();
    if (!trimmed) {
      return void 0;
    }
    if (scope === "global") {
      const groups = this.readGlobalGroups();
      const id2 = this.newId();
      groups.push({ id: id2, label: trimmed, order: groups.length });
      await this.writeGlobalGroups(groups);
      await this.refresh();
      return id2;
    }
    const folder2 = workspace.workspaceFolders?.[0];
    if (!folder2) {
      return void 0;
    }
    const file = await this.readProjectFile(folder2);
    const id = this.newId();
    file.groups.push({ id, label: trimmed, order: file.groups.length });
    await this.writeProjectFile(folder2, file);
    await this.refresh();
    return id;
  }
  async renameGroup(group, scope, label) {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }
    await this.mutateGroup(group, scope, (target) => {
      target.label = trimmed;
    });
  }
  // Delete a group and re-parent its pins to the scope's top level (no data
  // loss). Returns how many pins were re-parented so the caller can report it.
  async deleteGroup(group, scope) {
    if (scope === "global") {
      const pins = this.readGlobalPins();
      let reparented2 = 0;
      for (const pin of pins) {
        if (pin.groupId === group.id) {
          pin.groupId = void 0;
          reparented2++;
        }
      }
      const groups = this.readGlobalGroups().filter((g) => g.id !== group.id);
      await this.writeGlobalPins(pins);
      await this.writeGlobalGroups(groups);
      await this.refresh();
      return reparented2;
    }
    const folder2 = this.projectGroupFolder.get(group.id);
    if (!folder2) {
      return 0;
    }
    const file = await this.readProjectFile(folder2);
    let reparented = 0;
    for (const pin of file.pins) {
      if (pin.groupId === group.id) {
        pin.groupId = void 0;
        reparented++;
      }
    }
    for (const id of Object.keys(file.autoGroups)) {
      if (file.autoGroups[id] === group.id) {
        delete file.autoGroups[id];
        reparented++;
      }
    }
    file.groups = file.groups.filter((g) => g.id !== group.id);
    await this.writeProjectFile(folder2, file);
    await this.refresh();
    return reparented;
  }
  // Persist a group's collapsed state so a folder keeps its open/closed posture
  // across sessions. No refresh: the tree already reflects the user's gesture.
  async setGroupCollapsed(group, scope, collapsed) {
    if (isSyntheticRecipeGroupId(group.id)) {
      await this.context.globalState.update(
        RECIPE_GROUP_EXPANDED_PREFIX + group.id,
        !collapsed
      );
      return;
    }
    await this.mutateGroup(group, scope, (target) => {
      target.collapsed = collapsed;
    });
  }
  // Move (and reorder) pins into a drop target's group and position. Auto-pins
  // ARE movable: they cannot store a groupId on the (recomputed) pin, so their
  // folder membership is persisted in the project file's autoGroups sidecar
  // instead (see moveProjectPins). Recipe pins are skipped (they live in the
  // separate Recipes section with their own synthetic groups). Cross-scope moves
  // are skipped (project paths are folder-relative, global are absolute — they
  // are not interchangeable without re-resolving the path).
  async movePins(dragged, target) {
    const movable = dragged.filter(
      (p) => !p.isRecipe && p.scope === target.scope
    );
    if (movable.length === 0) {
      return;
    }
    if (target.scope === "global") {
      await this.moveGlobalPins(movable, target.groupId, target.beforePinId);
    } else {
      await this.moveProjectPins(movable, target.groupId, target.beforePinId);
    }
    await this.refresh();
  }
  async moveGlobalPins(movable, groupId, beforePinId) {
    const pins = this.readGlobalPins();
    const movedIds = new Set(movable.map((p) => p.id));
    for (const pin of pins) {
      if (movedIds.has(pin.id)) {
        pin.groupId = groupId;
      }
    }
    this.reorderWithin(pins, groupId, movedIds, beforePinId);
    await this.writeGlobalPins(pins);
  }
  async moveProjectPins(movable, groupId, beforePinId) {
    const folder2 = groupId ? this.projectGroupFolder.get(groupId) : beforePinId ? this.projectPinFolder.get(beforePinId) : this.projectPinFolder.get(movable[0].id);
    if (!folder2) {
      return;
    }
    const inFolder = movable.filter(
      (p) => this.projectPinFolder.get(p.id) === folder2
    );
    if (inFolder.length === 0) {
      return;
    }
    const file = await this.readProjectFile(folder2);
    const storedMovedIds = /* @__PURE__ */ new Set();
    for (const pin of inFolder) {
      if (pin.isAuto) {
        if (groupId) {
          file.autoGroups[pin.id] = groupId;
        } else {
          delete file.autoGroups[pin.id];
        }
      } else {
        storedMovedIds.add(pin.id);
      }
    }
    for (const pin of file.pins) {
      if (storedMovedIds.has(pin.id)) {
        pin.groupId = groupId;
      }
    }
    this.reorderWithin(file.pins, groupId, storedMovedIds, beforePinId);
    await this.writeProjectFile(folder2, file);
  }
  // Renumber a single group's members (mutating the shared Pin objects in `all`)
  // so the moved pins land before `beforePinId`, or at the end when it is absent.
  // Operates only on the target group's members; other groups keep their order.
  reorderWithin(all, groupId, movedIds, beforePinId) {
    const members = all.filter((p) => (p.groupId ?? void 0) === (groupId ?? void 0));
    const moved = members.filter((p) => movedIds.has(p.id));
    const rest = members.filter((p) => !movedIds.has(p.id));
    let index = beforePinId ? rest.findIndex((p) => p.id === beforePinId) : -1;
    if (index < 0) {
      index = rest.length;
    }
    const ordered = [...rest.slice(0, index), ...moved, ...rest.slice(index)];
    ordered.forEach((pin, i) => {
      pin.order = i;
    });
  }
  // Find a group by id in its owning store, apply a mutation, persist, refresh.
  async mutateGroup(group, scope, apply) {
    if (scope === "global") {
      const groups = this.readGlobalGroups();
      const target2 = groups.find((g) => g.id === group.id);
      if (!target2) {
        return;
      }
      apply(target2);
      await this.writeGlobalGroups(groups);
      await this.refresh();
      return;
    }
    const folder2 = this.projectGroupFolder.get(group.id);
    if (!folder2) {
      return;
    }
    const file = await this.readProjectFile(folder2);
    const target = file.groups.find((g) => g.id === group.id);
    if (!target) {
      return;
    }
    apply(target);
    await this.writeProjectFile(folder2, file);
    await this.refresh();
  }
  // Drop the cached glob/detection scans, then refresh. Use this for the triggers
  // that can change which files match — workspace folders changed, the auto-pin or
  // recipe settings edited, or the user invoking Refresh — so a genuine rescan
  // happens. A pin mutation deliberately does NOT call this: it reuses the caches
  // (refresh alone), which is what makes a pin appear instantly.
  async rescan() {
    this.autoPinScanCache.clear();
    this.recipeResultsCache.clear();
    await this.refresh();
  }
  // Recompute cached project + global pins (including freshly seeded auto-pins)
  // and notify listeners (the tree) to repaint.
  async refresh() {
    this.projectPinFolder.clear();
    this.projectGroupFolder.clear();
    const project = [];
    const projectGroups = [];
    const folders2 = workspace.workspaceFolders ?? [];
    const patterns = this.autoPinPatterns();
    let firstActiveSet;
    const setNames = /* @__PURE__ */ new Set();
    for (const folder2 of folders2) {
      await this.ensureProjectFile(folder2);
      const file = await this.readProjectFile(folder2);
      if (firstActiveSet === void 0) {
        firstActiveSet = file.activeSet;
      }
      setNames.add(file.activeSet);
      for (const s of file.sets) {
        setNames.add(s.name);
      }
      for (const group of file.groups) {
        this.projectGroupFolder.set(group.id, folder2);
        projectGroups.push(group);
      }
      for (const pin of file.pins) {
        pin.scope = "project";
        this.projectPinFolder.set(pin.id, folder2);
        project.push(pin);
      }
      const autoPins = await this.seedAutoPins(
        folder2,
        patterns,
        file.removedAutoPins,
        file.autoGroups
      );
      for (const pin of autoPins) {
        this.projectPinFolder.set(pin.id, folder2);
        project.push(pin);
      }
      const configPin = this.configExamplePin(folder2, file, autoPins);
      if (configPin) {
        this.projectPinFolder.set(configPin.id, folder2);
        project.push(configPin);
      }
    }
    this.activeSetName = firstActiveSet ?? DEFAULT_SET_NAME;
    this.setNamesCache = Array.from(setNames).sort(
      (a, b) => a.localeCompare(b, void 0, { sensitivity: "base" })
    );
    project.sort((a, b) => a.order - b.order);
    this.baseProjectPins = project;
    this.projectPins = project;
    this.projectGroups = [...projectGroups].sort((a, b) => a.order - b.order);
    this.globalPins = this.readGlobalPins().sort((a, b) => a.order - b.order);
    this.globalGroups = this.readGlobalGroups().sort((a, b) => a.order - b.order);
    this._onDidChange.fire();
    void this.seedRecipesAsync(++this.recipeGen);
    void this.recomputeMissing(++this.missingGen);
  }
  // Stat every resolved file pin and record the ones whose target is gone, so the
  // tree can flag a deleted pin instead of letting a click hit a raw "file does not
  // exist" error. Runs after the first paint (never blocks activation) and repaints
  // only when the missing set changed. Recipe / url / shell / command / macro pins
  // are skipped: they have no single file on disk. A pin whose owning folder cannot
  // be resolved is skipped here too — that distinct state is already flagged by the
  // tree's !resolvedUri branch, so counting it here would double-handle it.
  async recomputeMissing(gen) {
    const filePins = [...this.projectPins, ...this.globalPins].filter(
      (p) => !p.isRecipe && pinKind(p) === "file"
    );
    const next = /* @__PURE__ */ new Set();
    await Promise.all(
      filePins.map(async (pin) => {
        const uri = this.resolveUri(pin);
        if (!uri) {
          return;
        }
        try {
          await workspace.fs.stat(uri);
        } catch {
          next.add(pin.id);
        }
      })
    );
    if (gen !== this.missingGen) {
      return;
    }
    if (!setsEqual(this.missingPinIds, next)) {
      this.missingPinIds = next;
      this._onDidChange.fire();
    }
  }
  // Detect recipes for all folders in parallel, fault-isolated per folder, and
  // publish them into the separate recipe-groups list + the project pin list (the
  // tree renders recipe pins under their own "Recipes" section, not the Project
  // scope). Guarded by a generation token so a stale run (a newer refresh started)
  // is discarded rather than overwriting fresh state. Detection itself is cached
  // per folder (see detectRecipes), so a refresh that is not the first does no file
  // IO for recipes — only the cheap removed-filter + pin rebuild.
  async seedRecipesAsync(gen) {
    if (!this.recipesEnabled()) {
      this.recipeGroups = [];
      this.projectPins = this.baseProjectPins;
      this._onDidChange.fire();
      return;
    }
    const folders2 = workspace.workspaceFolders ?? [];
    const perFolder = await Promise.all(
      folders2.map(async (folder2) => {
        try {
          const file = await this.readProjectFile(folder2);
          const results = await this.detectRecipes(folder2);
          const pins = this.buildRecipePins(folder2, results, file.removedRecipes);
          return { folder: folder2, pins };
        } catch (err) {
          getOutputChannel().appendLine(
            `[recipes] detection failed for ${folder2.name}: ${err instanceof Error ? err.message : String(err)}`
          );
          return { folder: folder2, pins: [] };
        }
      })
    );
    if (gen !== this.recipeGen) {
      return;
    }
    const recipePins = [];
    for (const { folder: folder2, pins } of perFolder) {
      for (const pin of pins) {
        this.projectPinFolder.set(pin.id, folder2);
        recipePins.push(pin);
      }
    }
    const groups = [];
    for (const def of RECIPE_GROUPS) {
      const subDefs = RECIPE_SUBGROUPS.filter((s) => s.parentId === def.id);
      const hasDirectPin = recipePins.some((p) => p.groupId === def.id);
      const hasChildPin = subDefs.some(
        (sd) => recipePins.some((p) => p.groupId === sd.id)
      );
      if (hasDirectPin || hasChildPin) {
        groups.push({
          id: def.id,
          label: def.label,
          order: def.order,
          collapsed: !this.recipeGroupExpanded(def.id),
          icon: def.icon,
          color: def.color
        });
      }
      for (const sd of subDefs) {
        if (recipePins.some((p) => p.groupId === sd.id)) {
          groups.push({
            id: sd.id,
            label: sd.label,
            order: sd.order,
            parentId: sd.parentId,
            collapsed: !this.recipeGroupExpanded(sd.id),
            icon: sd.icon,
            color: sd.color
          });
        }
      }
    }
    this.recipeGroups = groups;
    this.projectPins = [...this.baseProjectPins, ...recipePins].sort(
      (a, b) => a.order - b.order
    );
    this._onDidChange.fire();
  }
  // --- auto-pins ---------------------------------------------------------
  autoPinPatterns() {
    return workspace.getConfiguration("saropaWorkspace").get("autoPins.patterns", []);
  }
  // The auto-pin GLOB result per folder (matched relative paths only). The glob
  // (findFiles per pattern across the workspace) is the dominant cost of a
  // refresh; a pin add/remove/move/configure cannot change which files MATCH the
  // patterns, so re-globbing on every mutation was the "pinning is slow" cause.
  // Cached here and reused across refreshes; cleared by rescan() on the triggers
  // that actually change the match set (folder or setting change, manual Refresh,
  // reload). New files matching a pattern surface on the next rescan/reload.
  autoPinScanCache = /* @__PURE__ */ new Map();
  // Glob the auto-pin patterns for a folder, returning the matched relative paths.
  // Cached per folder uri so a mutation-triggered refresh reuses the scan instead
  // of hitting the filesystem again.
  async scanAutoPinPaths(folder2, patterns) {
    const key = folder2.uri.toString();
    const cached = this.autoPinScanCache.get(key);
    if (cached) {
      return cached;
    }
    const paths = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (relative2) => {
      if (!seen.has(relative2)) {
        seen.add(relative2);
        paths.push(relative2);
      }
    };
    for (const pattern of patterns) {
      if (!isGlobPattern(pattern)) {
        const uri = Uri.joinPath(folder2.uri, pattern);
        try {
          const stat = await workspace.fs.stat(uri);
          if (stat.type === FileType.File) {
            add(this.toFolderRelative(folder2, uri));
          }
        } catch {
        }
        continue;
      }
      const matches = await workspace.findFiles(
        new RelativePattern(folder2, pattern),
        "**/node_modules/**",
        50
      );
      for (const uri of matches) {
        add(this.toFolderRelative(folder2, uri));
      }
    }
    this.autoPinScanCache.set(key, paths);
    return paths;
  }
  async seedAutoPins(folder2, patterns, removed, autoGroups) {
    const paths = await this.scanAutoPinPaths(folder2, patterns);
    const pins = [];
    for (const relative2 of paths) {
      const id = `auto:${folder2.name}:${relative2}`;
      if (removed.includes(id)) {
        continue;
      }
      pins.push({
        id,
        path: relative2,
        scope: "project",
        isAuto: true,
        // Re-apply the folder the user dragged this auto-pin into, if any.
        groupId: autoGroups[id],
        order: 1e3 + pins.length
        // auto-pins sort after explicit pins
      });
    }
    return pins;
  }
  // Build the synthetic "Workspace config" example pin for a folder, or undefined
  // when it should not appear. It links to the folder's own config file so a
  // brand-new project still has one working pin. Returns undefined when the user
  // removed it (sticky via removedAutoPins) or when a stored/auto pin already
  // targets the config file, which avoids duplicating a project's own committed
  // config pin (e.g. this repo's sample-config). The id matches the auto-pin
  // scheme so removePin's isAuto branch suppresses it the same way.
  configExamplePin(folder2, file, autoPins) {
    const id = `auto:${folder2.name}:${PROJECT_FILE_RELATIVE}`;
    if (file.removedAutoPins.includes(id)) {
      return void 0;
    }
    const alreadyPinned = file.pins.some((p) => p.path === PROJECT_FILE_RELATIVE) || autoPins.some((p) => p.path === PROJECT_FILE_RELATIVE);
    if (alreadyPinned) {
      return void 0;
    }
    return {
      id,
      path: PROJECT_FILE_RELATIVE,
      label: l10n("pin.sampleConfig"),
      scope: "project",
      isAuto: true,
      // Re-apply the folder the user dragged the config pin into, if any.
      groupId: file.autoGroups[id],
      // Negative order sorts it ahead of explicit pins (order >= 0), so the
      // example sits at the top of the Project scope.
      order: -1
    };
  }
  // --- recipes -----------------------------------------------------------
  recipesEnabled() {
    return workspace.getConfiguration("saropaWorkspace").get("recipes.enabled", true);
  }
  recipeGroupExpanded(id) {
    return this.context.globalState.get(
      RECIPE_GROUP_EXPANDED_PREFIX + id,
      false
    );
  }
  // The expensive half of recipe seeding: run the three detector sweeps (dozens of
  // folder-root file reads) and sort the results A->Z by label so each group reads
  // in a stable order. Cached per folder so subsequent refreshes reuse the sweep —
  // this is what stops a refresh from re-reading the whole project every time. New
  // recipes from newly-created files appear on the next window reload.
  async detectRecipes(folder2) {
    const key = folder2.uri.toString();
    const cached = this.recipeResultsCache.get(key);
    if (cached) {
      return cached;
    }
    const results = [
      ...await detectOnDemandRecipes(folder2),
      ...await detectScheduledRecipes(folder2),
      ...await detectSuiteRecipes(folder2),
      ...await detectProcessRecipes(folder2),
      ...await detectHygieneRecipes(folder2),
      ...await detectAiContextRecipes(folder2)
    ];
    results.push(...detectRoutineRecipes(results));
    results.sort(
      (a, b) => a.label.localeCompare(b.label, void 0, { sensitivity: "base" })
    );
    this.recipeResultsCache.set(key, results);
    return results;
  }
  // The cheap half: turn cached detection into recipe pins (isRecipe), dropping the
  // ones the user removed (sticky via removedRecipes). `order` is a single ascending
  // counter so each group's members stay alphabetical (the detect sort above);
  // groupId routes each pin to its synthetic recipe group.
  buildRecipePins(folder2, results, removed) {
    const pins = [];
    let order = 2e3;
    for (const r of results) {
      if (removed.includes(r.recipeId)) {
        continue;
      }
      pins.push({
        id: `recipe:${folder2.name}:${r.recipeId}`,
        path: r.filePath ?? "",
        label: r.label,
        scope: "project",
        isRecipe: true,
        recipeId: r.recipeId,
        description: r.description,
        action: r.action,
        schedule: r.schedule,
        icon: r.icon,
        // Fall back to the category's color so every leaf in a subfolder shares its
        // color family (the folder and its items read as one group); an explicit
        // per-recipe color still wins.
        color: r.color ?? recipeGroupColor(r.group),
        // A recipe with a per-tool subGroup (the suite recipes) lands in the nested
        // subgroup; everything else lands directly in its category's top-level group.
        groupId: r.subGroup ? recipeSubGroupId(recipeGroupId(r.group), r.subGroup) : recipeGroupId(r.group),
        order: order++
      });
    }
    return pins;
  }
  // Re-add every removed recipe across all folders (the Restore counterpart for
  // recipes). Returns how many suppressions were cleared.
  async restoreRecipes() {
    let restored = 0;
    for (const folder2 of workspace.workspaceFolders ?? []) {
      const file = await this.readProjectFile(folder2);
      if (file.removedRecipes.length > 0) {
        restored += file.removedRecipes.length;
        file.removedRecipes = [];
        await this.writeProjectFile(folder2, file);
      }
    }
    if (restored > 0) {
      await this.refresh();
    }
    return restored;
  }
  // Convert a recipe into a stored, fully-editable pin: suppress the seeded recipe
  // (so it does not duplicate) and add an equivalent explicit pin carrying its
  // action/path, label, and appearance. Returns false for a non-recipe pin.
  async promoteRecipe(pin) {
    if (!pin.isRecipe || !pin.recipeId) {
      return false;
    }
    const folder2 = this.projectPinFolder.get(pin.id);
    if (!folder2) {
      return false;
    }
    const file = await this.readProjectFile(folder2);
    if (!file.removedRecipes.includes(pin.recipeId)) {
      file.removedRecipes.push(pin.recipeId);
    }
    file.pins.push({
      id: this.newId(),
      path: pin.path,
      label: pin.label,
      scope: "project",
      action: pin.action,
      schedule: pin.schedule,
      icon: pin.icon,
      color: pin.color,
      description: pin.description,
      order: file.pins.length
    });
    await this.writeProjectFile(folder2, file);
    await this.refresh();
    return true;
  }
  // --- project file IO ---------------------------------------------------
  projectFileUri(folder2) {
    return Uri.joinPath(folder2.uri, PROJECT_FILE_RELATIVE);
  }
  // Create an empty .vscode/saropa-workspace.json for a folder that has none.
  // Existing files are never touched (stat-then-skip), so user pins are safe and a
  // present file is not rewritten on every refresh. A write failure (read-only
  // folder, virtual/no-write filesystem) is swallowed and logged: the in-memory
  // empty state still renders, matching the prior no-file behavior.
  async ensureProjectFile(folder2) {
    const uri = this.projectFileUri(folder2);
    try {
      await workspace.fs.stat(uri);
      return;
    } catch {
    }
    try {
      await this.writeProjectFile(folder2, emptyProjectPinsFile());
    } catch (err) {
      getOutputChannel().appendLine(
        `[config] could not create ${PROJECT_FILE_RELATIVE} for ${folder2.name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  async readProjectFile(folder2) {
    try {
      const bytes = await workspace.fs.readFile(this.projectFileUri(folder2));
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
      return {
        version: PROJECT_PINS_VERSION,
        pins: Array.isArray(parsed.pins) ? parsed.pins : [],
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        // A non-empty string wins; anything else (missing/blank/non-string from a
        // v2 file or a bad hand-edit) falls back to the default set name.
        activeSet: typeof parsed.activeSet === "string" && parsed.activeSet.trim().length > 0 ? parsed.activeSet : DEFAULT_SET_NAME,
        // Only well-formed, named sets survive the read; each set's pins/groups
        // default to [] when absent so a partial hand-edit can't throw later.
        sets: Array.isArray(parsed.sets) ? parsed.sets.filter(
          (s) => !!s && typeof s.name === "string" && s.name.trim().length > 0
        ).map((s) => ({
          name: s.name,
          pins: Array.isArray(s.pins) ? s.pins : [],
          groups: Array.isArray(s.groups) ? s.groups : []
        })) : [],
        removedAutoPins: Array.isArray(parsed.removedAutoPins) ? parsed.removedAutoPins : [],
        removedRecipes: Array.isArray(parsed.removedRecipes) ? parsed.removedRecipes : [],
        // A v1/v2 file (or one written before auto-pin grouping) has no
        // autoGroups; it reads as an empty map and every auto-pin stays at top
        // level until the user drags one into a folder.
        autoGroups: parsed.autoGroups && typeof parsed.autoGroups === "object" ? parsed.autoGroups : {}
      };
    } catch {
      return emptyProjectPinsFile();
    }
  }
  async writeProjectFile(folder2, file) {
    const uri = this.projectFileUri(folder2);
    await workspace.fs.createDirectory(Uri.joinPath(folder2.uri, ".vscode"));
    const json = JSON.stringify(file, null, 2) + "\n";
    await workspace.fs.writeFile(uri, Buffer.from(json, "utf8"));
  }
  // --- global state IO ---------------------------------------------------
  readGlobalPins() {
    const pins = this.context.globalState.get(GLOBAL_STATE_KEY, []);
    return pins.map((p) => ({ ...p, scope: "global" }));
  }
  async writeGlobalPins(pins) {
    await this.context.globalState.update(GLOBAL_STATE_KEY, pins);
  }
  readGlobalGroups() {
    return this.context.globalState.get(GLOBAL_GROUPS_KEY, []);
  }
  async writeGlobalGroups(groups) {
    await this.context.globalState.update(GLOBAL_GROUPS_KEY, groups);
  }
  // --- helpers -----------------------------------------------------------
  toFolderRelative(folder2, uri) {
    const base = folder2.uri.fsPath;
    let rel = uri.fsPath.startsWith(base) ? uri.fsPath.slice(base.length) : uri.fsPath;
    rel = rel.replace(/\\/g, "/").replace(/^\/+/, "");
    return rel;
  }
  newId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
};

// src/import/favoritesSettings.ts
var path2 = __toESM(require("path"));
var SABITOVVT_SETTINGS_KEYS = [
  "favoritesPanel.commands",
  "favoritesPanel.commandsForWorkspace"
];
var SABITOVVT_SOURCE_LABEL = "favoritesPanel.commands";
var SABITOVVT_CONFIG_PATH_KEYS = [
  "favoritesPanel.configPath",
  "favoritesPanel.configPathForWorkspace"
];
var SABITOVVT_CONFIG_SOURCE_LABEL = "favoritesPanel.configPath";
function argString(args, i) {
  const v = args?.[i];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : void 0;
}
function mapSabitovvtStep(command2, args) {
  if (command2 === "openFile") {
    const p = argString(args, 0);
    return p ? { kind: "open", path: p } : null;
  }
  if (command2 === "run") {
    const cmd = argString(args, 0);
    return cmd ? { kind: "shell", shellCommand: cmd } : null;
  }
  if (command2 === "runCommand") {
    const first = argString(args, 0);
    if (first === "vscode.open") {
      const url4 = argString(args, 1);
      return url4 ? { kind: "url", url: url4 } : null;
    }
    return first ? { kind: "command", commandId: first, commandArgs: args?.slice(1) } : null;
  }
  return null;
}
function mapSabitovvtItem(item, folder2) {
  if (item.command === "openFile") {
    const p = argString(item.arguments, 0);
    if (!p || !folder2) {
      return "skip";
    }
    return {
      file: path2.isAbsolute(p) ? Uri.file(p) : Uri.joinPath(folder2.uri, p)
    };
  }
  if (Array.isArray(item.sequence)) {
    const steps = [];
    for (const s of item.sequence) {
      const step2 = mapSabitovvtStep(s.command, s.arguments);
      if (!step2) {
        return "skip";
      }
      steps.push(step2);
    }
    return steps.length > 0 ? { action: { kind: "macro", steps } } : "skip";
  }
  const step = mapSabitovvtStep(item.command, item.arguments);
  if (!step || step.kind === "open") {
    return "skip";
  }
  if (step.kind === "shell") {
    return { action: { kind: "shell", shellCommand: step.shellCommand, useIntegratedTerminal: true } };
  }
  if (step.kind === "url") {
    return { action: { kind: "url", url: step.url } };
  }
  return { action: { kind: "command", commandId: step.commandId, commandArgs: step.commandArgs } };
}
function actionSignature(label, action) {
  return JSON.stringify({ label: label ?? "", action });
}
function isImportableSabitovvtItem(i) {
  return !!i && typeof i === "object" && typeof i.label === "string" && (i.command !== void 0 || Array.isArray(i.sequence));
}
async function readSabitovvtConfigFileItems(channel) {
  const config = workspace.getConfiguration();
  const firstFolder = workspace.workspaceFolders?.[0];
  const items = [];
  for (const key of SABITOVVT_CONFIG_PATH_KEYS) {
    const raw = config.get(key);
    if (typeof raw !== "string" || raw.trim().length === 0) {
      continue;
    }
    const value = raw.trim();
    let uri;
    if (path2.isAbsolute(value)) {
      uri = Uri.file(value);
    } else if (firstFolder) {
      uri = Uri.joinPath(firstFolder.uri, value);
    } else {
      continue;
    }
    let bytes;
    try {
      bytes = await workspace.fs.readFile(uri);
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
      if (Array.isArray(parsed)) {
        items.push(...parsed);
      } else if (parsed && typeof parsed === "object") {
        const wrapped = parsed[SABITOVVT_SOURCE_LABEL];
        if (Array.isArray(wrapped)) {
          items.push(...wrapped);
        }
      }
    } catch (err) {
      channel?.appendLine(
        l10n("import.log.malformed", {
          file: value,
          error: err instanceof Error ? err.message : String(err)
        })
      );
    }
  }
  return items;
}
async function detectSabitovvtFavoritesCount() {
  const config = workspace.getConfiguration();
  const items = [];
  for (const key of SABITOVVT_SETTINGS_KEYS) {
    const arr = config.get(key);
    if (Array.isArray(arr)) {
      items.push(...arr);
    }
  }
  items.push(...await readSabitovvtConfigFileItems());
  return items.filter(isImportableSabitovvtItem).length;
}
async function importSabitovvtItemList(items, sourceLabel, folder2, store, channel, seenActions) {
  let added = 0;
  let skipped = 0;
  for (const raw of items) {
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (label.length === 0) {
      channel.appendLine(l10n("import.log.skipSetting", { key: sourceLabel }));
      skipped++;
      continue;
    }
    const mapped = mapSabitovvtItem(raw, folder2);
    if (mapped === "skip") {
      channel.appendLine(
        l10n("import.log.skipUnsupported", { file: sourceLabel, name: label })
      );
      skipped++;
      continue;
    }
    if ("file" in mapped) {
      if (!workspace.getWorkspaceFolder(mapped.file)) {
        channel.appendLine(
          l10n("import.log.skipOutsideFolder", {
            file: sourceLabel,
            path: mapped.file.fsPath
          })
        );
        skipped++;
        continue;
      }
      if (await store.addPin(mapped.file, "project", label)) {
        added++;
      }
      continue;
    }
    const sig = actionSignature(label, mapped.action);
    if (seenActions.has(sig)) {
      continue;
    }
    const icon = typeof raw.icon === "string" && raw.icon.trim() ? raw.icon.trim() : void 0;
    const color2 = typeof raw.iconColor === "string" && raw.iconColor.trim() ? raw.iconColor.trim() : void 0;
    if (await store.importPin({ v: 1, label, action: mapped.action, icon, color: color2 }, "project")) {
      seenActions.add(sig);
      added++;
    }
  }
  return { added, skipped };
}
async function importSabitovvtFavorites(store) {
  const channel = getOutputChannel();
  const config = workspace.getConfiguration();
  const folder2 = workspace.workspaceFolders?.[0];
  const seenActions = new Set(
    store.getProjectPins().filter((p) => p.action).map((p) => actionSignature(p.label, p.action))
  );
  let added = 0;
  let skipped = 0;
  for (const key of SABITOVVT_SETTINGS_KEYS) {
    const items = config.get(key);
    if (!Array.isArray(items)) {
      continue;
    }
    const result = await importSabitovvtItemList(
      items,
      SABITOVVT_SOURCE_LABEL,
      folder2,
      store,
      channel,
      seenActions
    );
    added += result.added;
    skipped += result.skipped;
  }
  const fileItems = await readSabitovvtConfigFileItems(channel);
  if (fileItems.length > 0) {
    const result = await importSabitovvtItemList(
      fileItems,
      SABITOVVT_CONFIG_SOURCE_LABEL,
      folder2,
      store,
      channel,
      seenActions
    );
    added += result.added;
    skipped += result.skipped;
  }
  return { added, skipped };
}

// src/test/sabitovvtImport.test.ts
var tmpDir;
var folder;
function actionPins(store) {
  return store.getProjectPins().filter((p) => p.action !== void 0);
}
function findByLabel(store, label) {
  return store.getProjectPins().find((p) => p.label === label);
}
(0, import_node_test.beforeEach)(() => {
  __resetConfig();
  __setConfig("saropaWorkspace", "recipes.enabled", false);
  tmpDir = nodeFs2.mkdtempSync(nodePath2.join(os2.tmpdir(), "sw-sabitovvt-")).replace(/\\/g, "/");
  folder = { uri: Uri.file(tmpDir), name: "proj", index: 0 };
  __setWorkspaceFolders([folder]);
});
(0, import_node_test.afterEach)(() => {
  __setWorkspaceFolders(void 0);
  __resetConfig();
  nodeFs2.rmSync(tmpDir, { recursive: true, force: true });
});
function setCommands(items) {
  __setConfig("", "favoritesPanel.commands", items);
}
(0, import_node_test.test)("each command kind maps to its pin kind (openFile/run/runCommand url+command)", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  setCommands([
    { label: "Server", command: "openFile", arguments: ["api/server.ts"] },
    { label: "Test", command: "run", arguments: ["npm test"] },
    { label: "Repo", command: "runCommand", arguments: ["vscode.open", "https://example.com"] },
    { label: "Format", command: "runCommand", arguments: ["editor.action.format", "x"] }
  ]);
  const result = await importSabitovvtFavorites(store);
  import_strict.default.equal(result.added, 4, "all four items import");
  import_strict.default.equal(result.skipped, 0, "nothing is skipped");
  const file = findByLabel(store, "Server");
  import_strict.default.ok(file, "the openFile item is pinned");
  import_strict.default.equal(file.action, void 0, "an openFile item becomes a plain file pin (no action)");
  import_strict.default.equal(file.path, "api/server.ts", "the file pin stores the folder-relative path");
  const shell3 = findByLabel(store, "Test");
  import_strict.default.equal(shell3?.action?.kind, "shell", "a run item becomes a shell pin");
  import_strict.default.equal(shell3?.action?.shellCommand, "npm test");
  const url4 = findByLabel(store, "Repo");
  import_strict.default.equal(url4?.action?.kind, "url", "runCommand vscode.open becomes a url pin");
  import_strict.default.equal(url4?.action?.url, "https://example.com");
  const command2 = findByLabel(store, "Format");
  import_strict.default.equal(command2?.action?.kind, "command", "any other runCommand becomes a command pin");
  import_strict.default.equal(command2?.action?.commandId, "editor.action.format");
  import_strict.default.deepEqual(command2?.action?.commandArgs, ["x"], "the remaining arguments are carried");
});
(0, import_node_test.test)("a sequence becomes a macro only when every step maps; one bad step skips it", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  setCommands([
    {
      label: "Boot",
      sequence: [
        { command: "openFile", arguments: ["a.ts"] },
        { command: "run", arguments: ["npm i"] }
      ]
    },
    {
      label: "Partial",
      // The insertNewCode step has no pin equivalent, so the WHOLE sequence skips
      // rather than silently dropping a step.
      sequence: [
        { command: "run", arguments: ["echo hi"] },
        { command: "insertNewCode", arguments: ["// snippet"] }
      ]
    }
  ]);
  const result = await importSabitovvtFavorites(store);
  import_strict.default.equal(result.added, 1, "only the fully-mappable sequence imports");
  import_strict.default.equal(result.skipped, 1, "the sequence with an unmappable step is skipped");
  const macro = findByLabel(store, "Boot");
  import_strict.default.equal(macro?.action?.kind, "macro", "a mappable sequence becomes a macro pin");
  import_strict.default.equal(macro?.action?.steps?.length, 2, "the macro has one step per command");
  import_strict.default.equal(macro?.action?.steps?.[0].kind, "open");
  import_strict.default.equal(macro?.action?.steps?.[1].kind, "shell");
  import_strict.default.equal(findByLabel(store, "Partial"), void 0, "the partial sequence produced no pin");
});
(0, import_node_test.test)("insertNewCode, unknown commands, and unlabeled items are reported and skipped", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  setCommands([
    { label: "Snippet", command: "insertNewCode", arguments: ["// x"] },
    { label: "Mystery", command: "doSomethingElse", arguments: ["y"] },
    { command: "run", arguments: ["npm test"] }
    // no label
  ]);
  const result = await importSabitovvtFavorites(store);
  import_strict.default.equal(result.added, 0, "no unmappable/unlabeled item imports");
  import_strict.default.equal(result.skipped, 3, "all three are skipped");
  import_strict.default.equal(actionPins(store).length, 0, "no action pin is created");
});
(0, import_node_test.test)("icon and iconColor are carried onto an action pin", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  setCommands([
    {
      label: "Build",
      icon: "rocket",
      iconColor: "charts.green",
      command: "run",
      arguments: ["npm run build"]
    }
  ]);
  await importSabitovvtFavorites(store);
  const pin = findByLabel(store, "Build");
  import_strict.default.equal(pin?.icon, "rocket", "the codicon id is carried over");
  import_strict.default.equal(pin?.color, "charts.green", "the theme-color id is carried over");
});
(0, import_node_test.test)("the same action listed twice imports once (idempotent within and across runs)", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  setCommands([
    { label: "Test", command: "run", arguments: ["npm test"] },
    { label: "Test", command: "run", arguments: ["npm test"] }
  ]);
  const first = await importSabitovvtFavorites(store);
  import_strict.default.equal(first.added, 1, "the duplicate within one run is collapsed");
  const second = await importSabitovvtFavorites(store);
  import_strict.default.equal(second.added, 0, "re-running adds no duplicate");
  import_strict.default.equal(
    actionPins(store).filter((p) => p.label === "Test").length,
    1,
    "exactly one shell pin exists"
  );
});
(0, import_node_test.test)("items in a configPath custom file import (top-level array shape)", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  const file = `${tmpDir}/custom-favorites.json`;
  nodeFs2.writeFileSync(
    file,
    JSON.stringify([{ label: "Docs", command: "openFile", arguments: ["README.md"] }])
  );
  __setConfig("", "favoritesPanel.configPath", file);
  const count = await detectSabitovvtFavoritesCount();
  import_strict.default.equal(count, 1, "the custom-file item is counted by the import gate");
  const result = await importSabitovvtFavorites(store);
  import_strict.default.equal(result.added, 1, "the custom-file item imports");
  const pin = findByLabel(store, "Docs");
  import_strict.default.ok(pin, "the custom-file file pin is created");
  import_strict.default.equal(pin.path, "README.md", "the path is stored folder-relative");
});
(0, import_node_test.test)("a configPath custom file in the legacy object-wrapper shape imports", async () => {
  const store = new PinStore(fakeContext());
  await store.init();
  const file = `${tmpDir}/legacy-favorites.json`;
  nodeFs2.writeFileSync(
    file,
    JSON.stringify({
      "favoritesPanel.commands": [
        { label: "Lint", command: "run", arguments: ["npm run lint"] }
      ]
    })
  );
  __setConfig("", "favoritesPanel.configPathForWorkspace", file);
  const result = await importSabitovvtFavorites(store);
  import_strict.default.equal(result.added, 1, "the legacy-wrapper item imports");
  const pin = findByLabel(store, "Lint");
  import_strict.default.equal(pin?.action?.kind, "shell", "the wrapped run item becomes a shell pin");
  import_strict.default.equal(pin?.action?.shellCommand, "npm run lint");
});
