# Saropa HUD Launcher (Standalone Desktop Edition) — base launcher

The out-of-process, zero-dependency desktop companion for the Saropa automation
suite: a native Tauri v2 + Tokio binary that reads `.vscode/saropa-workspace.json`
directly, renders a keyboard-driven HUD overlay, and executes pins independently of
the IDE extension process tree. It runs as an OS service daemon and UI overlay,
reading localized configurations without creating read-write contention with
running editor windows.

Companion plans: [WOW_X5_modules.md](WOW_X5_modules.md) (optional advanced modules)
and [WOW_X5_security.md](WOW_X5_security.md) (CSP + hardened release build).

---

## 1. Low-level core architecture and decoupling

The launcher operates as a native desktop binary managed via Tauri v2 and a
multi-threaded Tokio runtime core. It isolates file operations from visual
rendering lifecycles, using a lock-free transactional state machine to consume
`.vscode/saropa-workspace.json` schemas without triggering file-access locks
against the primary IDE workspace.

### A. Subsystem inter-process communication (IPC) layout

```text
[Global Input Event Hook] ──► [Tauri Hardware Key Interceptor] ──► [Foreground Window Booster]
                                                                                │
                                                                  Atomic JSON State Extraction
                                                                                │
                                                                                ▼
[Detached Shell PTY Spawn] ◄── [Native Advisory Mutex Locks] ◄── [Transactional Serialization]
```

### B. Directory tree and production code layout

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

### C. System-wide dependency layout (`src-tauri/Cargo.toml`)

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

## 2. Hardware-accelerated HUD UI/UX

The system renders an overlay that intercepts user keys for zero-mouse workspace routing.

### A. GPU-accelerated canvas stylesheet (`src-frontend/src/styles.css`)

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

### B. Client asynchronous key pipeline (`src-frontend/src/app.ts`)

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

## 3. Cross-platform window constraints and defenses

### Gotcha A: transparent frame click isolation (all display managers)

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

### Gotcha B: macOS application activation penalty

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

### Gotcha C: Wayland XDG portal client surface restrictions

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

## 4. Multi-instance concurrency guard and atomic write core

To guarantee that the standalone launcher service and an open IDE process extension
session never execute identical automated sequences simultaneously — such as a
heavy `Morning routine` loop — the engine implements exclusive low-level system
mutexes plus crash-safe config writes.

### A. Non-blocking advisory mutex engine (`src-tauri/src/scheduler_daemon/mutex_guard.rs`)

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

### B. Transactional config serialization pipeline (`src-tauri/src/config_bridge.rs`)

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

## 5. Config deserialization and cross-platform shell execution engine

### A. Production config ingestion schema map

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

### B. Windows high-integrity process elevation engine (`ShellExecuteExW`)

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

### C. Unified script processing router and headless PTY core (`src-tauri/src/process_core/mod.rs`)

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

## Success criteria (base launcher)

- `cargo build` produces a Tauri v2 binary matching the directory tree; the Rust
  kernel reads `.vscode/saropa-workspace.json` without blocking the IDE.
- HUD renders with the tokens above; keys `1`–`9` dispatch rows, `s`/`r`/`g` switch
  sections, `Escape` dismisses; row strings are HTML-escaped.
- Click-through, macOS focus capture, and Wayland/X11 stacking all behave.
- Two processes contending the same `shortcut_id` lock: exactly one wins; config
  writes are atomic (no truncated manifest on crash).
- A valid config deserializes; `runLocation` external/background/terminal each route
  correctly; `elevated` triggers UAC on Windows and tracks the process to exit.
