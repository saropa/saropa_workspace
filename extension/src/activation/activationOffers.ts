// Activation notices: the gated-notice helper, the favorites-import offer (with its
// source watchers), the AI context default notice, and the Marketplace rating prompt.
// Split out of activationHelpers.ts, which re-exports all of it.

import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";

import {
  detectFavoritesFiles,
  importAllDetected,
  KNOWN_FAVORITES_SOURCES,
} from "../import/favoritesImport";

import { l10n } from "../i18n/l10n";
import {
  shouldPromptForRating,
  describeRatePromptReason,
  RATING_ACTIVATION_THRESHOLD,
  RATING_REMIND_INTERVAL,
  ACTIVATION_COUNT_KEY,
  NEXT_PROMPT_AT_KEY,
  RATE_DISMISSED_KEY,
  type RatePromptState,
} from "./ratePrompt";

// Gate flag so the one-time "import existing favorites" prompt does not reappear
// once the user has answered (imported or dismissed) for this workspace.
const IMPORT_PROMPT_KEY = "saropaWorkspace.favoritesImportOffered";

// Gate flag for the one-time notice that aiContext.enabled's default flipped from
// true to false (BUG-014). globalState (not workspaceState) because the flip is a
// once-per-install fact about this user's extension version, not something scoped
// to a workspace — showing it again in every workspace the user opens would be a nag.
const AI_CONTEXT_DEFAULT_CHANGE_KEY = "aiContext.defaultChangeNotified";

// One-time notice gate (#27): every "show this at most once" site in this file (and
// ecosystemAutoPins.ts) repeated the same four-step shape — bail if the latch is
// already set, run a check, bail again if the check found nothing to show, latch
// BEFORE showing so a dismissal or a reload mid-prompt can never re-trigger it, then
// show. Centralizing the shape means a new one-time notice only supplies its own
// check/show and cannot get the latch-before-show ordering backwards (the bug this
// pattern exists to avoid). `storage` is the Memento (workspaceState for a
// per-workspace gate, globalState for a once-per-install gate) so callers keep
// choosing their own scope. `check` returns `undefined` to mean "nothing to show
// this time" (the gate is NOT latched, so it can be re-checked later); any other
// value is passed to `show` and the gate is latched.
export async function gatedNotice<T>(
  storage: vscode.Memento,
  key: string,
  check: () => Promise<T | undefined> | T | undefined,
  show: (value: T) => Promise<void> | void
): Promise<void> {
  if (storage.get<boolean>(key, false)) {
    return;
  }
  const value = await check();
  if (value === undefined) {
    return;
  }
  // Latch before running show(): the previous per-site comments called this out
  // explicitly because it is easy to get backwards — a dismissal or a reload mid-
  // prompt must not re-offer the same notice next time.
  await storage.update(key, true);
  await show(value);
}

// One-time "import existing favorites" prompt, gated per workspace by IMPORT_PROMPT_KEY.
// Detects any known favorites source, marks the gate BEFORE awaiting the user's answer
// (so a dismissal or reload mid-prompt does not re-trigger it), then imports all
// detected sources on confirm. Called once at activation and again by
// registerFavoritesImportWatchers whenever a favorites source appears or changes later.
export async function maybeOfferFavoritesImport(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): Promise<void> {
  await gatedNotice(
    context.workspaceState,
    IMPORT_PROMPT_KEY,
    // check: detect any known favorites source; undefined (skip, don't latch)
    // when none is found so a source that appears later still gets offered.
    async () => {
      const detected = await detectFavoritesFiles();
      return detected.length === 0 ? undefined : detected;
    },
    // show: confirm, then import everything detected.
    async (detected) => {
      const first = detected[0];
      const action = l10n("import.promptAction");
      const choice = await vscode.window.showInformationMessage(
        l10n("import.prompt", { file: first.fileName, count: detected.length }),
        action
      );
      if (choice === action) {
        const result = await importAllDetected(store);
        vscode.window.showInformationMessage(
          l10n("import.done", {
            count: result.added,
            file: detected.map((d) => d.fileName).join(", "),
          })
        );
      }
    }
  );
}

