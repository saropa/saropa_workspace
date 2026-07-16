# Saropa HUD Launcher — advanced modules

Optional add-ons layered on the base launcher in [WOW_X5.md](WOW_X5.md). Each module
is independent; none is required to ship the base app.

---

## Module 1: embedded PTY terminal backpressure and UTF-8 splitting guard

**Depends on:** the background PTY pipeline (base plan, section 5).

Processes terminal character data from background tasks safely, handling fragmented
multi-byte character strings and preventing UI-framework flooding.

### Throttled UTF-8 character streaming loop (`src-tauri/src/process_core/pty_engine.rs`)

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

### Review notes

- **Byte 0 is never checked (correctness).** The scan loop is
  `while index > 0 && checking_back_steps < 4`, so index 0 is never examined. A
  buffer whose multi-byte leader sits at position 0 with only continuation bytes
  after it — e.g. `[0xE0, 0x80]` (3-byte leader + 1 continuation, truncated) —
  falls through to `length`, so the truncated tail reaches `from_utf8_lossy` and
  renders as the replacement-character artifact this function exists to prevent.
  Handle index 0 explicitly.
- **`tokio::select!` wraps a single branch (dead abstraction).** With one arm it
  just awaits that arm; the comment about "deadlocking file descriptors" is not a
  real effect. Drop the `select!`, or add the real second branch (a shutdown
  signal) it was presumably meant to carry.
- **`carryover_byte_vector.clone()` every read (minor perf).** Avoidable — splice
  the carryover in place instead of cloning per iteration.

---

## Module 2: authenticated loopback receiver gateway (timing-attack shield)

**Depends on:** `axum`/`hmac`/`sha2`/`hex` deps (base plan, section 1) and execution lanes (section 5).

Exposes a loopback-only web routing target, allowing cloud endpoints or background
tools to trigger script macros securely with a constant-time HMAC check.

### Production Axum server implementation (`src-tauri/src/scheduler_daemon/webhook_server.rs`)

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

### Review notes

- **The path parameter is unauthenticated (security).** The HMAC covers
  `raw_payload_body` only; `shortcut_id` comes from the URL path and is what
  selects the macro to run. A single captured `(body, signature)` pair validates
  against `/v2/webhook/trigger/<any-other-id>`, so anyone holding one valid
  signature can trigger every shortcut. Sign the `shortcut_id` together with the
  body (or the full request line).
- **No replay protection (security).** No timestamp or nonce means any local
  process can replay a captured request. Loopback binding is the only mitigation —
  state that as the assumed trust boundary, and consider a short-lived nonce.
- **`.expect()` / `.unwrap()` crash the daemon (robustness).** `TcpListener::bind`
  panics if port 8484 is occupied and `axum::serve(...).unwrap()` panics on any
  serve error, taking the whole daemon down. Degrade gracefully and surface the
  failure instead.
- **Reimplementing constant-time compare is unnecessary.** The `hmac` crate's
  `verify_slice` is constant-time and harder to get wrong than a hand-rolled loop.

---

## Module 3: pre-flight diagnostics pipeline

**Depends on:** the execution engine (base plan, section 5).

Performs proactive toolchain and network availability audits *before* initiating
script sequences or routine macros.

### Asynchronous pre-push diagnostic probe (`src-tauri/src/process_core/preflight.rs`)

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

### Review notes

- **Port check is inverted — reports every port as blocked (correctness).**
  `timeout(dur, TcpStream::connect(addr)).await` returns
  `Result<Result<TcpStream, io::Error>, Elapsed>`, and `.is_ok()` is true whenever
  the connect *future completed* before the deadline — including the
  `ConnectionRefused` that a free port returns immediately. So a free port reports
  `target_port_unlocked = false`, and an occupied port also reports false; the only
  "unlocked" result is a dropped SYN that times out. The check is backwards. Use
  `matches!(timeout(dur, connect).await, Ok(Ok(_)))` for "occupied".
- **Missing `use std::path::Path` — won't compile.** `inspect_git_tracking_vectors`
  calls `Path::new(...)` but the imports are only `Command`, `Duration`,
  `TcpStream`.
- **Blocking IO in an async command.** `Command::new(...).output()` is blocking
  `std::process` inside `#[tauri::command] async fn` and stalls the tokio worker.
  Use `tokio::process::Command`.
- **Git-sync heuristic misreports packed refs.** Reading `.git/refs/heads/main` as
  a loose file fails when refs are packed (common); the existence guard then
  returns `true` and reports "synchronized" for a repo it never checked. The
  `FETCH_HEAD` `contains(...)` test is also fragile (tab-delimited format, detached
  HEAD). Use `git rev-parse` / `git status -uno` output instead of parsing `.git`
  internals.

---

## Module 4: low-level OS context observer hooks

**Depends on:** the base IPC runtime (base plan, section 1).

Intercepts active process transitions at the OS window-manager layer, dynamically
filtering dashboard visibility based on the active developer app.

### Asynchronous application state monitor core (`src-tauri/src/process_core/window_observer.rs`)

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

### Review notes

- **Blocking spawns on the async runtime.** The macOS/Linux paths shell out via
  blocking `std::process::Command` every 600 ms on a tokio task; `osascript`
  especially runs ~100 ms+ per call and will occupy a worker. Use
  `tokio::process::Command`.
- **Linux is X11-only.** `xdotool` yields "unknown" under Wayland silently — note
  the limitation, or detect the session type and skip.
- The Windows path correctly closes the process handle in all branches — this is
  the cleanest of the five modules.

---

## Module 5: hardware audio stream activation intercept

**Depends on:** `cpal` dep (base plan, section 1) and the execution pipeline (section 5).

Monitors default system input devices natively, calling designated execution paths
(e.g. the `Morning routine`) on a local voice keyword match.

> Note: `run_local_inference_evaluation` below is a stub returning a fixed
> transcript. Wiring a real local model (e.g. whisper.cpp bindings) is out of scope
> for this plan and must be its own tracked work before shipping.

### Low-level sound stream allocation daemon (`src-tauri/src/process_core/voice_spotter.rs`)

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

### Review notes

- **Sample-format assumption (correctness).** The stream is built from
  `default_input_config()` but the callback hardcodes `&[f32]` and never checks
  `stream_configuration.sample_format()`. If the device default is I16/U16 (common),
  the f32 callback gets garbage or the build fails at runtime. Branch on
  `sample_format()`.
- **Locking in the realtime audio callback.** `session_buffer.lock().unwrap()`
  inside the capture callback risks a glitch / priority inversion and panics on a
  poisoned mutex. Prefer a lock-free ring buffer feeding a separate worker.
- **The window is not actually 1.5 seconds.** `>= 32000` is labeled 1.5 s, but the
  sample rate is the device default and samples are interleaved across channels, so
  the real window is unknown. Compute the threshold from
  `config.sample_rate() * channels * seconds`.
- The stub note above is correct — keep the whisper.cpp wiring as separately-tracked
  work before shipping, and don't emit the hardcoded shortcut id from the stub.
