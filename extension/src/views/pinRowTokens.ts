import * as vscode from "vscode";
import { PinKind } from "../model/pin";

// Single source of truth for the Pins tree's row glyphs and tints (UI plan,
// Phase 4). Every codicon id and ThemeColor a pin row can wear lives here, so the
// visual language is learnable and consistent and no call site invents a glyph.
//
// Two concerns are kept separate on purpose:
//  - resolvePinRowIcon owns the PRIORITY — which state wins when several apply.
//  - the branches below own the APPEARANCE — which glyph/tint each state uses.
//
// The priority is deliberate: transient, actionable states (running, a missing
// target, a locked prerequisite) win over resting ones (a user's custom icon, the
// auto/explicit default), so the row always shows the most actionable fact rather
// than a stale resting glyph. A green "last run passed" check must never sit on a
// file that has since been deleted, paused, or gone over budget — hence those
// states are tested first.
//
// Legend (what each reads as to the user):
//   loading~spin            — a run is in progress (or being stopped)
//   warning (untinted)      — a file pin whose target is missing/unresolvable
//   lock                    — blocked on an unmet prerequisite pin
//   <glyph> + disabled tint — paused: kept but not running on its own
//   <glyph> + warning tint  — a live metric is over its size threshold
//   pass / error            — the last run's outcome (green pass / red fail)
//   watch + yellow          — a time-bombed pin counting down to self-removal
//   star-empty              — an auto-pin (seeded, removable)
//   pin                     — a plain explicit pin

// The inputs the row icon decision reads. A flat value object (not the live Pin)
// so the decision is pure and testable, and so the call site states each signal
// explicitly rather than the resolver reaching into pin internals.
export interface PinRowIconInput {
  readonly isRunning: boolean;
  readonly isStopping: boolean;
  readonly isFile: boolean;
  readonly hasResolvedUri: boolean;
  readonly missing: boolean;
  readonly locked: boolean;
  // Masked / vault pin (WOW #26): renders a lock glyph instead of the file-type or
  // custom icon, so a resting masked pin reveals nothing about its target.
  readonly masked: boolean;
  readonly paused: boolean;
  readonly metricOver: boolean;
  readonly lastRunOutcome: "success" | "failure" | undefined;
  readonly customIcon: string | undefined;
  readonly customColor: string | undefined;
  readonly hasExpiry: boolean;
  readonly isAuto: boolean;
  readonly kind: PinKind;
}

// Resolve the single ThemeIcon a resting/active pin row shows, applying the
// priority documented above. Annotation rows (comment/separator) never reach here
// — they are inert and set their own glyph before this is consulted.
export function resolvePinRowIcon(input: PinRowIconInput): vscode.ThemeIcon {
  if (input.isRunning || input.isStopping) {
    return new vscode.ThemeIcon("loading~spin");
  }
  // Unresolvable folder OR a target deleted on disk: a green check on a gone file
  // misleads, so this wins over any stale last-run badge below.
  if (input.isFile && (!input.hasResolvedUri || input.missing)) {
    return new vscode.ThemeIcon("warning");
  }
  // Blocked on an unmet prerequisite: a prior session's green check does not mean
  // the dependency is satisfied now, so "not runnable yet" wins.
  if (input.locked) {
    return new vscode.ThemeIcon("lock");
  }
  // Masked / vault pin (WOW #26): a lock glyph that overrides the resting cosmetic
  // glyphs below (custom icon, last-run pass/fail, the file-type or default pin
  // icon), since any of those would leak a hint about the masked target on a shared
  // screen. Placed under the transient running/missing/locked states, which convey
  // actionable live state worth showing and reveal nothing about the file's identity.
  if (input.masked) {
    return new vscode.ThemeIcon("lock");
  }
  // Paused: the pin's own glyph, muted, so the row reads as "not running on its
  // own" while a manual run stays possible — a resting state, not an error tint.
  if (input.paused) {
    return new vscode.ThemeIcon(
      input.customIcon ?? (input.isFile ? "circle-slash" : kindIcon(input.kind)),
      new vscode.ThemeColor("disabledForeground")
    );
  }
  // Over its size threshold (#24): warning tint so "this file is too big" reads at
  // a glance; keeps the pin's own glyph when it has one, else a warning triangle.
  if (input.metricOver) {
    return new vscode.ThemeIcon(
      input.customIcon ?? "warning",
      new vscode.ThemeColor("list.warningForeground")
    );
  }
  // Last completed run outcome: green pass / red error.
  if (input.lastRunOutcome) {
    return input.lastRunOutcome === "success"
      ? new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"))
      : new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
  }
  // Default glyph per action kind for a non-file pin with no custom icon.
  if (!input.isFile && !input.customIcon) {
    return new vscode.ThemeIcon(kindIcon(input.kind));
  }
  // User-chosen icon/color for the resting state (5.1); the transient states above
  // win, since they convey actionable state.
  if (input.customIcon) {
    return new vscode.ThemeIcon(
      input.customIcon,
      input.customColor ? new vscode.ThemeColor(input.customColor) : undefined
    );
  }
  // Time-bombed pin (WOW #9) at rest: a watch glyph so the pending self-removal
  // reads at a glance, filling the otherwise-idle slot for a default-glyph pin.
  if (input.hasExpiry) {
    return new vscode.ThemeIcon("watch", new vscode.ThemeColor("charts.yellow"));
  }
  // Auto-pin (seeded, removable) vs a plain explicit pin.
  return new vscode.ThemeIcon(input.isAuto ? "star-empty" : "pin");
}

// Default codicon for a non-file action kind when the pin has no custom icon. Part
// of the token map (kind → glyph) so the default glyphs live beside the state ones.
export function kindIcon(kind: PinKind): string {
  switch (kind) {
    case "url":
      return "link-external";
    case "shell":
      return "terminal";
    case "command":
      return "symbol-event";
    case "macro":
      return "list-ordered";
    case "routine":
      // A routine runs a block of recipes back-to-back, so it reads as "run all"
      // rather than a single task.
      return "run-all";
    default:
      return "pin";
  }
}