// One-time notice for BUG-014: aiContext.enabled's default flipped from true to
// false, so an existing user who never explicitly set the setting silently lost
// their Active AI Threads shortcuts on upgrade with no explanation. Shown at most
// once per install (globalState), and only when the user's own settings do not
// already carry an explicit value — inspect() (not get()) is required here because
// get() cannot distinguish "user set it to false" from "no value, falling back to
// the new false default"; only inspect() exposes the per-scope raw values.
export function maybeNotifyAiContextDefaultChange(context: vscode.ExtensionContext): void {
  // Fire-and-forget: this must stay synchronous-looking from the caller's side (it
  // runs before store.init(), see the call site comment in extension.ts) even though
  // gatedNotice itself is async.
  void gatedNotice(
    context.globalState,
    AI_CONTEXT_DEFAULT_CHANGE_KEY,
    // check: inspect() (not get()) is required here because get() cannot distinguish
    // "user set it to false" from "no value, falling back to the new false default";
    // only inspect() exposes the per-scope raw values. Returns undefined (skip,
    // don't latch) when the user already has an explicit opinion set at any scope.
    () => {
      // Fresh-install guard: a brand-new install has empty globalState — the old
      // aiContext.enabled default (true) never applied to this user, so showing a
      // "default changed" notice would be confusing noise. keys() was added in VS Code
      // 1.78; on 1.74-1.77 it is undefined, and we accept the one-time false positive
      // on fresh installs of those older hosts (a harmless toast, latched forever).
      const keys = context.globalState.keys?.();
      if (keys && keys.length === 0) {
        return undefined;
      }
      const inspected = vscode.workspace
        .getConfiguration("saropaWorkspace")
        .inspect<boolean>("aiContext.enabled");
      const explicitlySet =
        inspected?.globalValue !== undefined ||
        inspected?.workspaceValue !== undefined ||
        inspected?.workspaceFolderValue !== undefined;
      return explicitlySet ? undefined : true;
    },
    // show: an action button, not a bare acknowledgment — the notice exists so the
    // user can act on it (turn the feature back on), so it persists until dismissed
    // rather than auto-clearing like a transient confirmation (STYLEGUIDE.md 4.1a).
    () => {
      const openSettings = l10n("aiContext.defaultChangeNotice.openSettings");
      void vscode.window
        .showInformationMessage(l10n("aiContext.defaultChangeNotice"), openSettings)
        .then((choice) => {
          if (choice === openSettings) {
            void vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "saropaWorkspace.aiContext.enabled"
            );
          }
        });
    }
  );
}

