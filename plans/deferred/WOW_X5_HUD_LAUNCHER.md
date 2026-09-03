# WOW X5 — Saropa HUD Launcher (standalone desktop edition, deferred)

_Merged 2026-09-03 from three companion plan files (base, modules, security) during the
plans/ directory cleanup — see [MASTER_PLAN.md](../MASTER_PLAN.md) section 4.7. No
implementation has started. This is a standalone Tauri desktop application, not a VS Code
extension feature — a separate product, all-or-nothing. The review notes embedded in the
modules section document correctness/security/robustness bugs in every module; anyone
picking this plan up MUST read those notes before implementing._

---

## Saropa HUD Launcher (Standalone Desktop Edition) — base launcher

The out-of-process, zero-dependency desktop companion for the Saropa automation
suite: a native Tauri v2 + Tokio binary that reads `.vscode/saropa-workspace.json`
directly, renders a keyboard-driven HUD overlay, and executes pins independently of
the IDE extension process tree. It runs as an OS service daemon and UI overlay,
reading localized configurations without creating read-write contention with
running editor windows.

---

### 1. Low-level core architecture and decoupling

The launcher operates as a native desktop binary managed via Tauri v2 and a
multi-threaded Tokio runtime core. It isolates file operations from visual
rendering lifecycles, using a lock-free transactional state machine to consume
`.vscode/saropa-workspace.json` schemas without triggering file-access locks
against the primary IDE workspace.

#### A. Subsystem inter-process communication (IPC) layout

```text
[Global Input Event Hook] ──► [Tauri Hardware Key Interceptor] ──► [Foreground Window Booster]
                                                                                │
                                                                  Atomic JSON State Extraction
                                                                                │
                                                                                ▼
[Detached Shell PTY Spawn] ◄── [Native Advisory Mutex Locks] ◄── [Transactional Serialization]
```

#### B. Directory tree and production code layout

```text
saropa-launcher/
├── .cargo/
│   └── config.toml               # Native compiler flags and secure linker targets
├── src-tauri/
│   ├── Cargo.toml                # Native crates manifest dependencies
│   └── src/
│       ├── main.rs               # Main application entry point and IPC orchestration
│       ├── config_bridge.rs      # Atomic file ingestion and telemetry synchronization
│       ├── process_core/
│       │   ├── mod.rs            # Core execution dispatcher routing matrix
│       │   ├── win32_shell.rs    # Deep Win32 API process tracking handles
│       │   ├── posix_shell.rs    # POSIX fork/exec descriptor wrappers
│       │   ├── pty_engine.rs     # Low-level pseudo-terminal ring buffer loop
│       │   └── preflight.rs      # Proactive environment verification diagnostics
│       └── scheduler_daemon/
│           ├── mod.rs            # Background cron thread supervisor
│           ├── mutex_guard.rs    # Cross-process platform advisory locking system
│           └── webhook_server.rs # Cryptographically authenticated loopback listener
└── src-frontend/
    ├── index.html                # Sandboxed DOM canvas with strict security parameters
    ├── package.json              # Compilation and client bundling infrastructure
    └── src/
        ├── app.ts                # Key interceptor router and event pipeline
        ├── styles.css            # GPU-accelerated interface visual tokens
        └── components/
            ├── fab_element.ts    # Ambient project-aware visual anchor
            └── hud_panel.ts      # Numbered macro index selector panel
```

#### C. System-wide dependency layout (`src-tauri/Cargo.toml`)

```toml
[package]
name = "saropa-hud-launcher"
version = "2.0.0"
description = "High-Velocity Independent Desktop Automation Overlay for Saropa Suite Tools"
edition = "2021"
rust-version = "1.74"

[dependencies]
tauri = { version = "2.0.0-rc", features = ["vibrancy", "tray-icon"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.35", features = ["full"] }
axum = "0.7"
hmac = "0.12"
sha2 = "0.12"
hex = "0.4"
portable-pty = "0.8"
lazy_static = "1.4"
cpal = "0.15"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.52", features = [
    "Win32_System_Threading",
    "Win32_UI_Shell",
    "Win32_Foundation",
    "Win32_UI_WindowsAndMessaging",
    "Win32_System_ProcessStatus"
] }

[target.'cfg(unix)'.dependencies]
libc = "0.2"
```

---

### 2. Hardware-accelerated HUD UI/UX

The system renders an overlay that intercepts user keys for zero-mouse workspace routing.

#### A. GPU-accelerated canvas stylesheet (`src-frontend/src/styles.css`)

```css
:root {
  /* Layout Token Tokenizations */
  --bg-hud: rgba(16, 16, 20, 0.86);
  --border-glass: rgba(255, 255, 255, 0.09);
  --font-interface: "Segoe UI", -apple-system, BlinkMacSystemFont, "Ubuntu", sans-serif;
  --font-monospaced: "SF Mono", "Cascadia Code", "JetBrains Mono", monospace;
  
  /* saropa-workspace.json Schema Color Mappings */
  --charts-yellow: #E5C07B;
  --charts-orange: #D19A66;
  --charts-green:  #98C379;
  --default-code:  #61AFEF;
  --status-failed: #E06C75;
  --active-glow:   rgba(97, 175, 239, 0.32);
}

body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: transparent;
  font-family: var(--font-interface);
  user-select: none;
  -webkit-user-select: none;
}

/* Persistent Screen Real Estate Anchor Widget Frame */
.saropa-fab-anchor {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--bg-hud);
  border: 1px solid var(--border-glass);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.40;
  transform: translateZ(0); /* Allocate dedicated hardware layer matrix to skip software blending overhead */
  transition: opacity 0.2s ease-in-out, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.saropa-fab-anchor:hover {
  opacity: 1.0;
  transform: scale(1.06) translateZ(0);
  box-shadow: 0 0 20px var(--active-glow);
}

/* Glassmorphic Macro Interface Panel */
.saropa-hud-viewport {
  width: 540px;
  max-height: 460px;
  background: var(--bg-hud);
  backdrop-filter: blur(32px) saturate(180%);
  -webkit-backdrop-filter: blur(32px) saturate(180%);
  border: 1px solid var(--border-glass);
  border-radius: 16px;
  box-shadow: 0 32px 96px rgba(0, 0, 0, 0.65);
  padding: 24px;
  box-sizing: border-box;
  transform: translateZ(0);
  display: grid;
  grid-template-rows: max-content max-content 1fr max-content;
  gap: 18px;
}

/* Keyboard Action Item Layout Containers */
.macro-action-item {
  display: grid;
  grid-template-columns: 38px 1fr max-content;
  align-items: center;
  padding: 14px 18px;
  margin-bottom: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border-left: 4px solid transparent;
  cursor: pointer;
  transition: transform 0.12s cubic-bezier(0.2, 0, 0, 1), background 0.12s linear;
}

.macro-action-item:hover {
  background: rgba(255, 255, 255, 0.09);
  transform: translateX(6px) translateZ(0);
}

.macro-index-badge {
  font-family: var(--font-monospaced);
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
  padding: 4px 9px;
  border-radius: 6px;
  text-align: center;
}
```

