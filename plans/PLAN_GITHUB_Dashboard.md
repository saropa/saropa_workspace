# Detailed Architectural & UI/UX Specification: HubGrid Dashboard

## 1. System Architecture & Data Pipeline
To support a zero-latency, real-time command center for an enterprise development house, the architecture must move beyond REST polling. 

### 1.1. Data Ingestion & Streaming
*   **Ingestion:** GitHub App Webhooks push events (`push`, `pull_request`, `workflow_run`, `issues`) to an edge-deployed Go/Rust microservice.
*   **Queueing & Normalization:** Events are pushed into a Redis stream, normalizing disparate GitHub JSON payloads into a strict internal `DashboardEvent` schema.
*   **Client Delivery:** A Node.js/Socket.io cluster maintains persistent WebSocket (WSS) connections with active client browsers, pushing targeted diffs using JSON Patch (RFC 6902) to minimize payload size.
*   **State Management (Client):** React with Zustand for atomic state updates. To prevent DOM thrashing on high-frequency repos, incoming WS events are batched every 250ms via `requestAnimationFrame` before triggering React renders.

### 1.2. Fallback & Resilience
*   **WebSocket Drops:** If WSS disconnects, a pulsing amber indicator appears top-right (`var(--color-warning)`). The client implements exponential backoff with jitter for reconnections.
*   **Stale Data Recovery:** Upon reconnection, the client issues a `GET /sync?since={timestamp}` HTTP request to reconcile missed events.

---

## 2. Core Data Models (TypeScript)
The UI relies on a strictly typed normalized data structure to render the `SmartRow` uniformly across Issues, PRs, and Actions.

```typescript
type ItemStatus = 'success' | 'failing' | 'pending' | 'action_required' | 'open';
type ItemPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'none';

interface DashboardItem {
  id: string; // e.g., "repo_name:issue:256"
  repo: string; // "saropa_lints"
  type: 'pr' | 'issue' | 'action' | 'security_alert';
  title: string; // "Please bump the analyzer package version to 13"
  number: number; // 256
  author: { login: string; avatarUrl: string };
  status: ItemStatus;
  priority: ItemPriority;
  labels: string[]; // ["deferred", "needs-triage"]
  htmlUrl: string; // "https://github.com/..."
  timestamps: { created: number; updated: number };
  // Context-specific payload
  context?: {
    branch?: string;
    workflowName?: string; // e.g., "CodeQL"
    ciTimeMs?: number;
  }
}
```

---

## 3. Component Specification: `SmartRow` (Deep Dive)

The `SmartRow` is highly optimized to avoid repaint/reflow costs.

### 3.1. DOM Structure & CSS Grid (Tailwind conventions)
The row is constrained to exactly `h-10` (40px) to maximize vertical density.

```html
<!-- Row Container: relative positioning, grouped hover targets -->
<div class="group relative flex h-10 w-full items-center gap-3 border-b border-[#21262D] px-4 py-2 hover:bg-[#161B22] focus-within:bg-[#161B22] outline-none">
  
  <!-- Status Icon (Fixed Width) -->
  <div class="flex h-4 w-4 flex-shrink-0 items-center justify-center">...</div>
  
  <!-- Repo Tag (Fixed Width, Monospace) -->
  <span class="w-28 flex-shrink-0 truncate text-xs font-mono text-[#8B949E]">saropa_lints</span>
  
  <!-- Title & ID (Fluid Width, Truncated) -->
  <span class="truncate font-semibold text-[#58A6FF]">#256</span>
  <span class="truncate flex-1 text-sm text-[#C9D1D9]">Please bump the analyzer...</span>
  
  <!-- Labels (Hidden on mobile, fluid flex) -->
  <div class="hidden max-w-[150px] flex-shrink-0 gap-1 lg:flex">...</div>

  <!-- Absolute Positioned Action Bar (Hidden by default) -->
  <div class="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100">
     <!-- Action Buttons -->
  </div>
</div>
```

