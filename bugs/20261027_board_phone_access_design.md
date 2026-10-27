# Release Board on a phone: read-only view over the local network

Status: design only. Nothing in this document is built.

Request: "if there is a way for a mobile phone on the same network to access this dashboard it would be a wonderful addition for developers and project managers to be able to look at the current status of the project."

## 1. What the user gets

- A button on the Release Board top bar: "Share on this network".
- Sharing is off until the user presses it. It never starts by itself, not even after a restart.
- Pressing it opens a small "Share" panel in VS Code with:
  - a QR code to scan with the phone camera;
  - the address to type, for example `https://192.168.1.20:47391`;
  - a short pairing code, for a phone that cannot scan;
  - the list of paired phones, each with a "Revoke" button;
  - one "Stop sharing" button.
- While sharing is on:
  - the board button turns into a colored chip: "Shared on network · 2 phones · Stop";
  - a status bar item says "Board shared" and opens the Share panel;
  - both stay visible when the board tab is closed.
- The phone browser shows a narrow, read-only page:
  - each shared project with its light (red, amber, green) and its counts;
  - Path to GO steps, as text, with no Run buttons;
  - the "Since last" strip;
  - the lists Resolve now, In progress, Work on: title, project, status, relative path;
  - the Future tab, read-only: title, project, importance flag, score, research state;
  - "Updated 14:32" at the top, and a banner when the connection is lost.
- The page updates by itself when the board rescans in VS Code.
- The page works on a phone screen first. The same narrow layout works on a tablet or laptop browser.

## 2. How it works

### 2.1 What exists today

- **The Mobile Remote Control feature cannot be reused for this.**
  - It is a VS Code panel listing `adb` commands that drive an Android device from the computer (`extension/src/views/remoteControl/`, `docs/MOBILE_REMOTE_CONTROL_PLAN.md`).
  - The data flows from the computer to the device through `adb`.
  - It has no network server, no login, no QR code and no pairing. The "pairing" in its plan is `adb pair` for wireless debugging.
  - The extension has no HTTP server anywhere today. This feature adds the first one.
- **Parts that are reused:**
  - `extension/src/views/boardFeed.ts`: the one publisher of the board (`currentBoard()`, `onDidChangeBoard`). The phone server listens to it. It never scans.
  - `extension/src/board/pathToGo.ts`: `pathToGo()` is pure. It is called with `canRun` always false.
  - `extension/src/views/boardSinceLast.ts`: `viewFor()` only reads. The phone server never calls `panelShowed()`, so a phone looking at the board never marks changes as seen.
  - `extension/src/board/boardHtmlUtil.ts`: `escapeHtml` and the strings table.
  - The light colors and box styles from `extension/src/board/boardHtmlAssets.ts` (the `STYLE` constant), copied into the phone page's style block.
- **The one server stack rule:** the new server lives in one folder, `extension/src/share/`. Any later feature that needs a phone (for example a Remote Control view) uses this server. No second server is added.

### 2.2 New parts

| Part | File (proposed) | Job |
|---|---|---|
| Phone view model | `src/share/phoneView.ts` | Builds an allow-list object from the board snapshot. Only named fields are copied. |
| Phone page renderer | `src/share/phoneHtml.ts` | Pure function: phone view model and strings in, HTML out. No VS Code import. |
| Server | `src/share/shareServer.ts` | `node:https` server, routes, headers, Host check, rate limits, server-sent events. |
| Pairing and sessions | `src/share/sharePairing.ts` | Session token, short code, device cookies, revoke, idle timer. |
| Certificate | `src/share/shareCert.ts` | Makes and stores one self-signed certificate per install. |
| QR code | `src/share/qr.ts` | Encodes the pairing address as an SVG QR code. |
| Network picker | `src/share/shareNetwork.ts` | Lists usable network interfaces. |
| Share panel | `src/views/sharePanel.ts` | The VS Code panel with QR, code, device list, Stop. |

### 2.3 The phone page is a separate renderer