#### B. Client asynchronous key pipeline (`src-frontend/src/app.ts`)

```typescript
import { invoke } from "@tauri-apps/api/core";

interface ShortcutMetadata {
  id: string;
  label: string;
  path: string;
  kind: string;
}

class SaropaHUDController {
  private activeProjectRoot: string = "";
  private structuralSection: "shortcuts" | "routines" | "groups" = "shortcuts";
  private visibleItemsCache: ShortcutMetadata[] = [];

  constructor() {
    this.initializeGlobalInterceptors();
  }

  /**
   * Safe registration loop attaching hardware key mapping logic to window environments.
   * Guarantees zero runtime event leaks when shifting focus between panel sections.
   */
  private initializeGlobalInterceptors(): void {
    document.addEventListener("keydown", async (event: KeyboardEvent) => {
      // Defensive guard checking inputs to prevent processing text while typing values inside prompt dialogs
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        return;
      }

      const activeKey = event.key.toLowerCase();

      // Quick-switch sections inside the panel using dedicated keyboard shortcuts
      if (activeKey === "s") {
        this.transitionViewContext("shortcuts");
        return;
      }
      if (activeKey === "r") {
        this.transitionViewContext("routines");
        return;
      }
      if (activeKey === "g") {
        this.transitionViewContext("groups");
        return;
      }
      if (event.key === "Escape") {
        await invoke("dismiss_hud_window");
        return;
      }

      // Fast Numerical Index Interceptor Mapping (1-9 Grid Traversal)
      if (/^[1-9]$/.test(event.key)) {
        const structuralIndex = parseInt(event.key, 10) - 1;
        const targetElement = this.visibleItemsCache[structuralIndex];
        
        if (targetElement) {
          this.triggerRowFlashAnimation(structuralIndex);
          try {
            // Asynchronously dispatch payload processing without creating blockages on the front thread
            await invoke("dispatch_native_execution", {
              shortcutId: targetElement.id,
              workspacePath: this.activeProjectRoot
            });
          } catch (executionError) {
            console.error(`UI processing core rejected script execution request: ${executionError}`);
          } finally {
            await invoke("dismiss_hud_window");
          }
        }
      }
    });
  }

  private transitionViewContext(context: "shortcuts" | "routines" | "groups"): void {
    this.structuralSection = context;
    const tabElements = document.querySelectorAll(".navigation-tab-toggle");
    tabElements.forEach(element => element.classList.remove("tab-state-active"));
    
    const targetActiveTab = document.getElementById(`tab-target-${context}`);
    if (targetActiveTab) {
      targetActiveTab.classList.add("tab-state-active");
    }
    this.refreshRenderedInterfaceRows();
  }

  private triggerRowFlashAnimation(index: number): void {
    const visualRows = document.querySelectorAll(".macro-action-item");
    if (visualRows[index]) {
      visualRows[index].classList.add("row-state-executing");
    }
  }

  public refreshRenderedInterfaceRows(): void {
    const dataContainer = document.getElementById("hud-rows-container");
    if (!dataContainer) return;
    dataContainer.innerHTML = "";

    this.visibleItemsCache.forEach((item, index) => {
      const rowNode = document.createElement("div");
      rowNode.className = "macro-action-item";
      rowNode.setAttribute("data-id", item.id);
      rowNode.style.borderLeftColor = `var(--default-code)`;
      
      rowNode.innerHTML = `
        <div class="macro-index-badge">${index + 1}</div>
        <div class="macro-item-label">${escapeHtml(item.label || item.path)}</div>
        <div class="macro-item-type">${escapeHtml(item.kind)}</div>
      `;
      dataContainer.appendChild(rowNode);
    });
  }
}

function escapeHtml(stringInput: string): string {
  return stringInput
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

(window as any).hudController = new SaropaHUDController();
```

---

### 3. Cross-platform window constraints and defenses

#### Gotcha A: transparent frame click isolation (all display managers)

- **The constraint:** Frameless applications configure transparent layout contexts
  across display spaces. This creates an invisible hit-test block that swallows
  cursor clicks and prevents interaction with editor code lines directly underneath.
- **The fix:** Inject real-time coordinate verification checks, modifying cursor
  ignore status configurations dynamically based on bounding boxes.

```rust
// File: src-tauri/src/main.rs
use tauri::Manager;

#[tauri::command]
fn modify_hud_mouse_intercept(window: tauri::Window, intercept_required: bool) -> Result<(), String> {
    // Dynamic fallback structure configuration applying native target transformations safely
    window.set_ignore_cursor_events(!intercept_required)
        .map_err(|err| format!("Operating system window sub-compositor rejected spatial mouse transformation request: {}", err))?;
    Ok(())
}
```

#### Gotcha B: macOS application activation penalty

- **The constraint:** Activating an out-of-process user layout configuration on
  macOS triggers a window-manager focus theft safety loop. This updates the layout
  visually on-screen while keyboard character entries remain trapped inside the
  background editor instance.
- **The fix:** Target the AppKit Cocoa backend layer directly to force active
  thread priority states forward past operating system constraints.

```rust
// File: src-tauri/src/process_core/macos_focus.rs
#[cfg(target_os = "macos")]
pub fn force_macos_application_activation(window: tauri::Window) {
    use cocoa::appkit::NSApplication;
    use cocoa::base::id;
    unsafe {
        let shared_application_handle = cocoa::appkit::NSApp();
        // Override Apple foreground focus-theft tracking algorithms programmatically
        shared_application_handle.activateIgnoringOtherApps_(cocoa::base::YES);
        if let Ok(ns_window_ptr) = window.ns_window() {
            let ns_window_id = ns_window_ptr as id;
            ns_window_id.makeKeyAndOrderFront_(cocoa::base::nil);
        }
    }
}
```