### 3.2. Truncation & Overflow Logic
*   **Branch Names:** Standard `text-overflow: ellipsis` fails for branch names because the important part is often at the end. Branch names must implement **middle truncation** via JS (e.g., `feat/add-...-lint-rules`).
*   **Titles:** Use CSS `truncate` (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`).

### 3.3. The Hover Action Bar (Micro-Interactions)
The Action Bar sits over the right-most content (like labels or timestamps) using an opaque gradient fade (`bg-gradient-to-l from-[#161B22]`) to ensure text underneath is obscured cleanly, preventing visual overlapping.

*   **Buttons:** `h-7`, `px-2`, `border border-[#30363D]`, `rounded-md`, `bg-[#21262D]`, `hover:bg-[#30363D]`.
*   **Copy Mechanics:** Relies on the `navigator.clipboard.writeText()` API. 
*   **Visual Feedback Timeline:**
    *   `T=0ms`: User clicks Copy. Button background flashes `#238636` (GitHub Green). Icon changes to `CheckIcon`.
    *   `T=1500ms`: React state reverts. Background fades back to `#21262D` over `200ms ease-in-out`. Icon reverts to `ClipboardIcon`.

---

## 4. Advanced "Quick Share" Routing & Serialization

To support the requirement to "QUICKLY... share them", the application state must perfectly map to the URL bar in real-time without causing page reloads.

### 4.1. URL State Management
We utilize `window.history.replaceState` coupled with URLSearchParams.
If a tech lead applies filters for `repo:saropa_lints`, `status:failing`, and opens the right sidebar for issue `#256`, the URL instantly mutates to:
`https://hubgrid.internal/?repos=saropa_lints&status=failing&focused=saropa_lints:issue:256`

### 4.2. Deep Linking Boot Sequence
When a user clicks a shared URL:
1.  Next.js router parses `searchParams` on the server.
2.  Initial HTML is hydrated with the precise filtered view (Edge Rendering).
3.  WebSocket connects and subscribes *only* to the Redis channels matching the URL filters (e.g., `channel:repo:saropa_lints`), saving client memory and bandwidth.

---

## 5. Keyboard Accessibility & Focus Trapping (a11y)

A "Power User" tool is useless if it requires a mouse. HubGrid implements strict focus management.

*   **Virtual Focus:** Standard DOM tab-indexing `tabindex="0"` on every row is too slow for 1000+ items. We implement a virtualized list (e.g., `@tanstack/react-virtual`). The `j`/`k` (Vim bindings) or `Up`/`Down` arrows control a React state `activeIndex`.
*   **Focus Styling:** The `activeIndex` row receives a strict visual indicator: `box-shadow: inset 2px 0 0 0 #58A6FF;` (A blue line on the absolute left edge) and triggers the Action Bar visibility.
*   **Keyboard Actions:**
    *   When `activeIndex` is focused, pressing `c` triggers the `writeText` API for the URL.
    *   Pressing `Shift + c` compiles the markdown: `` navigator.clipboard.writeText(`[${item.repo}#${item.number}](${item.htmlUrl})`) ``.

---

## 6. Edge Cases & Error Handling

*   **API Rate Limiting:** While WSS bypasses this for live data, initial hydrating fetches might hit GitHub API limits. If HTTP 429 (Too Many Requests) is returned, the UI displays a `retry-after` countdown overlay, dimming the data canvas.
*   **Mass Failures (The "Red Sea" problem):** If a core dependency breaks and 50+ actions fail simultaneously, the client-side batched rendering kicks in. The UI aggregates the notification toast: *"52 actions failed across 4 repos in the last 10 seconds"* instead of firing 52 individual slide-in toasts.
*   **Deleted Records:** If an issue is deleted on GitHub, the WSS pushes a `{ action: "delete", id: "..." }` payload. The `SmartRow` immediately collapses its height to `0px` with a `200ms ease-in` transition, and is then unmounted from the DOM, allowing remaining items to slide up smoothly.