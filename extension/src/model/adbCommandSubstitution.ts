// Template substitution for the adb command catalog (MOBILE_REMOTE_CONTROL_PLAN
// sections 3-4, build-order step 5): turns an AdbCommandEntry's `{token}`
// commandTemplate into the exact string the panel previews and the runner runs.
//
// Pure, like the catalog it consumes: no vscode import, no process, no prompt. The two
// asynchronous halves of resolution live elsewhere by design —
//   - what the PROJECT knows (application id, deep-link scheme/host, declared
//     permissions) is read from an AndroidProjectProfile and substituted literally here;
//   - what only the USER knows (a file path, a port, tap coordinates, a raw shell
//     command) is emitted as this extension's existing `${prompt:...}` / `${pick:...}`
//     run-parameter tokens, which exec/promptTokens.ts resolves at run time exactly as it
//     does for a library.json shortcut.
// That split is what makes this function testable and what keeps one templating
// convention in the product instead of two.
//
// THE INVARIANT: a `{token}` NEVER survives substitution. Every token is either resolved
// from the profile or rewritten into an interactive token, so the returned string is
// always a runnable command line — a workspace with no Android project produces
// `adb uninstall ${prompt:Application id}`, which asks, rather than
// `adb uninstall {applicationId}`, which would silently uninstall nothing. Callers that
// want to SAY "no Android project detected" read `missingFromProfile`, which names every
// token that wanted the profile and found nothing.

import { AdbCommandEntry } from "./adbCommandCatalog";
import { AndroidProjectProfile } from "./androidProjectProfile";
import { l10n } from "../i18n/l10n";

// Matches one bare `{token}` placeholder. The catalog's own convention (see its header)
// is that a token is always a bare name in braces — no default, no nesting — so a single
// scan finds every one of them.
const TOKEN_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** The outcome of substituting one catalog entry's template. */
export interface AdbSubstitution {
  // The runnable command line. Never contains a `{token}`.
  command: string;
  // Tokens filled from the project profile (or from caller-supplied params), token name
  // to the literal value used. What the dry-run preview can claim was auto-filled.
  resolved: Record<string, string>;
  // Tokens rewritten into `${prompt:...}` / `${pick:...}`, in first-seen order. Non-empty
  // means running this command will ask the user something first.
  interactive: string[];
  // Tokens the PROFILE was expected to answer but could not — today only
  // `applicationId`, `scheme` and `host` (on a deep-link entry), i.e. exactly the
  // "no Android project detected in this workspace" case. These also appear in
  // `interactive` (they degrade to a prompt rather than breaking the string); this list
  // is what lets the UI explain WHY it is about to ask.
  missingFromProfile: string[];
}

/** Every `{token}` in a template, in first-seen order and de-duplicated. */
export function extractAdbTokens(template: string): string[] {
  const seen: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(template)) !== null) {
    if (!seen.includes(match[1])) {
      seen.push(match[1]);
    }
  }
  return seen;
}

// An interactive token in this extension's existing run-parameter syntax. A single
// candidate collapses to a literal (nothing to choose), several become a `${pick:...}`
// so the user picks a flavor/permission rather than retyping it, and none becomes a
// free-text `${prompt:...}`.
function interactiveToken(kind: "prompt" | "pick", arg: string): string {
  return `\${${kind}:${arg}}`;
}

// The human label a `${prompt:...}` carries, keyed by token name. An unknown token (one
// a future catalog entry introduces before this module learns about it) falls back to
// the token's own name, so it still asks a sensible question instead of throwing.
function promptLabel(token: string): string {
  const key = `adb.token.${token}`;
  const text = l10n(key);
  return text === key ? token : text;
}