#### Gotcha C: Wayland XDG portal client surface restrictions

- **The constraint:** Wayland window compositors isolate screen position variables
  from out-of-process client managers, discarding relative window coordinate
  parameters and displaying alpha-blended frames as opaque boundaries.
- **The fix:** Register explicit GTK layer-shell primitives to force configuration
  structures to map into high-priority utility layers above competing workspaces.

```rust
// File: src-tauri/src/process_core/linux_surface.rs
#[cfg(target_os = "linux")]
pub fn apply_linux_window_layer_properties(window: tauri::Window) {
    use gtk::prelude::*;
    if let Ok(gtk_window_context) = window.gtk_window() {
        // Force utility-class surface mapping descriptors to keep layouts sticky above coding panels
        gtk_window_context.set_type_hint(gdk::WindowTypeHint::Utility);
        gtk_window_context.set_keep_above(true);
    }
}
```

---

### 4. Multi-instance concurrency guard and atomic write core

To guarantee that the standalone launcher service and an open IDE process extension
session never execute identical automated sequences simultaneously — such as a
heavy `Morning routine` loop — the engine implements exclusive low-level system
mutexes plus crash-safe config writes.

#### A. Non-blocking advisory mutex engine (`src-tauri/src/scheduler_daemon/mutex_guard.rs`)

```rust
use std::fs::File;
use std::path::PathBuf;

pub struct CrossPlatformProcessMutex {
    pub tracking_file_handle: Option<File>,
    pub absolute_lock_path: PathBuf,
}

impl CrossPlatformProcessMutex {
    pub fn initialize(shortcut_id: &str) -> Result<Self, String> {
        let systemic_temp_directory = std::env::temp_dir()
            .join("saropa_runtime_mutexes");
        
        std::fs::create_dir_all(&systemic_temp_directory)
            .map_err(|err| format!("Failed to initialize operational directory framework for system locks: {}", err))?;

        let explicit_lock_file = systemic_temp_directory.join(format!("task_{}.lock", shortcut_id));
        
        Ok(Self {
            tracking_file_handle: None,
            absolute_lock_path: explicit_lock_file,
        })
    }

    pub fn acquire_exclusive_system_lock(&mut self) -> Result<bool, String> {
        #[cfg(unix)] {
            use std::os::unix::io::AsRawFd;
            let file_descriptor = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .open(&self.absolute_lock_path)
                .map_err(|err| format!("POSIX file open error: {}", err))?;

            let raw_fd = file_descriptor.as_raw_fd();
            unsafe {
                // Configure non-blocking advisory flock locks (LOCK_EX | LOCK_NB) to reject secondary process execution
                let allocation_status = libc::flock(raw_fd, libc::LOCK_EX | libc::LOCK_NB);
                if allocation_status == 0 {
                    self.tracking_file_handle = Some(file_descriptor);
                    return Ok(true); // Exclusivity lock confirmed cleanly
                }
            }
            Ok(false) // Lock is actively claimed by competing background thread loop
        }

        #[cfg(windows)] {
            use std::os::windows::fs::OpenOptionsExt;
            // Omit all file sharing authorization references (share_access=0) to force the Win32 subsystem to reject dual access
            let file_allocation = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .share_access(0) // Enforces an absolute exclusive hardware access boundary rule across handle pools
                .open(&self.absolute_lock_path);

            match file_allocation {
                Ok(file_handle) => {
                    self.tracking_file_handle = Some(file_handle);
                    Ok(true)
                }
                Err(_) => Ok(false), // Access denied by the OS kernel, verifying active execution collision states
            }
        }
    }
}

// Ensure proper resource cleanup by releasing the lock file when the structure goes out of scope
impl Drop for CrossPlatformProcessMutex {
    fn drop(&mut self) {
        if self.tracking_file_handle.is_some() {
            self.tracking_file_handle = None; // Explicit file closure updates system descriptors
            let _ = std::fs::remove_file(&self.absolute_lock_path);
        }
    }
}
```

#### B. Transactional config serialization pipeline (`src-tauri/src/config_bridge.rs`)

```rust
use std::fs::rename;
use std::io::Write;
use std::path::Path;

pub fn execute_atomic_workspace_flush(target_manifest_path: &Path, payload_buffer: &[u8]) -> std::io::Result<()> {
    let containing_directory = target_manifest_path.parent().unwrap_or_else(|| Path::new("."));
    // Assemble an intermediate scratchpad file on the identical block sector track to prevent split-write file truncation
    let temporary_scratch_file = containing_directory.join("saropa_workspace.tmp");

    // Scope block forces file flush and handles release before calling structural system renames
    {
        let mut work_buffer_file = std::fs::File::create(&temporary_scratch_file)?;
        work_buffer_file.write_all(payload_buffer)?;
        // Force the storage block device controller cache to push contents entirely to solid-state tracks
        work_buffer_file.sync_all()?;
    }

    // Atomic filesystem swap guarantees target configurations never encounter corrupted mid-crash write profiles
    rename(&temporary_scratch_file, target_manifest_path)?;
    Ok(())
}
```

---

### 5. Config deserialization and cross-platform shell execution engine

#### A. Production config ingestion schema map

```rust
// File: src-tauri/src/config_bridge.rs
use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct WorkspaceJSONConfiguration {
    pub version: u32,
    pub pins: Vec<WorkspaceShortcutTarget>,
    pub groups: Vec<UISectionGroup>,
    #[serde(rename = "activeSet")]
    pub active_set: String,
    #[serde(rename = "removedRecipes")]
    pub removed_recipes: Vec<String>,
}

#[derive(Deserialize, Debug)]
pub struct WorkspaceShortcutTarget {
    pub id: String,
    pub path: String,
    pub label: Option<String>,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
    pub exec: Option<NativeRuntimeDirectives>,
    pub action: Option<MacroRoutineCollection>,
    pub schedule: Option<AutomatedCronProfile>,
}

#[derive(Deserialize, Debug)]
pub struct NativeRuntimeDirectives {
    pub command: Option<String>,
    pub cwd: Option<String>,
    #[serde(rename = "runLocation")]
    pub run_location: Option<String>, // Context configuration values: "external", "terminal", "background"
    pub elevated: Option<bool>,
}

#[derive(Deserialize, Debug)]
pub struct MacroRoutineCollection {
    pub kind: String, // Value validation parameter: "routine"
    pub members: Vec<RoutineChainEntry>,
}

#[derive(Deserialize, Debug)]
pub struct RoutineChainEntry {
    #[serde(rename = "recipeId")]
    pub recipe_id: String,
    pub label: String,
}

#[derive(Deserialize, Debug)]
pub struct AutomatedCronProfile {
    #[serde(rename = "atTime")]
    pub at_time: Option<String>,
    pub days: Option<Vec<u32>>,
    pub enabled: bool,
}

#[derive(Deserialize, Debug)]
pub struct UISectionGroup {
    pub id: String,
    pub label: String,
    pub order: u32,
}
```

