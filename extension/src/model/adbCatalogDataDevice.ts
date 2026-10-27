// Catalog entries: input, power, permissions, deep links and shell. Split out of
// adbCommandCatalog.ts to keep each file small.
import { AdbCommandEntry, entry } from "./adbCatalogTypes";

export const ADB_CATALOG_DEVICE: AdbCommandEntry[] = [
  // --- Input / UI ----------------------------------------------------------
  entry({
    id: "inputUi.tap",
    group: "inputUi",
    commandTemplate: "adb shell input tap {x} {y}",
    tags: ["touch", "click", "press", "coordinates", "automation"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "inputUi.swipe",
    group: "inputUi",
    commandTemplate: "adb shell input swipe {x} {y} {x2} {y2} {durationMs}",
    tags: ["scroll", "drag", "fling", "gesture", "automation"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "inputUi.text",
    group: "inputUi",
    commandTemplate: "adb shell input text {text}",
    tags: ["type", "keyboard", "fill", "form", "automation"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "inputUi.keyevent",
    group: "inputUi",
    commandTemplate: "adb shell input keyevent {keycode}",
    tags: ["key", "back", "home", "enter", "volume", "automation"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "inputUi.screencap",
    group: "inputUi",
    commandTemplate: "adb exec-out screencap -p > {localPath}",
    tags: ["screenshot", "capture", "png", "docs", "bug report"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "inputUi.screenrecord",
    group: "inputUi",
    commandTemplate: "adb shell screenrecord {remotePath}",
    tags: ["video", "record", "capture", "mp4", "demo", "repro"],
    requiresDevice: true,
    destructive: false,
  }),

  // --- Power / reboot ------------------------------------------------------
  entry({
    id: "powerReboot.reboot",
    group: "powerReboot",
    commandTemplate: "adb reboot",
    tags: ["restart", "power cycle", "reset"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "powerReboot.reboot-recovery",
    group: "powerReboot",
    commandTemplate: "adb reboot recovery",
    tags: ["restart", "recovery", "sideload", "factory"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "powerReboot.reboot-bootloader",
    group: "powerReboot",
    commandTemplate: "adb reboot bootloader",
    tags: ["restart", "bootloader", "fastboot", "flash"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "powerReboot.screen-toggle",
    group: "powerReboot",
    commandTemplate: "adb shell input keyevent 26",
    tags: ["screen", "wake", "sleep", "display", "lock"],
    requiresDevice: true,
    destructive: false,
  }),

  // --- Permissions ---------------------------------------------------------
  entry({
    id: "permissions.grant",
    group: "permissions",
    commandTemplate: "adb shell pm grant {applicationId} {permission}",
    tags: ["allow", "runtime", "camera", "location", "dangerous"],
    requiresDevice: true,
    destructive: false,
    // Runtime permissions (and therefore pm grant/revoke) arrived in Android 6.
    minSdk: 23,
  }),
  entry({
    id: "permissions.revoke",
    group: "permissions",
    commandTemplate: "adb shell pm revoke {applicationId} {permission}",
    tags: ["deny", "runtime", "camera", "location", "dangerous"],
    requiresDevice: true,
    destructive: false,
    minSdk: 23,
  }),
  entry({
    id: "permissions.reset",
    group: "permissions",
    // `pm reset-permissions` takes no package: it resets the runtime permissions of EVERY
    // app on the device. Passing {applicationId} was inert and made the dry-run preview
    // imply a per-app scope it never had, so the token is gone and the entry is flagged
    // destructive to get the warning-severity confirm.
    commandTemplate: "adb shell pm reset-permissions",
    tags: ["reset", "runtime", "first run", "prompt", "qa", "all apps", "device-wide"],
    requiresDevice: true,
    destructive: true,
    minSdk: 23,
  }),
  entry({
    id: "permissions.list",
    group: "permissions",
    commandTemplate: "adb shell dumpsys package {applicationId} permissions",
    tags: ["dumpsys", "granted", "denied", "inspect", "audit"],
    requiresDevice: true,
    destructive: false,
  }),

  // --- Deep links ----------------------------------------------------------
  // The templates that AndroidProjectProfile.deepLinks fills in, one generated
  // command per manifest intent-filter scheme/host pair.
  entry({
    id: "deepLinks.open",
    group: "deepLinks",
    commandTemplate:
      "adb shell am start -a android.intent.action.VIEW -d {scheme}://{host}",
    tags: ["intent", "url", "link", "route", "navigate"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "deepLinks.open-path",
    group: "deepLinks",
    commandTemplate:
      "adb shell am start -a android.intent.action.VIEW -p {applicationId} -d {scheme}://{host}{path}",
    tags: ["intent", "url", "link", "route", "query", "parameters"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "deepLinks.app-links",
    group: "deepLinks",
    commandTemplate: "adb shell pm get-app-links {applicationId}",
    tags: ["verification", "domain", "https", "autoverify", "assetlinks"],
    requiresDevice: true,
    destructive: false,
    // pm get-app-links is an Android 12 addition.
    minSdk: 31,
  }),

  // --- Shell / misc --------------------------------------------------------
  entry({
    id: "shell.interactive",
    group: "shell",
    commandTemplate: "adb shell",
    tags: ["terminal", "prompt", "session", "console"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "shell.run",
    group: "shell",
    commandTemplate: "adb shell {command}",
    tags: ["passthrough", "custom", "arbitrary", "one-off"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "shell.restart-server",
    group: "shell",
    commandTemplate: "adb kill-server && adb start-server",
    tags: ["daemon", "restart", "unstick", "offline", "troubleshoot"],
    requiresDevice: false,
    destructive: false,
  }),
];
