import * as vscode from "vscode";
import { PinStore } from "../model/pinStore";
import { Pin, PinScope, RoutineMember, pinKind, isAnnotationPin } from "../model/pin";
import {
  runPin as execRunPin,
  runAction,
  getOutputChannel,
  isRunnable,
  runBlockReason,
  RoutineHooks,
  RunBlockReason,
} from "../exec/runner";
import { processRegistry } from "../exec/processRegistry";
import * as runLock from "../exec/runLock";
import { tappedPins } from "../model/tappedPins";
import { dependencyState } from "../exec/dependencies";
import {
  hasInteractiveTokens,
  resolveRememberedTokens,
  cloneWithResolvedTokens,
} from "../exec/promptTokens";
import { SharedPin } from "../import/shareLink";
import { l10n } from "../i18n/l10n";
import { fileExists, handleMissingFile } from "./pinInteraction";
import { orderedPins, asPin } from "./pinSelection";

// The run-execution hub: the single path every "run this pin" gesture funnels
// through (single-instance guard, dependency gate, file-vs-action dispatch), plus
// the already-running dialog, run-with-last-params, drag-and-drop run, and the
// routine engine hooks. Split out of pinCommands.ts so the registration file stays a
// thin dispatcher; the open/peek surface lives in pinInteraction, the pin-picking
// and creation helpers in pinSelection.

export async function runPinCommand(
  store: PinStore,
  pin: Pin,
  // Set by the "Run anyway" / "Stop and re-run" choices below to bypass the
  // single-instance guard (the user has explicitly chosen to overlap or has just
  // stopped the prior run). Every other caller leaves it false.
  force = false
): Promise<void> {
  // A comment / separator annotation is not runnable. Inert by design (no run
  // badge, no telemetry) — this guards the command-palette / keybinding paths,
  // since the tree row itself carries no command to reach here.
  if (isAnnotationPin(pin)) {
    return;
  }
  // Single-instance guard: a previous run of this pin is still in flight (a tracked
  // background run) or its cross-process lock is held elsewhere. Offer the user a
  // choice rather than silently launching a second (no silent async) — unless this
  // is already a forced re-run from one of those choices.
  if (!force) {
    const block = runBlockReason(pin);
    if (block) {
      await handleAlreadyRunning(store, pin, block);
      return;
    }
  }
  // Running counts as "tapping" the pin (clears it from the untapped badge
  // count), the same as opening — every run path funnels through here.
  void tappedPins.mark(pin.id);
  // Block the run when a configured prerequisite has not succeeded this session,
  // offering to run it first (WOW #13).
  if (!(await ensureDependency(store, pin))) {
    return;
  }
  // Non-file pins (recipes: url/shell/command/macro) run through the action
  // dispatcher rather than the file runner.
  if (pinKind(pin) !== "file") {
    await runAction(pin);
    return;
  }
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  // A deleted target cannot run: offer Unpin / Reveal instead of failing the
  // spawn with a cryptic shell error.
  if (!(await fileExists(uri))) {
    await handleMissingFile(store, pin, uri);
    return;
  }
  // A pin with no way to execute (a text doc, markdown, image — anything without
  // an interpreter) should not be flung at the shell on a double-click. Open it
  // instead (opening is itself the visible feedback) and say why "run" did not
  // run, naming the file so the message ties to a concrete pin.
  if (!isRunnable(pin, uri.fsPath)) {
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    await vscode.window.showTextDocument(uri, { preview: false });
    vscode.window.showInformationMessage(l10n("run.openedNotRunnable", { name }));
    return;
  }
  await execRunPin(pin, uri);
}