#### B. Windows high-integrity process elevation engine (`ShellExecuteExW`)

```rust
// File: src-tauri/src/process_core/win32_shell.rs
#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use std::ptr::null_mut;

/**
 * Executes high-privilege scripts natively by calling ShellExecuteExW with strict context tracking flags.
 * Securely extracts hProcess tokens to monitor execution lifetimes without creating resource handle leaks.
 */
#[cfg(target_os = "windows")]
pub unsafe fn spawn_elevated_tracked_win32_process(
    target_binary: &str,
    arguments: &str,
    working_dir: &str
) -> Result<u32, String> {
    use windows_sys::Win32::System::Threading::GetExitCodeProcess;
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW, SEE_MASK_NOCLOSEPROCESS};
    use windows_sys::Win32::Foundation::HANDLE;

    // Convert string inputs to wide, null-terminated arrays for low-level Win32 system call compatibility
    let wide_verb: Vec<u16> = OsStr::new("runas").encode_wide().chain(std::iter::once(0)).collect();
    let wide_file: Vec<u16> = OsStr::new(target_binary).encode_wide().chain(std::iter::once(0)).collect();
    let wide_args: Vec<u16> = OsStr::new(arguments).encode_wide().chain(std::iter::once(0)).collect();
    let wide_dir: Vec<u16> = OsStr::new(working_dir).encode_wide().chain(std::iter::once(0)).collect();

    let mut exec_info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS, // Force the OS to yield raw tracking process context references to hProcess
        hwnd: 0,
        lpVerb: wide_verb.as_ptr(),
        lpFile: wide_file.as_ptr(),
        lpParameters: wide_args.as_ptr(),
        lpDirectory: wide_dir.as_ptr(),
        nShow: 1, // SW_SHOWNORMAL view mapping variable
        hInstApp: 0,
        lpIDList: null_mut(),
        lpClass: null_mut(),
        hkeyClass: 0,
        dwHotKey: 0,
        Anonymous: std::mem::zeroed(),
        hProcess: 0, // This handle pointer location receives the live target reference from the Win32 subsystem
    };

    let result_code = ShellExecuteExW(&mut exec_info);
    if result_code == 0 {
        return Err(String::from("Win32 sub-kernel context initialization aborted: Elevation request denied or UAC dialog was closed."));
    }

    let tracked_handle: HANDLE = exec_info.hProcess;
    if tracked_handle == 0 {
        return Err(String::from("Win32 structural initialization failure: Native process handle track was not returned."));
    }

    // Spawn an isolated async task context to monitor runtime status changes without locking application UI updates
    tokio::spawn(async move {
        let mut exit_tracking_status: u32 = 0;
        loop {
            unsafe {
                if GetExitCodeProcess(tracked_handle, &mut exit_tracking_status) != 0 {
                    if exit_tracking_status != 259 { // Win32 STILL_ACTIVE status constant tracking indicator
                        break;
                    }
                }
                // Yield thread control back to the executor pool to minimize CPU cycles
                tokio::time::sleep(tokio::time::duration::Duration::from_millis(150)).await;
            }
        }
        println!("Tracked elevated pipeline exited. Win32 completion status: {}", exit_tracking_status);
        unsafe { windows_sys::Win32::Foundation::CloseHandle(tracked_handle); }
    });

    Ok(1)
}
```

#### C. Unified script processing router and headless PTY core (`src-tauri/src/process_core/mod.rs`)

```rust
use std::process::Command;
use std::io::Read;

pub fn execute_system_shortcut_routing(pin: &WorkspaceShortcutTarget, root_path: &str) -> Result<(), String> {
    let fallback_meta = NativeRuntimeDirectives {
        command: None,
        cwd: None,
        run_location: Some(String::from("background")),
        elevated: Some(false),
    };
    
    let exec_meta = pin.exec.as_ref().unwrap_or(&fallback_meta);
    let working_directory = exec_meta.cwd.as_deref().unwrap_or(root_path);

    if exec_meta.run_location.as_deref() == Some("external") {
        #[cfg(target_os = "windows")] {
            unsafe {
                let tracking_binary = "powershell.exe";
                let parameter_string = format!("-NoExit -File {}\\{}", working_directory, pin.path);
                win32_shell::spawn_elevated_tracked_win32_process(
                    tracking_binary, 
                    &parameter_string, 
                    working_directory
                )?;
            }
        }

        #[cfg(target_os = "macos")] {
            let apple_script_payload = format!(
                "tell application \"Terminal\" to do script \"cd '{}' && python3 {}\"",
                working_directory, pin.path
            );
            Command::new("osascript")
                .args(&["-e", &apple_script_payload])
                .spawn()
                .map_err(|err| format!("macOS GUI execution engine failed to drop terminal: {}", err))?;
        }

        #[cfg(target_os = "linux")] {
            Command::new("x-terminal-emulator")
                .args(&["-e", "bash", "-c", &format!("cd '{}' && python3 {}; exec bash", working_directory, pin.path)])
                .spawn()
                .map_err(|err| format!("POSIX system wrapper failed to spin up terminal: {}", err))?;
        }
    } else {
        // Run script within an isolated, out-of-process background pseudo-terminal (PTY) pipeline
        initialize_background_pty_allocation(pin, working_directory)?;
    }
    Ok(())
}

fn initialize_background_pty_allocation(pin: &WorkspaceShortcutTarget, working_dir: &str) -> Result<(), String> {
    use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};

    let pty_system = NativePtySystem::default();
    let pty_pair = pty_system
        .open_pty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|err| format!("Failed to initialize pseudo-terminal data structures: {}", err))?;

    let execution_string = format!("python3 {}", pin.path);
    let mut command_context = CommandBuilder::new_args(&["sh", "-c", &execution_string]);
    if cfg!(target_os = "windows") {
        command_context = CommandBuilder::new_args(&["powershell.exe", "-Command", &execution_string]);
    }
    command_context.cwd(working_dir);

    let mut executed_child = pty_pair.slave.spawn_command(command_context)
        .map_err(|err| format!("Failed to spawn child command on targeted PTY slave interface: {}", err))?;
    let mut master_output_reader = pty_pair.master.try_clone_reader()
        .map_err(|err| format!("Failed to clone master PTY stream reader descriptor: {}", err))?;

    // Allocate an async worker thread to read stdout/stderr streams without locking the main thread pool
    tokio::spawn(async move {
        let mut loop_read_buffer = [0u8; 4096];
        loop {
            match master_output_reader.read(&mut loop_read_buffer) {
                Ok(0) => break, // Process closed cleanly (EOF reached)
                Ok(chunk_size) => {
                    let text_segment = String::from_utf8_lossy(&loop_read_buffer[..chunk_size]);
                    println!("Headless PTY Out: {}", text_segment);
                }
                Err(_) => break, // Stream interface disconnected
            }
        }
        let operational_exit_code = executed_child.wait().unwrap();
        println!("Background headless script processor terminated with status: {}", operational_exit_code);
    });

    Ok(())
}
```

