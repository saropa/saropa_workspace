// The client renderer. Receives {type:'data'} with the planner graph, renders three
// views (Day timeline / Week planner / Workflow graph), and posts user intents back
// (run, retime via drag, link via plug-drag or toolbox-drop, configure, remove).
// All DOM is built defensively with escaping; nothing trusts the payload as markup.
//
// The script body lives in role-based fragments under ./planner/ so each file stays
// under the line cap. They are concatenated here, in order, into the one string the
// panel injects: a single <script> with one shared global scope. The leading and
// trailing newlines reproduce the original template literal's framing exactly.
import { PLANNER_CORE } from './planner/plannerScriptCore';
import { PLANNER_TIMELINE } from './planner/plannerScriptTimeline';
import { PLANNER_WORKFLOW } from './planner/plannerScriptWorkflow';
import { PLANNER_INSPECTOR } from './planner/plannerScriptInspector';
import { PLANNER_BOOTSTRAP } from './planner/plannerScriptBootstrap';

// The reassembled webview script: each fragment above owns one concern (core
// helpers, timeline view, workflow graph, inspector, bootstrap), concatenated back
// into the single script string the planner panel injects into its HTML.
export const PLANNER_SCRIPT =
  '\n' +
  PLANNER_CORE +
  PLANNER_TIMELINE +
  PLANNER_WORKFLOW +
  PLANNER_INSPECTOR +
  PLANNER_BOOTSTRAP;
