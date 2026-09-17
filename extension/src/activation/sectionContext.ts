import * as vscode from "vscode";
import {
  AndroidProjectProfile,
  emptyAndroidProjectProfile,
  getAndroidProjectProfile,
  watchAndroidProjectProfile,
} from "../model/androidProjectProfile";
import {
  AdbEnvironment,
  hasReadyDevice,
  onAdbEnvironmentProbe,
  probeAdbEnvironment,
} from "../exec/adbEnvironment";

// Section relevance as `when`-clause context keys (MOBILE_REMOTE_CONTROL_PLAN, "UI
// restructure" item 3). The plan's point is that the mechanism already exists —
// activation/viewState.ts drives the filter chips and the branch-scope buttons from
// `setContext` keys — so section relevance uses exactly that, not a new one. This
// module is the publisher for the three project-shape keys:
//
//   saropaWorkspace.hasAndroid   the workspace has an Android project
//   saropaWorkspace.hasFlutter   it is a Flutter project
//   saropaWorkspace.hasDevice    at least one usable device is attached to adb
//
// Split out of viewState.ts rather than added to it because the two have different
// inputs and lifetimes: viewState reacts to the shortcut store, the filter and the
// branch tracker, while this reacts to the project's build files and to adb. Keeping
// them apart also keeps viewState.ts near the size the rest of activation/ sits at.
//
// NOTHING CONSUMES THESE KEYS YET. This step only publishes them: no view
// contribution in package.json carries a `when` clause, and no existing surface is
// hidden. The Control Center index and the per-section `when` clauses (plan items 2
// and 3's second half) are what read them later.

export const HAS_ANDROID_KEY = "saropaWorkspace.hasAndroid";
export const HAS_FLUTTER_KEY = "saropaWorkspace.hasFlutter";
export const HAS_DEVICE_KEY = "saropaWorkspace.hasDevice";

// The profile this module has read, broadcast for the section-aware surfaces that
// need the profile itself rather than a `when` key. The Control Center view sorts
// its rows by SectionDescriptor.relevance(profile), which a boolean context key
// cannot express, so it subscribes here instead of starting a second
// watchAndroidProjectProfile watcher over the same four files.
const profileChanged = new vscode.EventEmitter<AndroidProjectProfile | undefined>();

/** Fires with the current profile on the first read and on every later change. */
export const onSectionProfileChange = profileChanged.event;

// Same shape as viewState.ts's syncFilterView: fire-and-forget setContext calls, one
// per key, values always booleans so a `when` clause never has to cope with
// undefined.
function setKey(key: string, value: boolean): void {
  void vscode.commands.executeCommand("setContext", key, value);
}

/**
 * Publish the two project-shape keys from a profile. An unresolved profile
 * (`undefined` — no workspace folder, or the first read has not answered yet) reads
 * as "neither", which is the safe default: a section gated on hasAndroid stays quiet
 * until the detector actually says otherwise.
 */
export function publishProjectContext(profile: AndroidProjectProfile | undefined): void {
  const resolved = profile ?? emptyAndroidProjectProfile();
  setKey(HAS_ANDROID_KEY, resolved.hasAndroidProject);
  setKey(HAS_FLUTTER_KEY, resolved.isFlutterProject);
}

/**
 * Publish the device key from an adb probe result. "Has a device" means a device a
 * command could actually run against — an unauthorized or offline device looks
 * plugged in from the outside but fails every command, so it does not count.
 */
export function publishDeviceContext(env: AdbEnvironment): void {
  setKey(HAS_DEVICE_KEY, hasReadyDevice(env));
}

/**
 * Wire the three keys for the session: publish once from the first profile read, and
 * again whenever the profile's source files change or an adb probe answers.
 *
 * The adb side deliberately starts no timer. Every probe in the extension goes
 * through exec/adbEnvironment.probeAdbEnvironment(), which broadcasts its result, and
 * the Mobile Remote Control panel already re-probes on open, after every run and on
 * its Refresh button — so subscribing to that stream keeps the key as fresh as the
 * panel's own header without a second poll loop. The one probe started here is the
 * initial read, and only on a project the answer could matter for: shelling out to
 * `adb devices` on every activation of every unrelated workspace would be a cost
 * paid for nothing.
 */
export function wireSectionContext(context: vscode.ExtensionContext): void {
  // Publish the keys and tell the profile subscribers in one step, so the two can
  // never disagree about what the project looks like.
  const applyProfile = (profile: AndroidProjectProfile | undefined): void => {
    publishProjectContext(profile);
    profileChanged.fire(profile);
  };

  context.subscriptions.push(profileChanged);
  context.subscriptions.push(onAdbEnvironmentProbe(publishDeviceContext));
  // Paint the keys now, before any read: a `when` clause is evaluated as soon as the
  // UI is built, and an unset key reads as undefined rather than false.
  publishProjectContext(undefined);
  setKey(HAS_DEVICE_KEY, false);

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return;
  }
  // Cached, and invalidated by the same watcher registered below, so this is one
  // parse per window rather than one per caller. Not awaited: activation must not
  // wait on four file reads, and the keys already hold their safe defaults.
  void getAndroidProjectProfile(folder).then((profile) => {
    applyProfile(profile);
    if (profile.hasAndroidProject) {
      // Fire-and-forget: the probe never throws, and its result reaches the key
      // through the subscription above.
      void probeAdbEnvironment();
    }
  });
  context.subscriptions.push(
    watchAndroidProjectProfile(folder, (profile) => applyProfile(profile))
  );
}