- `renderBoard()` is not served to the phone.
- Reason: its script calls `acquireVsCodeApi()` and every button posts a write action (open, hand to chat, tidy, future flag changes, accept, run).
- Removing those controls from it would be fragile. A new board button would leak to the phone by default.
- The phone page has its own renderer. It gets only the phone view model. A new board field reaches the phone only when someone adds it to the allow-list type.

### 2.4 Requests

| Route | Method | Needs paired cookie | Returns |
|---|---|---|---|
| `/` | GET | yes; no cookie shows the pairing form | The full phone page, rendered on the server |
| `/p` | GET | no | A tiny pairing page. Its script reads the token from the address fragment |
| `/pair` | POST | no | Checks the token or short code, sets the device cookie, redirects to `/` |
| `/view` | GET | yes | The page body only, for a refresh without reloading |
| `/events` | GET | yes | Server-sent events: one `changed` line per board publish, a heartbeat every 25 seconds |
| anything else | any | n/a | 404 or 405, no body detail |

- The page works without script: it is a complete static render. Pull-to-refresh reloads it.
- With script: it listens on `/events` and swaps the body from `/view` on `changed`.
- Fallback: when the event stream drops (phones often kill it in the background), the page asks `/view` every 30 seconds while visible, and once on becoming visible again.
- The phone never starts a scan. A refresh returns the last published board. This stops a phone from loading the computer.

### 2.5 Pairing flow

1. The user presses "Share on this network".
2. The extension checks: workspace trusted, not a remote window, a usable network interface exists.
3. It asks which projects to share (multi-select; the last choice is pre-ticked).
4. It picks the interface (see 2.6), starts the server, makes a new session.
5. The session has:
   - a pairing token: 32 random bytes from `crypto.randomBytes`, base64url (256 bits);
   - a short code: 10 characters from a 32-letter alphabet without look-alike letters (50 bits), shown in groups, for example `K7QM-R4TX-9W`;
   - a cookie-signing key: 32 random bytes, held only in memory.
6. The QR code holds `https://<address>:<port>/p#<token>`.
   - The token is after `#`. Browsers never send the fragment to the server, never put it in a Referer header, and never write it to server logs.
   - The pairing page posts the token in the request body to `/pair`, then removes the fragment with `history.replaceState`.
7. A phone typing the address gets the pairing form and enters the short code. The form posts it to `/pair`.
8. `/pair` succeeds:
   - it makes a device id (16 random bytes);
   - it sets cookie `__Host-board=<device id>.<signature>`, `Secure; HttpOnly; SameSite=Strict; Path=/`, no `Max-Age` (dies with the browser session);
   - it adds the device to the Share panel list: browser and platform from the user agent, the phone's address, first seen, last seen.
9. The pairing window closes 10 minutes after the QR code is shown. "Show code again" opens a new window with a new token and code. Paired phones stay paired.

- Rotation: every "Share" press is a new session. New token, new code, new signing key. Cookies from an earlier session fail.
- Revoke one phone: its device id is removed. Its next request gets the pairing form.
- Stop: the server closes, the signing key is dropped, every cookie fails.

### 2.6 Which network address it listens on

