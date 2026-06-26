import * as cp from "child_process";
import * as vscode from "vscode";
import { SoundOverride } from "../model/shortcut";

// Sensory feedback (recipe book section I, #64): a short audio cue when a shortcut run
// STARTS, FINISHES successfully, or FINISHES with failure — so a long-running or
// unattended job announces its outcome without the user watching the output channel.
// Opt-in (off by default) and additive to the existing "no silent async" toasts: the
// visible toast still fires; the cue is an extra, dismissible channel.
//
// PLAYBACK-PATH DECISION (recorded per the recipe book's instruction to settle this
// rather than assume): the cue uses the platform's OWN sound playback of its built-in
// system sounds — PowerShell's [System.Media.SystemSounds] on Windows, `afplay` of a
// /System/Library/Sounds file on macOS, and `canberra-gtk-play` (falling back to
// `paplay` of a freedesktop sound) on Linux. Chosen over the two alternatives because:
//   - a hidden webview hosting an <Audio> element would add a bundled sound asset
//     (bundle-size cost) and a webview to keep alive purely to play a cue; and
//   - the editor's own accessibility-signal / audio-cue surface is a user-configured
//     editor feature, not an extension-triggerable API with distinct custom outcomes.
// The system-sound path needs no bundled asset, gives distinct success/failure tones,
// and inherits the OS master volume and mute for free.
//
// HAPTICS are deferred: VS Code exposes no first-party haptic API, and delivering a
// pulse would need an OS-level integration that only lands on hardware exposing one.
// Audio ships first (this module); haptics stay exploratory with no platform path yet,
// so no haptic setting is offered (it would promise what cannot be delivered).
//
// A cue is a convenience, never a failure path: every spawn is detached, its output
// ignored, and any error (missing player on Linux, blocked shell) is swallowed so a
// run is never affected by the inability to make a sound.

export type SoundEvent = "start" | "success" | "failure";

const CONFIG = "saropaWorkspace.sound";

// Whether to play the cue for this event, honoring the per-shortcut override and the
// global master + per-event toggles. The master toggle is the hard gate (off means
// silence everywhere); a per-shortcut "on" bypasses the per-event toggles but still
// requires the master on, so a single job can chime even when global per-event cues
// are off. A per-shortcut "off" silences the shortcut regardless.
function shouldPlay(event: SoundEvent, override: SoundOverride | undefined): boolean {
  if (override === "off") {
    return false;
  }
  const cfg = vscode.workspace.getConfiguration(CONFIG);
  if (!cfg.get<boolean>("enabled", false)) {
    return false;
  }
  if (override === "on") {
    return true;
  }
  switch (event) {
    case "start":
      return cfg.get<boolean>("onStart", false);
    case "success":
      return cfg.get<boolean>("onSuccess", true);
    case "failure":
      return cfg.get<boolean>("onFailure", true);
  }
}

// The platform command that plays the system sound for an event. Returns undefined
// on an unrecognized platform (no cue rather than a guess).
function commandFor(event: SoundEvent): { cmd: string; args: string[] } | undefined {
  if (process.platform === "win32") {
    // SystemSounds.Play() returns immediately and plays asynchronously. Beep for a
    // neutral start, Asterisk for success, Hand (the error sound) for failure.
    const sound = event === "success" ? "Asterisk" : event === "failure" ? "Hand" : "Beep";
    return {
      cmd: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", `[System.Media.SystemSounds]::${sound}.Play()`],
    };
  }
  if (process.platform === "darwin") {
    // Distinct built-in tones: Tink (start), Glass (success), Basso (failure).
    const file = event === "success" ? "Glass" : event === "failure" ? "Basso" : "Tink";
    return { cmd: "afplay", args: [`/System/Library/Sounds/${file}.aiff`] };
  }
  if (process.platform === "linux") {
    // freedesktop sound-theme event ids; canberra resolves them to the active theme.
    const id = event === "success" ? "complete" : event === "failure" ? "dialog-error" : "bell";
    return { cmd: "canberra-gtk-play", args: ["-i", id] };
  }
  return undefined;
}

// The Linux fallback when canberra-gtk-play is not installed: paplay a freedesktop
// stereo .oga directly. Tried only on a spawn "error" (binary missing), so the common
// case (canberra present) does not pay for it.
function linuxFallback(event: SoundEvent): { cmd: string; args: string[] } {
  const file = event === "success" ? "complete" : event === "failure" ? "dialog-error" : "message";
  return { cmd: "paplay", args: [`/usr/share/sounds/freedesktop/stereo/${file}.oga`] };
}

// Spawn a player detached, ignoring all output, swallowing every error. onError lets
// the Linux path try a fallback; everywhere else the error just ends in silence.
function spawnSilent(cmd: string, args: string[], onError?: () => void): void {
  try {
    const child = cp.spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => onError?.());
    child.unref();
  } catch {
    onError?.();
  }
}

// Play the cue for an event if the settings (and any per-shortcut override) allow it.
// Fire-and-forget: never awaited, never throws into the run path.
export function playCue(event: SoundEvent, override?: SoundOverride): void {
  if (!shouldPlay(event, override)) {
    return;
  }
  const command = commandFor(event);
  if (!command) {
    return;
  }
  const fallback = process.platform === "linux" ? linuxFallback(event) : undefined;
  spawnSilent(command.cmd, command.args, fallback ? () => spawnSilent(fallback.cmd, fallback.args) : undefined);
}
