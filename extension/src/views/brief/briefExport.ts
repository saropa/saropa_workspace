import type { RoutineBrief } from "../../exec/routineRunner";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusGlyph(status: string): { cls: string; icon: string } {
  switch (status) {
    case "ok":
    case "dispatched":
      return { cls: "pass", icon: "✔" };
    case "failed":
    case "missing":
      return { cls: "fail", icon: "✘" };
    default:
      return { cls: "skip", icon: "–" };
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "ok":
    case "dispatched":
      return "✅";
    case "failed":
    case "missing":
      return "❌";
    default:
      return "⏭️";
  }
}

/** Renders a brief as a Markdown snippet for pasting into Slack, GitHub, etc. */
export function renderBriefMarkdown(
  brief: RoutineBrief,
  strings: Record<string, string>
): string {
  const verdictText =
    brief.verdict === "clear"
      ? strings.allClear
      : strings.needsAttention.replace("{count}", String(brief.attentionCount));

  const lines: string[] = [
    `**${strings.title}** — ${brief.routineName}`,
    `${formatTime(brief.generatedAt)} · **${verdictText}**`,
    "",
  ];
  for (const m of brief.members) {
    let line = `${statusIcon(m.status)} **${m.label}**`;
    if (m.headline) {
      line += ` — ${m.headline}`;
    }
    if (m.durationMs !== undefined) {
      line += ` (${formatDuration(m.durationMs)})`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/** Renders a self-contained HTML document from a RoutineBrief for sharing outside VS Code. */
export function renderBriefExportHtml(
  brief: RoutineBrief,
  strings: Record<string, string>
): string {
  const verdictClass = brief.verdict === "clear" ? "clear" : "attention";
  const verdictText =
    brief.verdict === "clear"
      ? strings.allClear
      : strings.needsAttention.replace("{count}", String(brief.attentionCount));

  let cards = "";
  for (const m of brief.members) {
    const cardClass = m.attention ? "attention-card" : "clear-card";
    const g = statusGlyph(m.status);
    cards += `<div class="card ${cardClass}">`;
    cards += `<span class="glyph ${g.cls}">${g.icon}</span>`;
    cards += `<div class="card-body">`;
    cards += `<div class="card-label">${esc(m.label)}</div>`;
    if (m.headline) {
      cards += `<div class="card-headline">${esc(m.headline)}</div>`;
    }
    if (m.durationMs !== undefined) {
      cards += `<div class="card-duration">${formatDuration(m.durationMs)}</div>`;
    }
    cards += `</div></div>`;
  }

  const title = strings.title;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)} — ${esc(brief.routineName)}</title>
<style>
:root { color-scheme: light dark; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  color: #1e1e1e;
  background: #fff;
  margin: 0; padding: 24px 32px;
  max-width: 700px;
}
@media (prefers-color-scheme: dark) {
  body { color: #d4d4d4; background: #1e1e1e; }
  .card { border-color: #3c3c3c; }
}
h1 { font-size: 1.3em; margin: 0 0 4px; }
.meta { color: #888; font-size: 0.88em; margin-bottom: 12px; }
.verdict {
  padding: 8px 14px; border-radius: 6px;
  font-weight: 600; font-size: 1em; margin-bottom: 16px;
}
.verdict.clear { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
.verdict.attention { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
@media (prefers-color-scheme: dark) {
  .verdict.clear { background: #1b3a26; color: #75b798; border-color: #2d5a3e; }
  .verdict.attention { background: #3a1b1e; color: #e9868e; border-color: #5a2d32; }
}
.cards { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.card {
  border: 1px solid #e0e0e0; border-radius: 6px;
  padding: 10px 14px; display: flex; align-items: flex-start; gap: 10px;
}
.card.clear-card { opacity: 0.85; }
.glyph { font-size: 1.1em; flex-shrink: 0; margin-top: 1px; }
.glyph.pass { color: #28a745; }
.glyph.fail { color: #dc3545; }
.glyph.skip { color: #888; }
@media (prefers-color-scheme: dark) {
  .glyph.pass { color: #75b798; }
  .glyph.fail { color: #e9868e; }
}
.card-body { flex: 1; min-width: 0; }
.card-label { font-weight: 600; }
.card-headline {
  color: #888; font-size: 0.92em; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.card-duration { color: #888; font-size: 0.82em; font-variant-numeric: tabular-nums; margin-top: 2px; }
.footer { margin-top: 12px; color: #888; font-size: 0.82em; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>

<div class="meta">${esc(brief.routineName)} · ${esc(formatTime(brief.generatedAt))}</div>
<div class="verdict ${verdictClass}">${esc(verdictText)}</div>
<div class="cards">${cards}</div>
<div class="footer">${esc(strings.exportFooter)}</div>
</body>
</html>`;
}
