import * as vscode from "vscode";
import { ShortcutKind } from "../model/shortcut";
import { FileTypeIcon, fileTypeIcon, kindIcon } from "./fileTypeTokens";

// The resting glyph/tint maps (file type + action kind) live in the vscode-free
// fileTypeTokens module so the launcher's unit-tested data layer can reuse them; this
// module owns the vscode-bound ThemeIcon resolution and re-exports them so the tree code
// keeps a single import surface.
export { FileTypeIcon, fileTypeIcon, kindIcon };

// Single source of truth for the Shortcuts tree's row glyphs and tints (UI plan,
// Phase 4). Every codicon id and ThemeColor a shortcut row can wear lives here, so the
// visual language is learnable and consistent and no call site invents a glyph.
//
// Two concerns are kept separate on purpose:
//  - resolveShortcutRowIcon owns the PRIORITY — which state wins when several apply.
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
//   warning (untinted)      — a file shortcut whose target is missing/unresolvable
//   lock                    — blocked on an unmet prerequisite shortcut
//   <glyph> + disabled tint — paused: kept but not running on its own
//   <glyph> + warning tint  — a live metric is over its size threshold
//   pass / error            — the last run's outcome (green pass / red fail)
//   watch + yellow          — a time-bombed shortcut counting down to self-removal
//   star-empty              — an auto-shortcut (seeded, removable)
//   pin                     — a plain explicit shortcut

// The inputs the row icon decision reads. A flat value object (not the live Shortcut)
// so the decision is pure and testable, and so the call site states each signal
// explicitly rather than the resolver reaching into shortcut internals.
export interface ShortcutRowIconInput {
  readonly isRunning: boolean;
  readonly isStopping: boolean;
  readonly isFile: boolean;
  readonly hasResolvedUri: boolean;
  readonly missing: boolean;
  readonly locked: boolean;
  // Masked / vault shortcut (WOW #26): renders a lock glyph instead of the file-type or
  // custom icon, so a resting masked shortcut reveals nothing about its target.
  readonly masked: boolean;
  readonly paused: boolean;
  readonly metricOver: boolean;
  readonly lastRunOutcome: "success" | "failure" | undefined;
  readonly customIcon: string | undefined;
  readonly customColor: string | undefined;
  readonly hasExpiry: boolean;
  readonly isAuto: boolean;
  readonly kind: ShortcutKind;
  // Basename of a file shortcut's target (e.g. "pubspec.yaml"), used to pick a
  // file-type glyph + tint at rest. Undefined for non-file shortcuts.
  readonly fileName: string | undefined;
}

// Resolve the single ThemeIcon a resting/active shortcut row shows, applying the
// priority documented above. Annotation rows (comment/separator) never reach here
// — they are inert and set their own glyph before this is consulted.
export function resolveShortcutRowIcon(input: ShortcutRowIconInput): vscode.ThemeIcon {
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
  // Masked / vault shortcut (WOW #26): a lock glyph that overrides the resting cosmetic
  // glyphs below (custom icon, last-run pass/fail, the file-type or default shortcut
  // icon), since any of those would leak a hint about the masked target on a shared
  // screen. Placed under the transient running/missing/locked states, which convey
  // actionable live state worth showing and reveal nothing about the file's identity.
  if (input.masked) {
    return new vscode.ThemeIcon("lock");
  }
  // Paused: the shortcut's own glyph, muted, so the row reads as "not running on its
  // own" while a manual run stays possible — a resting state, not an error tint.
  if (input.paused) {
    return new vscode.ThemeIcon(
      input.customIcon ?? (input.isFile ? "circle-slash" : kindIcon(input.kind)),
      new vscode.ThemeColor("disabledForeground")
    );
  }
  // Over its size threshold (#24): warning tint so "this file is too big" reads at
  // a glance; keeps the shortcut's own glyph when it has one, else a warning triangle.
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
  // Default glyph per action kind for a non-file shortcut with no custom icon.
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
  // Time-bombed shortcut (WOW #9) at rest: a watch glyph so the pending self-removal
  // reads at a glance, filling the otherwise-idle slot for a default-glyph shortcut.
  if (input.hasExpiry) {
    return new vscode.ThemeIcon("watch", new vscode.ThemeColor("charts.yellow"));
  }
  // File shortcut at rest with no custom icon: a file-type glyph + tint derived from
  // the name, so .yaml/.json/.py/.dart read at a glance instead of one generic pin.
  // Falls through to the pin/star default for unmapped types, so nothing regresses.
  if (input.isFile) {
    const typed = fileTypeIcon(input.fileName);
    if (typed) {
      return new vscode.ThemeIcon(typed.icon, new vscode.ThemeColor(typed.color));
    }
  }
  // Auto-shortcut (seeded, removable) vs a plain explicit shortcut.
  return new vscode.ThemeIcon(input.isAuto ? "star-empty" : "pin");
}

