// Catalog entries: connection, app control, files and device info. Split out of
// adbCommandCatalog.ts to keep each file small.
import { AdbCommandEntry, entry } from "./adbCatalogTypes";

/** Catalog rows for connection, app control, device info and files. */
export const ADB_CATALOG_CONNECT: AdbCommandEntry[] = [
  // --- Connection ----------------------------------------------------------
  // Subsumes the adb half of the bundled device-connect Python script
  // (debug_connect/connect.py, core.py), which the plan retires in favour of
  // these entries.
  entry({
    id: "connection.list-devices",
    group: "connection",
    commandTemplate: "adb devices -l",
    tags: ["devices", "list", "attached", "serial", "emulator"],
    requiresDevice: false,
    destructive: false,
  }),
  entry({
    id: "connection.connect",
    group: "connection",
    commandTemplate: "adb connect {host}:{port}",
    tags: ["wireless", "wifi", "tcp", "network", "attach"],
    requiresDevice: false,
    destructive: false,
  }),
  entry({
    id: "connection.pair",
    group: "connection",
    commandTemplate: "adb pair {host}:{port} {pairingCode}",
    tags: ["wireless", "wifi", "pairing", "code", "developer options"],
    requiresDevice: false,
    destructive: false,
    // Wireless debugging pairing landed in Android 11.
    minSdk: 30,
  }),
  entry({
    id: "connection.tcpip",
    group: "connection",
    commandTemplate: "adb tcpip {port}",
    tags: ["wireless", "wifi", "usb", "switch", "port"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "connection.disconnect",
    group: "connection",
    commandTemplate: "adb disconnect {host}:{port}",
    tags: ["wireless", "wifi", "detach", "drop"],
    requiresDevice: false,
    destructive: false,
  }),
  entry({
    id: "connection.reverse",
    group: "connection",
    commandTemplate: "adb reverse tcp:{port} tcp:{port}",
    tags: ["port", "forward", "debug", "flutter", "devtools", "localhost"],
    requiresDevice: true,
    destructive: false,
  }),

  // --- App control ---------------------------------------------------------
  entry({
    id: "appControl.install",
    group: "appControl",
    commandTemplate: "adb install -r {localPath}",
    tags: ["apk", "sideload", "deploy", "reinstall", "update"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "appControl.uninstall",
    group: "appControl",
    commandTemplate: "adb uninstall {applicationId}",
    tags: ["remove", "delete", "apk", "package"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "appControl.clear-data",
    group: "appControl",
    commandTemplate: "adb shell pm clear {applicationId}",
    tags: ["wipe", "reset", "storage", "preferences", "cache", "first run"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "appControl.force-stop",
    group: "appControl",
    commandTemplate: "adb shell am force-stop {applicationId}",
    tags: ["kill", "quit", "stop", "process"],
    requiresDevice: true,
    destructive: true,
  }),
  entry({
    id: "appControl.launch",
    group: "appControl",
    commandTemplate:
      "adb shell monkey -p {applicationId} -c android.intent.category.LAUNCHER 1",
    tags: ["start", "open", "run", "launcher", "cold start"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "appControl.list-packages",
    group: "appControl",
    commandTemplate: "adb shell pm list packages -3",
    tags: ["packages", "installed", "third party", "find", "search"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "appControl.package-info",
    group: "appControl",
    commandTemplate: "adb shell dumpsys package {applicationId}",
    tags: ["dumpsys", "version", "signature", "installer", "details"],
    requiresDevice: true,
    destructive: false,
  }),

  // --- Files ---------------------------------------------------------------
  entry({
    id: "files.push",
    group: "files",
    commandTemplate: "adb push {localPath} {remotePath}",
    tags: ["upload", "copy", "transfer", "sdcard", "fixture"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "files.pull",
    group: "files",
    commandTemplate: "adb pull {remotePath} {localPath}",
    tags: ["download", "copy", "transfer", "fetch", "screenshot"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "files.delete",
    group: "files",
    commandTemplate: "adb shell rm -r {remotePath}",
    tags: ["remove", "wipe", "cleanup", "sdcard"],
    requiresDevice: true,
    destructive: true,
  }),

  // --- Device info ---------------------------------------------------------
  entry({
    id: "deviceInfo.properties",
    group: "deviceInfo",
    commandTemplate: "adb shell getprop",
    tags: ["getprop", "model", "manufacturer", "locale", "abi", "build"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "deviceInfo.sdk-level",
    group: "deviceInfo",
    commandTemplate: "adb shell getprop ro.build.version.sdk",
    tags: ["getprop", "api", "android version", "minsdk", "targetsdk"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "deviceInfo.battery",
    group: "deviceInfo",
    commandTemplate: "adb shell dumpsys battery",
    tags: ["dumpsys", "power", "charge", "level", "temperature"],
    requiresDevice: true,
    destructive: false,
  }),
  entry({
    id: "deviceInfo.meminfo",
    group: "deviceInfo",
    commandTemplate: "adb shell dumpsys meminfo {applicationId}",
    tags: ["dumpsys", "memory", "ram", "heap", "leak", "profile"],
    requiresDevice: true,
    destructive: false,
  }),
];