// Arm watchers so the one-time import offer also fires when a favorites source
// APPEARS or CHANGES after activation — a user who installs Saropa first and then
// uses another favorites extension (or a teammate who pulls a `.favorites.json`
// mid-session) would otherwise never be offered the import. maybeOfferFavoritesImport
// owns the gate: it prompts at most once per workspace until acted on or dismissed,
// so re-running it on every file event is safe and cannot nag. A broad `**/<name>`
// glob covers folders added later too; when an event names a file the root-only
// detector does not recognize, the offer is a no-op (it gates nothing).
export function registerFavoritesImportWatchers(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): void {
  const offer = (): void => void maybeOfferFavoritesImport(context, store);
  for (const source of KNOWN_FAVORITES_SOURCES) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${source.fileName}`);
    watcher.onDidCreate(offer, undefined, context.subscriptions);
    watcher.onDidChange(offer, undefined, context.subscriptions);
    // The watcher itself is disposable (its native file handle); dispose on reload
    // so it does not survive and double-fire.
    context.subscriptions.push(watcher);
  }
  // The settings-key sources (howardzuo `favorites.resources`, sabitovvt
  // `favoritesPanel.*`) have no file on disk; a change to their configuration is
  // the equivalent "appeared" signal.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("favorites.resources") ||
        e.affectsConfiguration("favoritesPanel.commands") ||
        e.affectsConfiguration("favoritesPanel.commandsForWorkspace")
      ) {
        offer();
      }
    })
  );
}

// Marketplace review URL for saropa.saropa-workspace. The #review-details
// fragment opens the reviews tab directly so the user lands on the rating form.
const MARKETPLACE_REVIEW_URL =
  "https://marketplace.visualstudio.com/items?itemName=saropa.saropa-workspace&ssr=false#review-details";

/**
 * Increments the activation counter, then shows a rating prompt when the
 * counter reaches the threshold. Unlike the one-shot gatedNotice, this
 * supports three outcomes:
 *
 *  - **Rate It** — opens the Marketplace review page and permanently latches
 *    (same as "No Thanks" from the gate's perspective: the user acted, do not
 *    ask again).
 *  - **Remind Later** — bumps the threshold by RATING_REMIND_INTERVAL so the
 *    prompt reappears after more use, without nagging every session.
 *  - **No Thanks** — permanently latches the dismissed flag.
 *  - **Dismiss (X)** — treated as "Remind Later" (the user closed the toast
 *    without choosing, so we try once more after the interval).
 *
 * Called once at activation, fire-and-forget. The activation count MUST be
 * incremented before the threshold check (a session that shows the prompt has
 * already counted), and the increment must happen unconditionally — even when
 * dismissed — so "Remind Later" can compare against a continuously rising
 * count.
 */
export function maybePromptForRating(context: vscode.ExtensionContext): void {
  const gs = context.globalState;

  // Increment the activation counter unconditionally (even if dismissed) so
  // "Remind Later" always has a rising baseline to compare against.
  const activationCount = (gs.get<number>(ACTIVATION_COUNT_KEY) ?? 0) + 1;
  void gs.update(ACTIVATION_COUNT_KEY, activationCount);

  // Read the remaining state and decide.
  const state: RatePromptState = {
    dismissed: gs.get<boolean>(RATE_DISMISSED_KEY, false),
    activationCount,
    nextPromptAt: gs.get<number>(NEXT_PROMPT_AT_KEY) ?? RATING_ACTIVATION_THRESHOLD,
  };
  const show = shouldPromptForRating(state);

  // Log every activation so "why did / didn't the prompt show?" is answered
  // from the Output channel, not by trial and error (same principle as the
  // upgrade-notice log in saropa_lints).
  const channel = vscode.window.createOutputChannel("Saropa Workspace");
  channel.appendLine(
    `[ratePrompt] activationCount=${activationCount} nextPromptAt=${state.nextPromptAt} ` +
      `dismissed=${state.dismissed} prompt=${show ? "SHOWN" : "hidden"} ` +
      `reason=${describeRatePromptReason(state, show)}`
  );

  if (!show) {
    return;
  }

  // Show the toast with three explicit actions. A dismiss (X) without choosing
  // resolves as undefined and is treated like "Remind Later".
  const rateLabel = l10n("ratePrompt.rate");
  const remindLabel = l10n("ratePrompt.remindLater");
  const noThanksLabel = l10n("ratePrompt.noThanks");

  void vscode.window
    .showInformationMessage(l10n("ratePrompt.message"), rateLabel, remindLabel, noThanksLabel)
    .then((choice) => {
      if (choice === rateLabel) {
        // Open the Marketplace review page and permanently dismiss.
        void vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_REVIEW_URL));
        void gs.update(RATE_DISMISSED_KEY, true);
      } else if (choice === noThanksLabel) {
        // Permanent dismissal — never ask again.
        void gs.update(RATE_DISMISSED_KEY, true);
      } else {
        // "Remind Later" or toast dismissed without choosing: bump the
        // threshold so the prompt comes back after more use. Using the
        // CURRENT activationCount (not nextPromptAt) as the base so a user
        // who postponed once at activation 10 and is now at activation 40
        // waits 15 more from HERE, not 15 from the old threshold.
        void gs.update(NEXT_PROMPT_AT_KEY, activationCount + RATING_REMIND_INTERVAL);
      }
    });
}