---

### Success criteria (base launcher)

- `cargo build` produces a Tauri v2 binary matching the directory tree; the Rust
  kernel reads `.vscode/saropa-workspace.json` without blocking the IDE.
- HUD renders with the tokens above; keys `1`–`9` dispatch rows, `s`/`r`/`g` switch
  sections, `Escape` dismisses; row strings are HTML-escaped.
- Click-through, macOS focus capture, and Wayland/X11 stacking all behave.
- Two processes contending the same `shortcut_id` lock: exactly one wins; config
  writes are atomic (no truncated manifest on crash).
- A valid config deserializes; `runLocation` external/background/terminal each route
  correctly; `elevated` triggers UAC on Windows and tracks the process to exit.

---

## Saropa HUD Launcher — advanced modules

Optional add-ons layered on the base launcher in the base launcher section above. Each module is independent; none is required to ship the base app.

---

### Module 1: embedded PTY terminal backpressure and UTF-8 splitting guard

**Depends on:** the background PTY pipeline (base plan, section 5).

Processes terminal character data from background tasks safely, handling fragmented multi-byte character strings and preventing UI-framework flooding.

#### Throttled UTF-8 character streaming loop (`src-tauri/src/process_core/pty_engine.rs`)

```rust
use tokio::io::AsyncReadExt;
use std::time::{Instant, Duration};

const DATA_THROTTLE_BYTE_CAP: usize = 49152;   // Upper bounds configuration preventing backend message queue congestion
const REFRESH_TICK_WINDOW_MS: u128 = 16;       // Synchronized to uniform 60Hz visual hardware update bounds

pub async fn run_throttled_pty_read_pipeline(
    mut data_stream_source: tokio::fs::File,
    ui_engine_handle: tauri::AppHandle,
    session_broadcast_id: String
) {
    let mut data_reading_matrix = [0u8; 8192];
    let mut carryover_byte_vector: Vec<u8> = Vec::with_capacity(4);
    let mut adaptive_window_timer = Instant::now();
    let mut runtime_processed_bytes = 0;

    loop {
        // Enforce a clear selection barrier to prevent deadlocking active file descriptors
        tokio::select! {
            incoming_stream_chunk = data_stream_source.read(&mut data_reading_matrix) => {
                match incoming_stream_chunk {
                    Ok(0) => break, // Terminal reached processing completion boundary (EOF)
                    Ok(extracted_byte_count) => {
                        runtime_processed_bytes += extracted_byte_count;

                        // Append new bytes onto historical carryover fragments
                        let mut consolidated_buffer = carryover_byte_vector.clone();
                        consolidated_buffer.extend_from_slice(&data_reading_matrix[..extracted_byte_count]);
                        carryover_byte_vector.clear();

                        // Inspect byte buffer tracking arrays for incomplete multi-byte UTF-8 boundaries
                        let validated_slice_length = determine_valid_utf8_boundary(&consolidated_buffer);
                        if validated_slice_length < consolidated_buffer.len() {
                            // Extract fragmented trailing characters and store them in the carryover vector for the next validation pass
                            carryover_byte_vector.extend_from_slice(&consolidated_buffer[validated_slice_length..]);
                        }

                        if validated_slice_length > 0 {
                            let parsed_character_payload = String::from_utf8_lossy(&consolidated_buffer[..validated_slice_length]).into_owned();
                            let _ = ui_engine_handle.emit(&session_broadcast_id, parsed_character_payload);
                        }
                        
                        // Apply backpressure strategies if task data bursts exceed thread processing caps
                        if runtime_processed_bytes > DATA_THROTTLE_BYTE_CAP {
                            let temporal_duration_delta = adaptive_window_timer.elapsed().as_millis();
                            if temporal_duration_delta < REFRESH_TICK_WINDOW_MS {
                                // Force an internal micro-sleep to let the client rendering context clear its queues
                                tokio::time::sleep(Duration::from_millis((REFRESH_TICK_WINDOW_MS - temporal_duration_delta) as u64)).await;
                            }
                            adaptive_window_timer = Instant::now();
                            runtime_processed_bytes = 0;
                        }
                    }
                    Err(_) => break, // Pipeline link closed unexpectedly
                }
            }
        }
    }
}

/**
 * Traverses raw arrays backward from tail markers to isolate broken trailing multi-byte UTF-8 characters.
 * Prevents client terminal rendering modules from drawing replacement character artifacts.
 */
fn determine_valid_utf8_boundary(input_buffer: &[u8]) -> usize {
    let length = input_buffer.len();
    if length == 0 { return 0; }
    
    let mut index = length - 1;
    let mut checking_back_steps = 0;
    
    // Track backwards past standard continuation byte lines (0b10xxxxxx matches decimal values 128 through 191)
    while index > 0 && checking_back_steps < 4 {
        let byte = input_buffer[index];
        if (byte & 0xC0) != 0x80 {
            // Evaluates multi-byte leader masks to isolate character lengths
            if (byte & 0x80) == 0x00 { return length; } // Base ASCII entry, context bounds are secure
            
            let expected_bytes = if (byte & 0xE0) == 0xC0 { 2 }
            else if (byte & 0xF0) == 0xE0 { 3 }
            else if (byte & 0xF8) == 0xF0 { 4 }
            else { 1 }; // Malformed byte sequence identifier
            
            if checking_back_steps + 1 < expected_bytes {
                return index; // Truncation verified, slice boundary isolates leader bytes cleanly
            } else {
                return length; // Complete character frame parsed safely
            }
        }
        index -= 1;
        checking_back_steps += 1;
    }
    length
}
```