// A manual run was blocked because the pin is already running (or its cross-process
// lock is held). Surface the conflict and let the user choose, naming the pin so the
// message ties to a concrete row (no silent async). A same-window "running" block can
// offer Stop-and-re-run (we own the process); a "locked" block by a holder in another
// window / process cannot — we never kill a process we do not own — so it offers only
// Run anyway, and names the holder PID so the user knows what to look for.
async function handleAlreadyRunning(
  store: PinStore,
  pin: Pin,
  reason: RunBlockReason
): Promise<void> {
  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  const runAnyway = l10n("run.runAnyway");
  const showOutput = l10n("run.showOutput");

  if (reason === "running") {
    const stopAndRerun = l10n("run.stopAndRerun");
    const choice = await vscode.window.showWarningMessage(
      l10n("run.alreadyRunning", { name }),
      stopAndRerun,
      runAnyway,
      showOutput
    );
    if (choice === stopAndRerun) {
      // Stop the tracked run, wait for it to actually exit, then re-run forced so
      // the relaunch does not see the old process still in the registry.
      if (processRegistry.stop(pin.id)) {
        await waitUntilStopped(pin.id);
      }
      await runPinCommand(store, pin, true);
    } else if (choice === runAnyway) {
      await runPinCommand(store, pin, true);
    } else if (choice === showOutput) {
      getOutputChannel().show(true);
    }
    return;
  }

  // locked: a live holder in another window / process owns the shared lock.
  const holder = pin.lockName ? runLock.holderOf(pin.lockName) : undefined;
  const choice = await vscode.window.showWarningMessage(
    l10n("run.alreadyLocked", {
      name,
      lock: pin.lockName ?? "",
      pid: holder?.pid ?? 0,
    }),
    runAnyway,
    showOutput
  );
  if (choice === runAnyway) {
    await runPinCommand(store, pin, true);
  } else if (choice === showOutput) {
    getOutputChannel().show(true);
  }
}

// Resolve once a pin's tracked process has cleared, so a Stop-and-re-run does not
// relaunch while the old child is still exiting. Bounded by a timeout so a process
// that refuses to die never hangs the command — the registry independently escalates
// a graceful stop to a forced kill, so the wait is a courtesy, not the killer.
function waitUntilStopped(pinId: string, timeoutMs = 6000): Promise<void> {
  if (!processRegistry.isRunning(pinId)) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const done = (): void => {
      sub.dispose();
      clearTimeout(timer);
      resolve();
    };
    const sub = processRegistry.onDidChange(() => {
      if (!processRegistry.isRunning(pinId)) {
        done();
      }
    });
    const timer = setTimeout(done, timeoutMs);
  });
}

// Gate a run on the pin's prerequisite (WOW #13). Returns true when the pin may run
// (no dependency, or it succeeded this session). When the prerequisite has not yet
// succeeded, blocks with a warning that names it and offers to run it first, then
// returns false so the gated pin does not run this time.
async function ensureDependency(store: PinStore, pin: Pin): Promise<boolean> {
  const { pendingDependencyId } = dependencyState(pin, (id) => store.findPin(id));
  if (!pendingDependencyId) {
    return true;
  }
  const dep = store.findPin(pendingDependencyId);
  const depName = dep
    ? dep.label ?? (dep.path.split("/").pop() ?? dep.path)
    : pendingDependencyId;
  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  const runDep = l10n("depends.runAction", { dep: depName });
  const choice = await vscode.window.showWarningMessage(
    l10n("depends.blocked", { name, dep: depName }),
    runDep
  );
  // Offer to satisfy the prerequisite now; the user re-runs the gated pin once it
  // succeeds. Not chained automatically — the prerequisite may itself prompt, take
  // time, or fail, and silently cascading runs would be surprising.
  if (choice === runDep && dep) {
    await runPinCommand(store, dep);
  }
  return false;
}

// Run a parameterized pin reusing the values entered last time, without re-asking
// (roadmap WOW #7 — the "force run" the un-capturable Alt+double-click stood for).
// For a pin with no interactive tokens it is just a normal run. For one with tokens,
// each token resolves from memory; only a token never answered for this pin still
// prompts (so a first bypass works and is then remembered). Canceling that one
// needed prompt aborts with nothing run. The resolved clone shares the pin's id, so
// uri resolution, telemetry, and the missing-file path are identical to a normal run.
export async function runWithLastParams(store: PinStore, pin: Pin): Promise<void> {
  if (!hasInteractiveTokens(pin)) {
    await runPinCommand(store, pin);
    return;
  }
  const values = await resolveRememberedTokens(pin);
  if (values === undefined) {
    const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
    vscode.window.showInformationMessage(l10n("run.canceledPromptToast", { name }));
    return;
  }
  await runPinCommand(store, cloneWithResolvedTokens(pin, values));
}

// Whether a pin's run config already references the $droppedFile token, so a
// drag-and-drop run knows whether to inject the path via the token (the user placed
// it where they want) or append it as a trailing argument (a plain script that just
// expects the file as its last arg).
function execReferencesDroppedFile(exec: Pin["exec"]): boolean {
  const strings = [exec?.command ?? "", ...(exec?.args ?? [])];
  return strings.some((s) => s.includes("$droppedFile"));
}

