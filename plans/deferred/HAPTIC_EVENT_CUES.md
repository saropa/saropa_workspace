# Deferred — Haptic event cues (blocked by platform)

Home for plan items that cannot be built now because of a **hard platform
limitation**, not because of priority. An item lives here only while a concrete
technical blocker stands; when the blocker clears (a new API ships, a viable
integration path is confirmed), the item graduates back into the active plan it
came from. This is distinct from "Later/Exploratory" roadmap items, which are
buildable today and simply not scheduled yet — those stay in the main plans.

---

## Haptic event cues

**Source:** the haptic half of recipe 64, *Sensory feedback*, in
[../history/2026.06/2026.06.25/RECIPE_BOOK.md](../history/2026.06/2026.06.25/RECIPE_BOOK.md) section I. The **audio** half of that recipe
is buildable and stays in the active plan; only haptics is deferred here.

**The idea.** On a pin action, scheduled ritual, or hygiene scan **starting** or
**finishing**, emit a short haptic pulse (alongside or instead of the audio cue),
so a long-running or unattended job can be *felt* without watching the panel —
with distinct success / failure pulses so the outcome is conveyed, not just the
completion.

**Why it is deferred (the hard blocker).** There is **no first-party VS Code
extension API for haptics**. The extension host is a Node process with no exposed
path to a trackpad / controller / device haptic actuator. Delivering a pulse would
require an out-of-band OS-level integration, and even then it only lands on
hardware that exposes a haptic actuator to user space (most desktop dev machines
do not). Audio has at least one viable in-extension path; haptics has none today.

**Re-entry condition (what would un-block this).** Any one of:

- VS Code (or the Electron host) ships an extension-facing haptics / device-signal
  API.
- A vetted, cross-platform OS-level haptic bridge is identified that an extension
  can drive without shipping native binaries per platform.
- The product targets a surface that *does* expose haptics to user space (a
  companion mobile/web client, a controller integration), making the cue land
  somewhere real.

Until one holds, do not promise haptics in user-facing copy or settings. Ship the
audio cue first; gate any future haptic layer behind runtime capability detection
so it is silently absent where unsupported.

**Effort once unblocked.** Small relative to audio — it reuses the same
start/finish event hooks and the same per-event (start / success / failure)
choice model the audio cue defines. The work is the platform bridge plus
capability detection, not new event plumbing.