#### Review notes

- **Byte 0 is never checked (correctness).** The scan loop is `while index > 0 && checking_back_steps < 4`, so index 0 is never examined. A buffer whose multi-byte leader sits at position 0 with only continuation bytes after it — e.g. `[0xE0, 0x80]` (3-byte leader + 1 continuation, truncated) — falls through to `length`, so the truncated tail reaches `from_utf8_lossy` and renders as the replacement-character artifact this function exists to prevent. Handle index 0 explicitly.
- **`tokio::select!` wraps a single branch (dead abstraction).** With one arm it just awaits that arm; the comment about "deadlocking file descriptors" is not a real effect. Drop the `select!`, or add the real second branch (a shutdown signal) it was presumably meant to carry.
- **`carryover_byte_vector.clone()` every read (minor perf).** Avoidable — splice the carryover in place instead of cloning per iteration.

---

### Module 2: authenticated loopback receiver gateway (timing-attack shield)

**Depends on:** `axum`/`hmac`/`sha2`/`hex` deps (base plan, section 1) and execution lanes (section 5).

Exposes a loopback-only web routing target, allowing cloud endpoints or background tools to trigger script macros securely with a constant-time HMAC check.

#### Production Axum server implementation (`src-tauri/src/scheduler_daemon/webhook_server.rs`)

```rust
use axum::{extract::Path, http::StatusCode, response::IntoResponse, routing::post, HeaderMap, Router};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::net::SocketAddr;

type HmacSignatureValidator = Hmac<Sha256>;

pub async fn spawn_production_loopback_gateway(app_handle: tauri::AppHandle, cryptographic_token: String) {
    let framework_router = Router::new().route(
        "/v2/webhook/trigger/:shortcut_id",
        post(move |path: Path<String>, headers: HeaderMap, payload: String| {
            evaluate_incoming_payload_signature(app_handle.clone(), cryptographic_token.clone(), path, headers, payload)
        }),
    );

    // Hard-constrain server listening ports exclusively to local loopback adapters
    let target_socket_destination = SocketAddr::from(([127, 0, 0, 1], 8484));
    let tcp_network_listener = tokio::net::TcpListener::bind(&target_socket_destination)
        .await
        .expect("Binding failure: Internal local communications port 8484 is occupied by another service window instance.");
        
    axum::serve(tcp_network_listener, framework_router).await.unwrap();
}

async fn evaluate_incoming_payload_signature(
    core_handle: tauri::AppHandle,
    secret_key_string: String,
    Path(shortcut_id): Path<String>,
    request_headers: HeaderMap,
    raw_payload_body: String,
) -> impl IntoResponse {
    let signature_header_value = match request_headers.get("X-Saropa-Signature") {
        Some(header_bytes) => header_bytes.to_str().unwrap_or(""),
        None => return StatusCode::UNAUTHORIZED,
    };

    let mut cryptographic_mac = HmacSignatureValidator::new_from_slice(secret_key_string.as_bytes())
        .expect("Cryptographic infrastructure error parsing internal system token key definitions.");
    cryptographic_mac.update(raw_payload_body.as_bytes());
    
    let expected_hex_signature = hex::encode(cryptographic_mac.finalize().into_bytes());

    // Execute absolute constant-time byte comparisons to protect the authentication gateway from timing side-channel attacks
    if !constant_time_signature_match(&expected_hex_signature, signature_header_value) {
        return StatusCode::FORBIDDEN;
    }

    // Forward the confirmed macro execution request onto core execution lanes
    let _ = core_handle.emit("external_macro_trigger_intercepted", shortcut_id);
    StatusCode::ACCEPTED
}

/**
 * Non-short-circuiting signature comparison module.
 * Evaluates every single byte array element uniformly to mask computing delta differences from external network probes.
 */
fn constant_time_signature_match(signature_a: &str, signature_b: &str) -> bool {
    let bytes_a = signature_a.as_bytes();
    let bytes_b = signature_b.as_bytes();
    
    if bytes_a.len() != bytes_b.len() { return false; }
    
    let mut computational_accumulator = 0;
    for index in 0..bytes_a.len() {
        // Bitwise OR caches matching discrepancies without dropping out of the processing loops early
        computational_accumulator |= bytes_a[index] ^ bytes_b[index];
    }
    computational_accumulator == 0
}
```

#### Review notes

- **The path parameter is unauthenticated (security).** The HMAC covers `raw_payload_body` only; `shortcut_id` comes from the URL path and is what selects the macro to run. A single captured `(body, signature)` pair validates against `/v2/webhook/trigger/<any-other-id>`, so anyone holding one valid signature can trigger every shortcut. Sign the `shortcut_id` together with the body (or the full request line).
- **No replay protection (security).** No timestamp or nonce means any local process can replay a captured request. Loopback binding is the only mitigation — state that as the assumed trust boundary, and consider a short-lived nonce.
- **`.expect()` / `.unwrap()` crash the daemon (robustness).** `TcpListener::bind` panics if port 8484 is occupied and `axum::serve(...).unwrap()` panics on any serve error, taking the whole daemon down. Degrade gracefully and surface the failure instead.
- **Reimplementing constant-time compare is unnecessary.** The `hmac` crate's `verify_slice` is constant-time and harder to get wrong than a hand-rolled loop.

---

### Module 3: pre-flight diagnostics pipeline

**Depends on:** the execution engine (base plan, section 5).

Performs proactive toolchain and network availability audits *before* initiating script sequences or routine macros.

#### Asynchronous pre-push diagnostic probe (`src-tauri/src/process_core/preflight.rs`)