// Distinct, non-empty values in first-seen order. Used for the flavor / permission /
// deep-link candidate lists, where duplicates are common (several build types resolving
// to the same application id) and an empty entry must not become an empty pick option.
function distinct(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value !== "" && !out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

// What the profile offers for a given token, as an ordered candidate list. An empty list
// means "the profile cannot answer this" — for the three project-scoped tokens that is
// the no-Android-project case; for everything else (ports, paths, coordinates) the
// profile was never expected to know, and the empty list is simply the normal path to a
// prompt. `deepLinksOnly` distinguishes the two meanings of `{host}`: a deep link's
// authority (from the manifest) versus a wireless-debugging endpoint (never in the
// profile, always asked).
function profileCandidates(
  token: string,
  entry: AdbCommandEntry,
  profile: AndroidProjectProfile | undefined
): { candidates: string[]; fromProfile: boolean } {
  const isDeepLink = entry.group === "deepLinks";
  switch (token) {
    case "applicationId": {
      const ids = profile
        ? [
            ...(profile.defaultApplicationId ? [profile.defaultApplicationId] : []),
            ...profile.applicationIds.map((v) => v.applicationId),
          ]
        : [];
      return { candidates: distinct(ids), fromProfile: true };
    }
    case "scheme":
      return {
        candidates: distinct((profile?.deepLinks ?? []).map((d) => d.scheme)),
        fromProfile: true,
      };
    case "host":
      if (!isDeepLink) {
        // A connect/disconnect endpoint, not a manifest authority.
        return { candidates: [], fromProfile: false };
      }
      return {
        candidates: distinct((profile?.deepLinks ?? []).map((d) => d.host)),
        // A deep link declared with a scheme but no authority is a legitimate empty
        // host, so "the profile has deep links at all" — not "this list is non-empty" —
        // decides whether the profile answered. Handled by the caller via the
        // hasDeepLinks check below.
        fromProfile: true,
      };
    case "permission":
      // Not a profile FACT the way an application id is: the manifest's declared
      // permissions are a convenient candidate list for the pick, but a user may
      // legitimately grant one the manifest does not declare, so an empty list is a
      // plain prompt and never a "missing from profile" complaint.
      return { candidates: distinct(profile?.permissions ?? []), fromProfile: false };
    default:
      return { candidates: [], fromProfile: false };
  }
}

/**
 * Substitute one catalog entry's `{token}` template into a runnable command line.
 *
 * `params` (a caller-supplied token-to-value map, e.g. the flavor the user picked in the
 * panel, or a file path chosen elsewhere) wins over the profile; the profile wins over
 * asking. Nothing here performs I/O or opens a dialog: the `${prompt:...}` /
 * `${pick:...}` tokens it leaves behind are resolved by exec/promptTokens.ts when the
 * command is actually run.
 */
export function substituteAdbCommand(
  entry: AdbCommandEntry,
  profile?: AndroidProjectProfile,
  params?: Record<string, string>
): AdbSubstitution {
  const resolved: Record<string, string> = {};
  const interactive: string[] = [];
  const missingFromProfile: string[] = [];
  // A profile that exists but is not an Android project answers nothing: treat it as
  // absent so `hasAndroidProject: false` and "no profile at all" behave identically.
  const effective = profile?.hasAndroidProject ? profile : undefined;

  const replacement = (token: string): string => {
    const supplied = params?.[token];
    if (supplied !== undefined) {
      resolved[token] = supplied;
      return supplied;
    }
    const { candidates, fromProfile } = profileCandidates(token, entry, effective);
    // A deep-link host that the manifest declares as empty ("myapp://" with no
    // authority) is a RESOLVED empty string, not a missing value — the candidate list
    // is empty only because the empty host was filtered out of it.
    if (
      token === "host" &&
      entry.group === "deepLinks" &&
      candidates.length === 0 &&
      (effective?.deepLinks.length ?? 0) > 0
    ) {
      resolved[token] = "";
      return "";
    }
    if (candidates.length === 1) {
      resolved[token] = candidates[0];
      return candidates[0];
    }
    if (!interactive.includes(token)) {
      interactive.push(token);
    }
    if (candidates.length > 1) {
      return interactiveToken("pick", candidates.join(","));
    }
    if (fromProfile && !missingFromProfile.includes(token)) {
      missingFromProfile.push(token);
    }
    return interactiveToken("prompt", promptLabel(token));
  };

  TOKEN_RE.lastIndex = 0;
  const command = entry.commandTemplate.replace(TOKEN_RE, (_whole, token: string) =>
    replacement(token)
  );
  return { command, resolved, interactive, missingFromProfile };
}

/**
 * Whether a substitution still needs something from the user before it can run.
 * The panel reads this to badge a row as "will ask" and to decide whether the dry-run
 * preview can show a final string or only a shape.
 */
export function needsInteractiveInput(substitution: AdbSubstitution): boolean {
  return substitution.interactive.length > 0;
}
