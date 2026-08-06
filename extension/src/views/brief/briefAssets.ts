// Inlined CSS + client script for the Morning Brief webview panel. All colors
// bind to --vscode-* theme variables — zero raw hex. The script receives brief
// data via postMessage and renders cards; the only outbound message is
// "openReport" with a path the host re-validates before opening.

export const BRIEF_STYLE = `
:root { color-scheme: light dark; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 16px 20px;
}
h1 { font-size: 1.3em; margin: 0 0 4px; }
.meta { color: var(--vscode-descriptionForeground); font-size: 0.88em; margin-bottom: 12px; }
.verdict {
  padding: 8px 14px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 1em;
  margin-bottom: 16px;
}
.verdict.clear {
  background: color-mix(in srgb, var(--vscode-testing-iconPassed) 15%, transparent);
  color: var(--vscode-testing-iconPassed);
  border: 1px solid color-mix(in srgb, var(--vscode-testing-iconPassed) 30%, transparent);
}
.verdict.attention {
  background: color-mix(in srgb, var(--vscode-testing-iconFailed) 15%, transparent);
  color: var(--vscode-testing-iconFailed);
  border: 1px solid color-mix(in srgb, var(--vscode-testing-iconFailed) 30%, transparent);
}
.cards { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.card {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  padding: 10px 14px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.card.attention-card {
  border-color: color-mix(in srgb, var(--vscode-testing-iconFailed) 40%, var(--vscode-panel-border));
}
.card.clear-card {
  opacity: 0.85;
}
.glyph {
  font-size: 1.1em;
  flex-shrink: 0;
  margin-top: 1px;
}
.glyph.pass { color: var(--vscode-testing-iconPassed); }
.glyph.fail { color: var(--vscode-testing-iconFailed); }
.glyph.skip { color: var(--vscode-descriptionForeground); }
.card-body { flex: 1; min-width: 0; }
.card-label { font-weight: 600; }
.card-headline {
  color: var(--vscode-descriptionForeground);
  font-size: 0.92em;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-duration {
  color: var(--vscode-descriptionForeground);
  font-size: 0.82em;
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}
.card-action { flex-shrink: 0; align-self: center; }
button {
  font-family: inherit; font-size: 0.9em;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary {
  color: var(--vscode-foreground);
  background: var(--vscode-button-secondaryBackground);
}
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.footer { margin-top: 8px; }
.empty { color: var(--vscode-descriptionForeground); padding: 24px 0; text-align: center; }
`;

export const BRIEF_SCRIPT = `
(function() {
  const vscode = acquireVsCodeApi();

  window.addEventListener('message', function(event) {
    const msg = event.data;
    if (msg.type === 'briefData') {
      render(msg.brief, msg.strings);
    }
  });

  function render(brief, S) {
    if (!brief) {
      document.getElementById('content').innerHTML =
        '<div class="empty">' + esc(S.none) + '</div>';
      return;
    }
    const verdictClass = brief.verdict === 'clear' ? 'clear' : 'attention';
    const verdictText = brief.verdict === 'clear'
      ? S.allClear
      : S.needsAttention.replace('{count}', brief.attentionCount);

    let html = '';
    html += '<div class="meta">' + esc(brief.routineName) + ' \\u00b7 ' + esc(formatTime(brief.generatedAt)) + '</div>';
    html += '<div class="verdict ' + verdictClass + '">' + esc(verdictText) + '</div>';
    html += '<div class="cards">';
    for (const m of brief.members) {
      const cardClass = m.attention ? 'attention-card' : 'clear-card';
      const glyphClass = statusGlyph(m.status);
      html += '<div class="card ' + cardClass + '">';
      html += '<span class="glyph ' + glyphClass.cls + '">' + glyphClass.icon + '</span>';
      html += '<div class="card-body">';
      html += '<div class="card-label">' + esc(m.label) + '</div>';
      if (m.headline) {
        html += '<div class="card-headline">' + esc(m.headline) + '</div>';
      }
      if (m.durationMs !== undefined) {
        html += '<div class="card-duration">' + formatDuration(m.durationMs) + '</div>';
      }
      html += '</div>';
      if (m.reportPath) {
        html += '<div class="card-action"><button class="secondary" data-path="' +
          esc(m.reportPath) + '">' + esc(S.openReport) + '</button></div>';
      }
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="footer"><button id="openSummary">' + esc(S.openSummary) + '</button></div>';

    document.getElementById('content').innerHTML = html;

    document.getElementById('openSummary').addEventListener('click', function() {
      vscode.postMessage({ type: 'openReport', path: brief.summaryPath });
    });
    document.querySelectorAll('[data-path]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        vscode.postMessage({ type: 'openReport', path: btn.dataset.path });
      });
    });
  }

  function statusGlyph(status) {
    switch (status) {
      case 'ok': return { cls: 'pass', icon: '\\u2714' };
      case 'dispatched': return { cls: 'pass', icon: '\\u2714' };
      case 'failed': return { cls: 'fail', icon: '\\u2718' };
      case 'missing': return { cls: 'fail', icon: '\\u2718' };
      case 'skipped': return { cls: 'skip', icon: '\\u2013' };
      default: return { cls: 'skip', icon: '\\u2013' };
    }
  }

  function formatDuration(ms) {
    if (ms < 1000) return ms + ' ms';
    return (ms / 1000).toFixed(1) + ' s';
  }

  function formatTime(iso) {
    try { return new Date(iso).toLocaleString(); }
    catch { return iso; }
  }

  function esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
`;