```rust
use std::process::Command;
use std::time::Duration;
use tokio::net::TcpStream;

#[derive(serde::Serialize, Debug)]
pub struct EnvironmentDiagnosticReport {
    pub python_interpreter_live: bool,
    pub target_port_unlocked: bool,
    pub repository_head_synchronized: bool,
    pub resolved_remediation_log: Option<String>,
}

#[tauri::command]
pub async fn execute_preflight_diagnostic_sweep(
    project_root_directory: String,
    script_target_file: String,
    bound_port_check: Option<u16>
) -> Result<EnvironmentDiagnosticReport, String> {
    let mut system_status = EnvironmentDiagnosticReport {
        python_interpreter_live: true,
        target_port_unlocked: true,
        repository_head_synchronized: true,
        resolved_remediation_log: None,
    };

    // 1. Verify Local Shell Interpreter Path Integrity
    let path_lookup_utility = if cfg!(target_os = "windows") { "where" } else { "which" };
    let verify_binary_presence = Command::new(path_lookup_utility).arg("python3").output();
    
    if verify_binary_presence.is_err() || !verify_binary_presence.unwrap().status.success() {
        system_status.python_interpreter_live = false;
        system_status.resolved_remediation_log = Some(String::from("Missing toolchain runtime path dependency: 'python3' binary not resolved via active system environments."));
        return Ok(system_status);
    }

    // 2. Scan Targeted Network Communication Sockets for Active Zombie Holders
    if let Some(port_id) = bound_port_check {
        let execution_timeout_limit = Duration::from_millis(120);
        let endpoint_destination = format!("127.0.0.1:{}", port_id);
        
        // A connection success confirms a port conflict—the address is locked by an un-killed child process
        if tokio::time::timeout(execution_timeout_limit, TcpStream::connect(&endpoint_destination)).await.is_ok() {
            system_status.target_port_unlocked = false;
            system_status.resolved_remediation_log = Some(format!("Port Blockage Detected: Networking socket port '{}' is currently held by a zombie process context.", port_id));
            return Ok(system_status);
        }
    }

    // 3. Directly Parse Local Git Internal Reference Vectors
    system_status.repository_head_synchronized = inspect_git_tracking_vectors(&project_root_directory);
    Ok(system_status)
}

fn inspect_git_tracking_vectors(root_dir: &str) -> bool {
    let git_fetch_head_path = format!("{}/.git/FETCH_HEAD", root_dir);
    let git_local_head_path = format!("{}/.git/refs/heads/main", root_dir);

    // Defensive check verifying existence parameters before attempting parsing operations
    if !Path::new(&git_fetch_head_path).exists() || !Path::new(&git_local_head_path).exists() {
        return true; 
    }

    match (std::fs::read_to_string(git_fetch_head_path), std::fs::read_to_string(git_local_head_path)) {
        (Ok(fetch_text), Ok(local_text)) => fetch_text.contains(local_text.trim()),
        _ => true, // Fall back to true if reference files encounter system errors
    }
}
```

#### Review notes

- **Port check is inverted — reports every port as blocked (correctness).** `timeout(dur, TcpStream::connect(addr)).await` returns `Result<Result<TcpStream, io::Error>, Elapsed>`, and `.is_ok()` is true whenever the connect *future completed* before the deadline — including the `ConnectionRefused` that a free port returns immediately. So a free port reports `target_port_unlocked = false`, and an occupied port also reports false; the only "unlocked" result is a dropped SYN that times out. The check is backwards. Use `matches!(timeout(dur, connect).await, Ok(Ok(_)))` for "occupied".
- **Missing `use std::path::Path` — won't compile.** `inspect_git_tracking_vectors` calls `Path::new(...)` but the imports are only `Command`, `Duration`, `TcpStream`.
- **Blocking IO in an async command.** `Command::new(...).output()` is blocking `std::process` inside `#[tauri::command] async fn` and stalls the tokio worker. Use `tokio::process::Command`.
- **Git-sync heuristic misreports packed refs.** Reading `.git/refs/heads/main` as a loose file fails when refs are packed (common); the existence guard then returns `true` and reports "synchronized" for a repo it never checked. The `FETCH_HEAD` `contains(...)` test is also fragile (tab-delimited format, detached HEAD). Use `git rev-parse` / `git status -uno` output instead of parsing `.git` internals.

---

### Module 4: low-level OS context observer hooks

**Depends on:** the base IPC runtime (base plan, section 1).

Intercepts active process transitions at the OS window-manager layer, dynamically filtering dashboard visibility based on the active developer app.

#### Asynchronous application state monitor core (`src-tauri/src/process_core/window_observer.rs`)

```rust
use std::time::Duration;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub fn start_foreground_context_observer(app_runtime: tauri::AppHandle, kill_switch: Arc<AtomicBool>) {
    tokio::spawn(async move {
        let mut historical_app_identity = String::new();

        // High-safety polling thread cleanly respecting incoming hardware termination events
        while !kill_switch.load(Ordering::Relaxed) {
            let mut resolved_active_binary = String::from("unknown");

            #[cfg(target_os = "windows")] unsafe {
                use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
                use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
                use windows_sys::Win32::System::ProcessStatus::GetProcessImageFileNameW;

                let active_window_handle = GetForegroundWindow();
                if active_window_handle != 0 {
                    let mut tracking_pid: u32 = 0;
                    GetWindowThreadProcessId(active_window_handle, &mut tracking_pid);
                    let system_process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, tracking_pid);
                    
                    if system_process_handle != 0 {
                        let mut wide_character_array = [0u16; 512];
                        let string_length = GetProcessImageFileNameW(system_process_handle, wide_character_array.as_mut_ptr(), 512);
                        if string_length > 0 {
                            let completed_path = String::from_utf16_lossy(&wide_character_array[..string_length as usize]);
                            resolved_active_binary = completed_path.split('\\').last().unwrap_or("unknown").replace(".exe", "").to_lowercase();
                        }
                        windows_sys::Win32::Foundation::CloseHandle(system_process_handle);
                    }
                }
            }

            #[cfg(target_os = "macos")] {
                let macro_script_bytes = "tell application \"System Events\" to get name of first process whose frontmost is true";
                if let Ok(cmd_execution) = std::process::Command::new("osascript").args(&["-e", macro_script_bytes]).output() {
                    resolved_active_binary = String::from_utf8_lossy(&cmd_execution.stdout).trim().to_lowercase();
                }
            }

            #[cfg(target_os = "linux")] {
                // Safely probe window active class parameters under standard X11 window configurations
                if let Ok(cmd_execution) = std::process::Command::new("xdotool").args(&["getwindowfocus", "getwindowclassname"]).output() {
                    resolved_active_binary = String::from_utf8_lossy(&cmd_execution.stdout).trim().to_lowercase();
                }
            }

            if resolved_active_binary != historical_app_identity {
                historical_app_identity = resolved_active_binary.clone();
                // Emit system dashboard filter updates only when focus shifts past application boundaries
                let _ = app_runtime.emit("saropa_context_shifted", resolved_active_binary);
            }

            // Sleep thread cleanly to eliminate CPU usage overhead
            tokio::time::sleep(Duration::from_millis(600)).await;
        }
    });
}
```