// Run a script pin against a file dropped onto it from the Explorer (WOW #8). The
// dropped path is exposed as the $droppedFile token; if the pin does not reference
// that token, the path is appended as a trailing argument so a plain script still
// receives the file. The stored pin is untouched — the appended arg applies to this
// run only. A non-file or non-runnable pin is a no-op with a naming message.
export async function runPinOnDroppedFile(
  store: PinStore,
  pin: Pin,
  droppedFsPath: string
): Promise<void> {
  void tappedPins.mark(pin.id);
  const name = pin.label ?? (pin.path.split("/").pop() ?? pin.path);
  if (pinKind(pin) !== "file") {
    return;
  }
  const uri = store.resolveUri(pin);
  if (!uri) {
    vscode.window.showWarningMessage(l10n("pin.missingFile", { path: pin.path }));
    return;
  }
  if (!(await fileExists(uri))) {
    await handleMissingFile(store, pin, uri);
    return;
  }
  if (!isRunnable(pin, uri.fsPath)) {
    vscode.window.showInformationMessage(l10n("drop.notRunnable", { name }));
    return;
  }
  // Inject the token; append it only when the pin does not already place it.
  const effectivePin: Pin = execReferencesDroppedFile(pin.exec)
    ? pin
    : {
        ...pin,
        exec: { ...pin.exec, args: [...(pin.exec?.args ?? []), "$droppedFile"] },
      };
  await execRunPin(effectivePin, uri, "manual", { droppedFile: droppedFsPath });
}

// Build the hooks the routine engine needs (runner.ts cannot import the store /
// command layer without a cycle, so they are injected at activation). resolveMember
// finds the live member pin across both scopes — by recipeId first (survives the
// recipe -> promoted-pin transition and reloads), then by pin id (a member
// hand-composed from a non-recipe stored pin). runMember reuses the canonical
// single-pin path so a member runs exactly as it does from the tree.
export function createRoutineHooks(store: PinStore): RoutineHooks {
  return {
    resolveMember(member: RoutineMember): Pin | undefined {
      const pins = orderedPins(store);
      const byRecipe = member.recipeId
        ? pins.find((p) => p.recipeId === member.recipeId)
        : undefined;
      if (byRecipe) {
        return byRecipe;
      }
      return member.pinId ? pins.find((p) => p.id === member.pinId) : undefined;
    },
    runMember(pin: Pin): Promise<void> {
      return runPinCommand(store, pin);
    },
  };
}

// "New routine from selection": compose the multi-selected pins into one routine pin
// that runs them in sequence. Members reference each pin by recipeId (preferred — it
// survives promote/reload) or pin id (a non-recipe stored pin), skipping routines (no
// nesting) and de-duping. The auto-offered Morning routine is the convenient default;
// this lets any set of recipe pins be hand-composed.
export async function newRoutineFromSelection(store: PinStore, arg: unknown, args: unknown[]): Promise<void> {
  // A view/item context-menu command receives (clickedItem, allSelectedItems[]). Fall
  // back to the single clicked item when no multi-selection array is passed.
  const rawItems = Array.isArray(args) && args.length > 0 ? args : arg !== undefined ? [arg] : [];
  const members: RoutineMember[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const pin = asPin(raw);
    if (!pin) {
      continue;
    }
    // Routines do not nest, and an annotation pin (comment / separator) has nothing
    // to run — neither belongs in a member list.
    if (pin.action?.kind === "routine" || isAnnotationPin(pin)) {
      continue;
    }
    const key = pin.recipeId ?? pin.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    members.push(
      pin.recipeId
        ? { recipeId: pin.recipeId, label: pin.label }
        : { pinId: pin.id, label: pin.label }
    );
  }

  if (members.length < 2) {
    vscode.window.showWarningMessage(l10n("routine.new.needTwo"));
    return;
  }

  const name = await vscode.window.showInputBox({
    title: l10n("routine.new.title"),
    prompt: l10n("routine.new.prompt", { count: members.length }),
    value: l10n("routine.new.defaultName"),
    validateInput: (v) => (v.trim().length > 0 ? undefined : l10n("routine.new.nameEmpty")),
  });
  if (name === undefined) {
    return;
  }

  const shared: SharedPin = {
    v: 1,
    label: name.trim(),
    action: { kind: "routine", members },
    icon: "run-all",
    color: "charts.green",
  };
  const scope: PinScope = (vscode.workspace.workspaceFolders?.length ?? 0) > 0 ? "project" : "global";
  const added = await store.importPin(shared, scope);
  vscode.window.showInformationMessage(
    added
      ? l10n("routine.new.saved", { name: name.trim(), count: members.length })
      : l10n("routine.new.notSaved")
  );
}