- The server listens on one IPv4 address. It never listens on `0.0.0.0` unless the user sets that address and confirms a warning (see section 4).
- Candidates come from `os.networkInterfaces()`:
  - IPv4, not internal;
  - private ranges only: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`;
  - adapters that look virtual or tunneled are hidden by default: names starting `docker`, `br-`, `veth`, `vEthernet`, `vmnet`, `VirtualBox`, `utun`, `tun`, `tap`, `wg`, `ppp`, `tailscale`, `zt`.
- One candidate: used without asking.
- Several: a pick list shows the adapter name and address, for example "Wi-Fi — 192.168.1.20". The choice is remembered by adapter name.
- None: sharing does not start. The message says no local network was found.
- Port: random free port by default. A fixed port can be set, so a phone bookmark keeps working between sessions (the phone still pairs again each session).
- IPv6 is not supported in v1.

### 2.7 Stopping by itself

- Idle stop: no request from any paired phone for 30 minutes (setting). Before pairing, the idle clock is the pairing window.
- Hard limit: 8 hours from start (setting). Then the session stops even if phones are active.
- VS Code closes or the window reloads: the extension deactivates and the server closes. The server lives in the extension host process, so it cannot outlive the window.
- Workspace folders change so that a shared project is gone: that project drops out of the phone view. Sharing goes on.
- The phone sees "Sharing has stopped. Ask for a new code." when its event stream closes and `/view` fails.
- A notification in VS Code says when sharing stopped by itself and why.

### 2.8 Several windows

- Each VS Code window runs its own extension host. Each can share its own board on its own port.
- The status bar item makes the state visible per window.

### 2.9 Remote windows

- In a Remote SSH, WSL, dev container or Codespaces window, the extension host runs on the remote machine. A server there is not on the phone's network.
- v1 refuses to start when `vscode.env.remoteName` is set. The message says sharing works only in a local window.

## 3. Security and privacy

### 3.1 Transport: HTTPS with a self-signed certificate

- The server uses HTTPS.
- A certificate is made once per install: an ECDSA P-256 key from `crypto.generateKeyPairSync`, a certificate body written in DER by a small in-house writer, signed with `crypto.sign`. Node has no certificate-making call; the extension has no runtime dependencies today.
- The private key is kept in VS Code secret storage. The certificate is kept in the extension's global storage folder.
- "Make a new certificate" in the Share panel replaces both.
- The Share panel shows the certificate fingerprint (first 16 hex characters of the SHA-256), for users who want to compare it on the phone.

What HTTPS here protects:

- Someone on the same network who only listens cannot read the board, the token, the code or the cookie.
- The cookie can use the `__Host-` prefix and `Secure`, which only work on HTTPS.

What it does not protect:

- The phone shows a certificate warning the first time ("Your connection is not private"). The user must tap through it.
- At that moment the phone cannot tell the real computer from an attacker on the same network who answers in its place. An attacker who can redirect traffic on the network (for example ARP spoofing on Wi-Fi) can read the board and the pairing token on that first visit.
- Checking the fingerprint closes that gap only for users who check it. Most will not.
- The board is not protected from anyone who holds the phone, sees its screen, or is handed the QR code.
- The computer's own network exposure is unchanged by this feature beyond the one open port.

### 3.2 Host and origin checks (DNS rebinding)

- Every request: the `Host` header must equal `<bound address>:<port>` exactly. Anything else gets 421 and no body.
- This stops a web page on another site from using a DNS name that points at the computer's address to read the board through the user's own browser.
- `POST /pair`: the `Origin` header must equal `https://<bound address>:<port>`. Missing or different: 403.
- `/events` and `/view`: `Sec-Fetch-Site`, when present, must be `same-origin`.

### 3.3 Response headers on every response

- `Content-Security-Policy: default-src 'none'; style-src 'nonce-<n>'; script-src 'nonce-<n>'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
- A new nonce per response, from `crypto.randomBytes(16)`, as the board already does.
- `Referrer-Policy: no-referrer`
- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security` is not sent: the certificate is self-signed and the address changes.
- No `Server` or `X-Powered-By` header.

### 3.4 Limits

| Limit | Value |
|---|---|
| Requests per phone address | 20 per 10 seconds, then 429 |
| Pairing attempts per phone address | 5 per minute |
| Failed pairing attempts per session | 20, then the pairing window closes and needs "Show code again" |
| Paired phones | 5 by default, 10 at most |
| Open event streams | 2 per device, 10 in all |
| Request body | 1 KB; larger closes the connection |
| Request header wait | 10 seconds (`headersTimeout`), to stop slow-header attacks |
| Methods | GET everywhere, POST only on `/pair` |

- With 50 bits and these limits, guessing the short code takes far more attempts than a session allows.

### 3.5 What the phone can see

The phone view model is an allow-list. Only these fields are copied:

