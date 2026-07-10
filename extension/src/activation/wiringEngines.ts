import * as vscode from "vscode";
import { ShortcutStore } from "../model/shortcutStore";
import { Scheduler } from "../exec/scheduler";
import { IdleMonitor } from "../exec/idleMonitor";
import { ChainRunner } from "../exec/chainRunner";
import { GitEventWatcher } from "../exec/systemEvents";
import { Heartbeat } from "../exec/heartbeat";
import { processRegistry } from "../exec/processRegistry";
import { metricBadges } from "../exec/metricBadges";
import { SuggestionTracker } from "../views/suggestions";
import { TabPinSuggester } from "../views/tabPinSuggestions";
import { l10n } from "../i18n/l10n";

// Activation wiring block split out of extension.ts (and, before that, out of
// wiring.ts once that file itself grew past the project's line-count cap) so
// activate() stays a short, readable sequence of named steps.

// The background engines (scheduler, idle monitor, chain runner, git watcher,
// heartbeat, process registry, metric badges, suggestion trackers); returns the
// scheduler so activate can start it once the pin set is loaded.
export function wireBackgroundEngines(
  context: vscode.ExtensionContext,
  store: ShortcutStore
): Scheduler {
  // In-process scheduler for shortcuts with a schedule. Registered as a disposable so
  // every timer is cleared on deactivation (no orphaned timers leak).
  const scheduler = new Scheduler(store);
  context.subscriptions.push(scheduler);

  // Editor-idle detector (WOW #18): tracks time since the last VS Code interaction and
  // feeds the chain engine's run-on-idle triggers. Constructed before the chain engine
  // so it can be handed in; disposable so its listeners and poll timer are cleared.
  const idleMonitor = new IdleMonitor();
  context.subscriptions.push(idleMonitor);

  // Chain engine (recipe chaining + special events + run-on-idle): listens for
  // shortcut completions, system events (build / publish emitted by a marked shortcut,
  // gitCommit / gitPush from the repo watcher below), and idle crossings, and auto-
  // runs the shortcuts triggered by each. Disposable so every bus subscription is
  // released on deactivation.
  context.subscriptions.push(new ChainRunner(store, idleMonitor));

  // Git event watcher: fires gitCommit / gitPush on the system-event bus by watching
  // the repo's .git logs (no `git` process spawned). Feeds the chain engine's
  // event triggers. Disposable so its file watchers and debounce timers are cleared.
  context.subscriptions.push(new GitEventWatcher());

  // Toolchain heartbeat (#61): a setting-gated background sampler that appends to
  // reports/process-trend.csv and toasts only when a tool crosses a RAM / helper
  // ceiling. Off by default; it self-arms from its own setting. Disposable so its
  // timer is cleared on deactivation.
  context.subscriptions.push(new Heartbeat());

  // Background process registry: kill any still-running background runs on
  // deactivation so they do not outlive the extension.
  context.subscriptions.push(processRegistry);

  // Live metric badges (#24): dispose the engine on deactivation so its per-shortcut
  // file watchers are released (a leaked FileSystemWatcher would survive a reload). The
  // tree provider arms/reconciles the watchers; this only owns their teardown.
  context.subscriptions.push(metricBadges);

  // Smart shortcut suggestions: count file opens on-device and offer to add a shortcut
  // to a file the user opens often (gated once per file). No-op when disabled by setting.
  context.subscriptions.push(new SuggestionTracker(context, store));

  // Long-pinned-tab suggestions: when a native editor tab has stayed pinned past
  // the threshold and is not already a Saropa shortcut, offer to promote it. The
  // instance is held so the Restore command can clear its permanent dismissals.
  const tabPinSuggester = new TabPinSuggester(context, store);
  context.subscriptions.push(
    tabPinSuggester,
    vscode.commands.registerCommand(
      "saropaWorkspace.restoreTabSuggestions",
      async () => {
        const cleared = await tabPinSuggester.restoreDismissed();
        vscode.window.showInformationMessage(
          l10n("tabSuggest.restored", { count: cleared })
        );
      }
    )
  );
  return scheduler;
}