#### Review notes

- **Blocking spawns on the async runtime.** The macOS/Linux paths shell out via blocking `std::process::Command` every 600 ms on a tokio task; `osascript` especially runs ~100 ms+ per call and will occupy a worker. Use `tokio::process::Command`.
- **Linux is X11-only.** `xdotool` yields "unknown" under Wayland silently — note the limitation, or detect the session type and skip.
- The Windows path correctly closes the process handle in all branches — this is the cleanest of the five modules.

---

### Module 5: hardware audio stream activation intercept

**Depends on:** `cpal` dep (base plan, section 1) and the execution pipeline (section 5).

Monitors default system input devices natively, calling designated execution paths (e.g. the `Morning routine`) on a local voice keyword match.

> Note: `run_local_inference_evaluation` below is a stub returning a fixed transcript. Wiring a real local model (e.g. whisper.cpp bindings) is out of scope for this plan and must be its own tracked work before shipping.

#### Low-level sound stream allocation daemon (`src-tauri/src/process_core/voice_spotter.rs`)

```rust
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

pub fn arm_voice_macro_spotter_hardware(core_app_handle: tauri::AppHandle) -> Result<Box<dyn StreamTrait>, String> {
    let audio_host_subsystem = cpal::default_host();
    let audio_capture_device = audio_host_subsystem
        .default_input_device()
        .ok_or_else(|| String::from("Microphone Hardware Error: System default input device could not be resolved."))?;

    let stream_configuration = audio_capture_device
        .default_input_config()
        .map_err(|err| format!("Failed to read target microphone device hardware profile settings: {}", err))?;

    let circular_pcm_sample_window = Arc::new(Mutex::new(Vec::<f32>::with_capacity(48000)));

    let audio_data_processing_callback = move |pcm_samples: &[f32], _: &cpal::InputCallbackInfo| {
        let mut session_buffer = circular_pcm_sample_window.lock().unwrap();
        session_buffer.extend_from_slice(pcm_samples);
        
        // Evaluate inputs at designated 1.5-second runtime boundaries
        if session_buffer.len() >= 32000 {
            let processed_transcript = run_local_inference_evaluation(&session_buffer);
            session_buffer.clear();
            
            if processed_transcript.contains("launch morning routine") {
                // Forward target shortcut execution IDs directly onto main background execution pipelines
                let _ = core_app_handle.emit("voice_shortcut_match_found", String::from("mqygu6rr-c92ik75t"));
            }
        }
    };

    let hardware_input_stream = audio_capture_device
        .build_input_stream(
            &stream_configuration.config(),
            audio_data_processing_callback,
            move |err| println!("System audio capture driver reported an internal hardware stream error: {}", err),
            None
        )
        .map_err(|err| format!("Failed to bind input data processing callback onto capture stream: {}", err))?;

    hardware_input_stream.play()
        .map_err(|err| format!("Failed to command audio hardware device controller to start streaming data: {}", err))?;

    // Return the handle boxed to ensure the caller manages the hardware lifecycle without dropping allocations
    Ok(Box::new(hardware_input_stream))
}

fn run_local_inference_evaluation(_audio_frames: &[f32]) -> String {
    // Pipeline link maps directly onto local compiled whisper.cpp binding frameworks
    String::from("saropa launch morning routine")
}
```

#### Review notes

- **Sample-format assumption (correctness).** The stream is built from `default_input_config()` but the callback hardcodes `&[f32]` and never checks `stream_configuration.sample_format()`. If the device default is I16/U16 (common), the f32 callback gets garbage or the build fails at runtime. Branch on `sample_format()`.
- **Locking in the realtime audio callback.** `session_buffer.lock().unwrap()` inside the capture callback risks a glitch / priority inversion and panics on a poisoned mutex. Prefer a lock-free ring buffer feeding a separate worker.
- **The window is not actually 1.5 seconds.** `>= 32000` is labeled 1.5 s, but the sample rate is the device default and samples are interleaved across channels, so the real window is unknown. Compute the threshold from `config.sample_rate() * channels * seconds`.
- The stub note above is correct — keep the whisper.cpp wiring as separately-tracked work before shipping, and don't emit the hardcoded shortcut id from the stub.

---

## Saropa HUD Launcher — hardened security architecture

Security hardening for the base launcher in the base launcher section above: the webview
Content Security Policy and the hardened release compiler/linker directives.

### Sandbox content security policy (`src-frontend/index.html`)

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'none'; 
               script-src 'self'; 
               style-src 'self' 'unsafe-inline'; 
               img-src 'self' data: https://raw.githubusercontent.com; 
               connect-src 'self' ws://localhost:* http://127.0.0.1:8484;">
```

### Hardened enterprise release compiler directives (`.cargo/config.toml`)

```toml
[target.x86_64-pc-windows-msvc]
rustflags = [
    "-C", "link-arg=/NXCOMPAT",      # Enforces hardware-enforced Data Execution Prevention (DEP) memory shield walls
    "-C", "link-arg=/DYNAMICBASE",  # Enforces complete randomized application location tracking layouts (ASLR)
    "-C", "link-arg=/HIGHENTROPYVA" # Allocates high-entropy 64-bit hardware memory mapping spaces
]

[profile.release]
opt-level = 3
lto = true             # Enables exhaustive whole-program Link-Time Optimization algorithms across files
codegen-units = 1      # Combines processing threads into a single optimization pass
panic = "abort"        # Drops verbose call stack-unwinding data tables to minify binary footprint
strip = true           # Purges debug symbols to protect the codebase from reverse-engineering attempts
```

### Success criteria

- The webview loads under the CSP with no console violations; only loopback/localhost
  `connect-src` targets are reachable.
- The release build links with DEP/ASLR/high-entropy flags on Windows and ships
  stripped, `panic = "abort"`, LTO on.
