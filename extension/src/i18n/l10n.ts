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
  const hit = catalog[key];
  // Dev-only missing-key warning (#34): a raw key falling through to the UI is a bug
  // (a typo, or a key added to code but never to en.json), but it must never spam a
  // production user's console — process.env.NODE_ENV is the standard Node/VS Code
  // extension-host signal for "not packaged for release" (esbuild's production build
  // sets it; the F5 dev host leaves it unset/"development"), so the warning fires
  // only while actually developing.
  if (hit === undefined && process.env.NODE_ENV !== "production") {
    console.warn(`[saropaWorkspace] missing l10n key: "${key}"`);
  }
  let value = hit ?? key;
  if (params) {
    for (const [token, replacement] of Object.entries(params)) {
      value = value.split(`{${token}}`).join(String(replacement));
    }
  }
  return value;
}
