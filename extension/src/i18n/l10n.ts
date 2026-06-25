import en from "./locales/en.json";

// Runtime (not-manifest) user-facing strings. The manifest uses VS Code's NLS
// %key% pipeline (package.nls.json); these are strings shown from code at run
// time. English is the source catalog; additional locales are added as sibling
// JSON files and selected here in a later step. Keeping every string keyed makes
// the extension translation-ready from the start (no inline English in code).

type Catalog = Record<string, string>;

const catalog: Catalog = en as Catalog;

// Look up a key and interpolate {token} placeholders. Falls back to the key
// itself if missing, so a typo is visible rather than silently empty.
export function l10n(key: string, params?: Record<string, string | number>): string {
  let value = catalog[key] ?? key;
  if (params) {
    for (const [token, replacement] of Object.entries(params)) {
      value = value.split(`{${token}}`).join(String(replacement));
    }
  }
  return value;
}