| Shown | Not shown |
|---|---|
| Project name and light | Absolute paths, workspace folder paths, user names in paths |
| Why the light is that color (the board's own words) | Document text of any kind |
| Counts: resolve now, in progress, work on, blocked | Needs line details (`link.detail`) |
| Item title, status, project, severity label, "stops release" mark | Live evidence: source file names and error text |
| Relative path inside the project (setting can hide it) | Chat session counts |
| Path to GO steps: title, project, reason, how many it unblocks | Run buttons, hand-off buttons, any button that acts |
| Since last strip lines | Review requests and groups from other extensions |
| Future: title, project, importance, score, research state, relative path | Future: blocker text, research question (both come from document text) |
| Time of the last scan | Sittings, tidy suggestions, link suggestions, rules |

- A path is dropped, not shortened, when it is absolute, has a drive letter, or contains `..`.
- Projects the user did not tick are absent everywhere, including the totals.
- Nothing from the phone is stored on disk. Paired devices live in memory and are gone at Stop.

### 3.6 Workspace trust and settings from a cloned repository

- The extension does not declare `capabilities.untrustedWorkspaces` today, so VS Code does not run it in Restricted Mode. The share command also checks `vscode.workspace.isTrusted` and refuses when false.
- Network settings (address, port, hard limit) use `"scope": "machine"`. A `.vscode/settings.json` inside a cloned repository cannot set the address to `0.0.0.0` or open a port.
- What to share (projects, hide paths, Future tab) may be set per workspace.

### 3.7 Logging

- The output channel logs: start, stop, reason for stop, address and port, each pairing (device id prefix and phone address), each revoke, each 4xx count per minute.
- It never logs the token, the short code, cookies or request bodies.

## 4. Settings

All under `saropaWorkspace.releaseBoard.share.`.

| Setting | Default | Scope | Meaning |
|---|---|---|---|
| `available` | `true` | machine | Shows the "Share on this network" button and command. `false` removes them. Sharing itself is always off until pressed. |
| `projects` | `[]` | window | Project ids to share. Empty: ask at start. |
| `hidePaths` | `false` | window | Phone shows titles only, no relative paths. |
| `includeFuture` | `true` | window | Phone shows the Future tab. |
| `bindAddress` | `""` | machine | Empty: pick from the list. An IPv4 address: use it. `0.0.0.0`: every network the computer is on, after a warning each start that names every address it opens on, VPNs included. |
| `port` | `0` | machine | `0`: a random free port. 1024–65535: that port. |
| `idleMinutes` | `30` | machine | 5–240. Stop after no phone request for this long. |
| `maxHours` | `8` | machine | 1–24. Stop after this long whatever happens. |
| `maxDevices` | `5` | machine | 1–10. |

## 5. What is read-only

- The phone can do nothing that changes anything. In v1 there are no write actions at all.
- No open file, no hand to chat, no Run, no Accept, no Tidy, no Future flag change, no research toggle, no settings, no profile switch, no scan.
- Routes: GET only, plus `POST /pair`, which only creates the device's own cookie.
- `src/share/` imports nothing from `boardPanelActions.ts`, `handToChat.ts`, `editorLinks.ts`, `tidy.ts`, `futureBlock.ts`, or `exec/`. A unit test reads the folder's import lines and fails if any appear.
- The phone page's only controls run in the phone: the Board / Future tab switch, open and close of Path to GO steps, and Refresh (reload).
- Viewing on the phone never marks "Since last" as seen. Only the VS Code tab does that.

## 6. Risks and costs

| Risk or cost | Size | Note |
|---|---|---|
| First network listener in the extension | High | New attack surface. Needs the security review in section 9. Some users and companies will not want it at all; `available: false` covers them. |
| Certificate warning | Medium | Every new phone sees a frightening warning once. Some users will stop there. |
| Firewall prompt | Medium | Windows asks to allow VS Code on private or public networks. On a network marked Public, Windows blocks it unless allowed. macOS asks to accept incoming connections for the VS Code helper. The extension does not change firewall rules. The Share panel explains this. |
| Client isolation | Medium | See 6.1. The feature simply does not work on many office and guest networks. |
| Project titles are sensitive | Medium | Titles can name customers or unreleased features. `hidePaths` hides paths, not titles. The start dialog says what will be visible. |
| Code size | — | Rough estimate: phone view and renderer 400 lines, server and pairing 450, certificate 200, QR code 300, network picker 100, Share panel 250, tests 600. About 2,300 lines. |
| Upkeep | Low | A new board field never reaches the phone by itself. Adding it to the phone is a deliberate edit. |
| Translations | Low | About 45 new strings. The phone page uses the VS Code display language, not the phone's. |
| Battery and CPU | Low | One heartbeat line every 25 seconds per stream. No scan is started by a phone. |

### 6.1 Office and guest networks with client isolation

- Many guest Wi-Fi networks and some office networks block devices from talking to each other ("client isolation" or "AP isolation").
- The phone then cannot reach the computer. Nothing on the computer can fix this.
- The Share panel shows a hint when no phone has connected within 60 seconds: "If the page does not open on your phone, this network may block devices from reaching each other. Try a home network, or turn on your phone's hotspot and connect the computer to it."
- The phone hotspot route works: the computer gets an address on the phone's own network (`172.20.10.x` on iPhone, often `192.168.43.x` on Android).
- Company policy may forbid opening ports on office networks. The start dialog says the board will be visible to anyone on this network who has the code.

### 6.2 VPNs

- On the computer:
  - A full-tunnel VPN often blocks the local network. The phone cannot connect. The hint above applies.
  - The VPN adapter has its own address, often in `10.x`. It is hidden from the pick list by name. Listening on it would show the board to other machines on the VPN's network, which is usually the company network.
  - A mesh VPN (Tailscale, ZeroTier) could let a phone reach the board from anywhere. This is out of scope for v1. A user can still set `bindAddress` to that address on purpose.
- On the phone:
  - A phone with a VPN on may send all traffic into the tunnel. It then cannot reach the computer. The user turns the VPN off or allows local network access in the VPN app.
- The extension does not detect VPNs. It only hides adapters by name.

## 7. Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Reuse the Mobile Remote Control feature | It drives an Android device over `adb`. It has no server, login or pairing to reuse. |
| Serve the board's webview HTML as is | It needs the VS Code webview API, and every control is a write action. |
| Plain HTTP with a token | Anyone on an open network can read the board and copy the cookie. Kept only as an open point (section 10). |
| Encrypt the board in the page with a key from the QR fragment | The browser's crypto API (`crypto.subtle`) is missing on plain HTTP pages at a LAN address, so this needs HTTPS anyway. |
| Listen on `0.0.0.0` by default | Opens the board on every adapter, VPNs and public networks included. |
| Cloud relay or a published web page | Project data leaves the network. Needs accounts and a hosted service. |
| VS Code port forwarding or dev tunnels | Puts the board on the internet. Needs a GitHub or Microsoft sign-in on the phone. A user can still do this by hand. |
| A native phone app | Far larger cost, store reviews, two more platforms. |
| Discovery by `.local` name (mDNS) | Patchy on Android. Not needed when the QR code carries the address. Possible later. |
| Static snapshot export (write a read-only HTML file to a synced folder) | No live updates and no network risk. Cheaper. Not what was asked. Listed in section 10 as a possible extra. |

## 8. Build order

Recommendation: build it, in 3 slices. Slice 1 is safe on its own. Slices 2 and 3 ship together in one release, because a server with no button is not visible to users and a button with no server does nothing.

### Slice 1 — Phone view and narrow page (no network)

- `phoneView.ts`: the allow-list type and the builder from `BoardSnapshot` plus `pathToGo()` (with `canRun` false) plus `viewFor()`.
- Publish the Future list through `boardFeed.ts` so a reader without the panel can see it. Consumer census: the sidebar, the status bar light and the editor lines read `currentBoard()`; each must ignore the new field.
- `phoneHtml.ts`: pure renderer, narrow layout first, works without script.
- A debug command "Open phone view preview" renders it into a plain webview with no message handling, for a layout check.
- Tests: excluded fields never appear; `hidePaths`; absolute, drive-letter and `..` paths dropped; HTML escaping of every text field; unticked projects absent from totals.

### Slice 2 — Server on the loopback address only

- `shareCert.ts`, `shareServer.ts`, `sharePairing.ts`, `qr.ts`.
- Listens on `127.0.0.1` only, behind a debug command, so the whole flow can be tested on the computer's own browser.
- Tests with real sockets on `127.0.0.1` (the pattern in `src/test/backgroundNotify.test.ts`): Host check, Origin check, headers on every route, rate limits, pairing with token and code, wrong code lockout, revoke, Stop, idle stop, cookie from an earlier session refused, no token or code in any log line, import-ban test for write modules.
- QR code: the encoder output decoded by a test decoder for a fixed set of addresses.

### Slice 3 — Local network, Share panel, board button

- `shareNetwork.ts` and the pick list.
- `sharePanel.ts`: QR, address, code, fingerprint, device list, Revoke, Stop, the isolation hint.
- Board top bar button and chip; status bar item; the settings in section 4 with machine scope; `package.nls.json` and `en.json` strings.
- Trust check and remote-window refusal.
- `0.0.0.0` warning.
- CHANGELOG entry; README section with the firewall, isolation and VPN notes.

### Later (not v1)

- mDNS name; phone-language strings; a home-screen icon for the page; mesh VPN as a supported route; read-only Remote Control status on the same server.

## 9. What the design review must check

- The allow-list type: no field in it can carry document text, an absolute path, or a source-file error message. `link.detail`, `blocker`, `researchQuestion`, `live` and `FutureOutside.path` are the known risks.
- Path filtering: absolute, drive-letter, UNC and `..` paths are dropped on Windows, macOS and Linux.
- That no route reaches a write path, directly or through an event the board panel also handles.
- That a phone never calls `panelShowed()` or anything that writes `seen`.
- Host header check is exact match, runs before routing, and covers `/events`.
- Origin check on `/pair`; behavior when `Origin` is absent.
- Token only in the fragment; `history.replaceState` runs before any other request; `Referrer-Policy` on the pairing page.
- Cookie: `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Strict`, signature compared with `crypto.timingSafeEqual`, signing key per session.
- Short code: alphabet, length, rate limits, lockout. Is 50 bits enough with the limits.
- Self-signed certificate writer: DER correctness, serial number randomness, validity dates, key storage in secret storage, what happens when secret storage is unavailable.
- The honest statement in 3.1: is it complete and does the start dialog say it in plain words.
- Interface filter: private ranges only, virtual and VPN names, behavior with several adapters on the same subnet.
- `0.0.0.0` only from a machine-scope setting, with a warning on every start.
- All network settings are machine scope and cannot come from a workspace file.
- Trust check and remote-window refusal run before any socket opens.
- Idle stop, hard stop and window close all close every socket, including open event streams.
- Server timeouts against slow clients; body size cap; event stream count cap.
- CSP on every response, including error responses and the pairing page.
- No token, code or cookie in logs, error messages or telemetry.
- Multi-project: unticked projects absent from every count and from Since last lines.

## 10. Open points

1. **Plain HTTP as an opt-in.** Should a machine setting allow plain HTTP for users who refuse the certificate warning, with a warning that the board and cookie can be read on the network? The design above has HTTPS only.
2. **Short code length.** 10 characters (50 bits) with lockout. A shorter code is easier to type and weaker.
3. **Future blocker line.** The board shows one line of blocker text from the document. This design hides it on the phone as document text.
4. **QR encoder.** Write it in-house (about 300 lines) or copy a small permissively licensed encoder into the source tree with its license note. The extension has no runtime dependencies today.
5. **Remote windows.** v1 refuses in SSH, WSL, container and Codespaces windows. WSL2 with mirrored networking could work later.
6. **Hard time limit.** 8 hours by default.
7. **Static snapshot export.** A separate, cheaper command that writes a read-only HTML file of the board, with no server. Not in this design's slices.
8. **Firewall rules.** The extension never adds firewall rules. Users on a network Windows marks as Public will be blocked until they change it themselves.
