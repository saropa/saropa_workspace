// The client renderer for the Saropa Dashboard webview. Receives per-tab messages
// and renders the active tab. Tab switching is local (shows/hides a panel) and posts
// activateTab so the host loads that tab's data. Charts are drawn on <canvas> with
// the nonce'd script — no external chart library (that would break CSP and add a
// dependency).
//
// The script body lives in role-based fragments under ./dashboard/ so each file stays
// under the line cap. They are concatenated here, in order, into the one string the
// panel injects: a single <script> with one shared global scope. The leading newline
// reproduces the original template literal's framing exactly.
import { DASHBOARD_CORE } from './dashboard/dashboardScriptCore';
import { DASHBOARD_PROCESSES } from './dashboard/dashboardScriptProcesses';
import { DASHBOARD_ANALYTICS } from './dashboard/dashboardScriptAnalytics';
import { DASHBOARD_TRENDS } from './dashboard/dashboardScriptTrends';
import { DASHBOARD_BOOTSTRAP } from './dashboard/dashboardScriptBootstrap';

// The reassembled dashboard webview script, in fragment load order (see the file header
// for why the fragments are split and how the concatenation is injected).
export const PANEL_SCRIPT =
  '\n' +
  DASHBOARD_CORE +
  DASHBOARD_PROCESSES +
  DASHBOARD_ANALYTICS +
  DASHBOARD_TRENDS +
  DASHBOARD_BOOTSTRAP;
