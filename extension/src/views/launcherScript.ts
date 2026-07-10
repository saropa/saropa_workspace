// The client renderer for the Saropa Launcher Panel webview. Receives {type:'data'} with the
// flat item list + header, renders the four panes (My shortcuts / Recipes / Watches / Project
// files) as collapsible groups of tinted cards, and posts user intents back (open, run,
// copyPath, a right-click menu command). All DOM is built defensively with textContent/
// createElement; nothing trusts the payload as markup.
//
// The script body lives in role-based fragments under ./launcher/ so each file stays under
// the line cap. They are concatenated here, in order, into the one string the view injects:
// a single <script> with one shared global scope. The leading newline reproduces the original
// template literal's framing exactly.
import { LAUNCHER_SCRIPT_CORE } from './launcher/launcherScriptCore';
import { LAUNCHER_SCRIPT_CARDS } from './launcher/launcherScriptCards';
import { LAUNCHER_SCRIPT_RENDER } from './launcher/launcherScriptRender';
import { LAUNCHER_SCRIPT_MENU } from './launcher/launcherScriptMenu';

export const LAUNCHER_SCRIPT =
  '\n' +
  LAUNCHER_SCRIPT_CORE +
  LAUNCHER_SCRIPT_CARDS +
  LAUNCHER_SCRIPT_RENDER +
  LAUNCHER_SCRIPT_MENU;
