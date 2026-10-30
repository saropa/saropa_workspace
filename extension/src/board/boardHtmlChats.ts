import { BoardStrings, escapeHtml, pl, tip } from "./boardHtmlUtil";

// The pieces of the board page that show chat activity: the "Active now" pill, the pause and play
// pill, and the notice bar that hides itself. Pure.

export const CHATS_STYLE = `
.go.active{color:var(--green);border:1px solid var(--green);font-size:11px;padding:0 6px}
.notice{margin:0 0 8px;padding:4px 10px;border:1px solid var(--line);border-radius:4px;font-size:12px;color:var(--mute)}`;

// The page script for these controls, appended to the main page script: the pause and play pill
// sends only its kind, and the notice bar removes itself after a few seconds.
export const CHATS_SCRIPT = `document.querySelectorAll('[data-chat-poll]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'chatPoll',rev:REV})));
const NOTICE=document.getElementById('notice');if(NOTICE){setTimeout(()=>NOTICE.remove(),6000);}`;

// The pill on a project row or card whose project has a chat working in it now.
export function activePill(active: boolean, t: BoardStrings): string {
  return active ? `<span class="go active" ${tip(t, "chatActiveTip")}>${escapeHtml(pl(t, "chatActive"))}</span>` : "";
}

// The icon pill that stops and resumes the 30-second look at the chats. Left out when the
// feature is off or unavailable (`paused` undefined).
export function pollPill(paused: boolean | undefined, t: BoardStrings): string {
  if (paused === undefined) {
    return "";
  }
  const key = paused ? "chatResume" : "chatPause";
  return `<button class="sec" data-chat-poll ${tip(t, key)} aria-label="${escapeHtml(pl(t, key))}">${paused ? "▶" : "⏸︎"}</button>`;
}

// A brief notice at the top of the page; the page script removes it.
export function noticeBar(text: string | undefined): string {
  return text ? `<div id="notice" class="notice" role="status" title="${escapeHtml(text)}">${escapeHtml(text)}</div>` : "";
}
