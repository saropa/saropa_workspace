import { LiveFile } from "./liveEvidence";
import { BoardStrings } from "./boardStrings";

// Small helpers shared by every part of the page: escaping, placeholder filling and the
// Hand to chat button.

// Escapes text for HTML. Every piece of untrusted text goes through this before it is placed in the page.
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// One line of live evidence for a file: the file name, then the counts of each source.
export function liveLine(f: LiveFile, t: BoardStrings): string {
  const v = (c: { errors: number; warnings: number; crashes?: number }): Record<string, number> => ({ errors: c.errors, warnings: c.warnings, crashes: c.crashes ?? 0 });
  const raw = (tmpl: string, c: { errors: number; warnings: number; crashes?: number }): string => tmpl.replace(/\{(\w+)\}/g, (m, k: string) => String(v(c)[k] ?? m));
  const bits = [f.logs ? raw(t.liveLogs, f.logs) : "", f.problems ? raw(t.liveProblems, f.problems) : "", f.lints ? raw(t.liveLints, f.lints) : ""].filter(Boolean);
  return `${f.file}: ${bits.join("; ")}`;
}

// The Hand to chat button. It carries only indexes; the host builds the prompt from the model it rendered.
export function handButton(t: BoardStrings, attrs: string): string {
  return t.handToChat ? `<button class="hb" ${attrs} title="${escapeHtml(t.handToChatTip)}">${escapeHtml(t.handToChat)}</button>` : "";
}

// Fills {name} placeholders after escaping, so a document title can never add markup.
export function fill(tmpl: string, vars: Record<string, string | number | undefined>): string {
  return escapeHtml(tmpl).replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : escapeHtml(String(vars[k]))));
}
