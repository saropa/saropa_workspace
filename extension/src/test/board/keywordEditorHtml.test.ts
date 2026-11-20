// The Severity tab markup built straight from its pure functions (no page script run): ranges, the edited
// marker per list, the lossy-note line, escaping, and the data block handed to the script.

import { test } from "node:test";
import assert from "node:assert/strict";
import { NUMBER_RANGES, renderSeverityBody, severityData } from "../../board/keywordEditorHtml";
import { EDIT_LEVELS, LIMITS, SeverityDraft, defaultDraft } from "../../board/severityEdit";
import { keywordLabels } from "../../views/keywordStrings";

const t = keywordLabels();

// A copy of the shipped draft with one part changed, so a test names only what it varies.
const withDraft = (change: (d: SeverityDraft) => void): SeverityDraft => {
  const d = JSON.parse(JSON.stringify(defaultDraft())) as SeverityDraft;
  change(d);
  return d;
};

// The opening <details> tag of one list section, so an assertion reads only that section's marker.
const sectionOf = (html: string, kind: string): string => {
  const start = html.indexOf(`data-sec="${kind}"`);
  assert.ok(start >= 0, `section ${kind} is missing`);
  const next = html.indexOf("</details>", start);
  return html.slice(start, next);
};

test("each number field is held to the range the host also uses", () => {
  assert.deepEqual(NUMBER_RANGES["n-threshold"], LIMITS.threshold);
  assert.deepEqual(NUMBER_RANGES["n-title"], LIMITS.weight);
  assert.deepEqual(NUMBER_RANGES["n-head"], LIMITS.weight);
  assert.deepEqual(NUMBER_RANGES["n-body"], LIMITS.weight);
  assert.deepEqual(NUMBER_RANGES["n-perPhraseCap"], LIMITS.cap);
});

test("the body has one section per level, the scoring numbers, the negation words and the buttons", () => {
  const html = renderSeverityBody(t, defaultDraft());
  for (const level of EDIT_LEVELS) {
    assert.ok(html.includes(`data-sec="${level}"`), level);
  }
  for (const id of ["n-threshold", "n-title", "n-head", "n-body", "n-perPhraseCap"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(html.includes('data-sec="negation"') && html.includes('data-sec="scoring"') && html.includes('data-sec="preview"'));
  assert.ok(html.includes('id="sev-save"') && html.includes('id="sev-restoreAll"'));
});

test("the shipped draft shows no list as edited, and a changed list shows only its own marker", () => {
  const shipped = renderSeverityBody(t, defaultDraft());
  for (const level of EDIT_LEVELS) {
    assert.ok(/data-edited="[a-z]+" hidden/.test(sectionOf(shipped, level)), `${level} is marked edited without a change`);
  }
  const changed = renderSeverityBody(t, withDraft((d) => d.phrases.high.push("zzz-extra")));
  assert.ok(!/data-edited="high" hidden/.test(sectionOf(changed, "high")), "the changed list is not marked");
  assert.ok(/data-edited="low" hidden/.test(sectionOf(changed, "low")), "an unchanged list is marked");
});

test("a changed negation list is marked, and its input is held to the negation length", () => {
  const html = renderSeverityBody(t, withDraft((d) => d.negation.push("zzz-neg")));
  const neg = sectionOf(html, "negation");
  assert.ok(!/data-edited="negation" hidden/.test(neg));
  assert.ok(neg.includes(`maxlength="${LIMITS.negationChars}"`));
  assert.ok(sectionOf(html, "high").includes(`maxlength="${LIMITS.phraseChars}"`));
});

test("the count pill of a list is its number of phrases", () => {
  const d = defaultDraft();
  const html = renderSeverityBody(t, d);
  assert.ok(html.includes(`data-count="high" title="${t.levelTip.replace("{level}", t.sev_high).replace("{count}", String(d.phrases.high.length))}">${d.phrases.high.length}<`));
});

test("a lossy note shows once as a note line, and no note shows no line", () => {
  assert.ok(!renderSeverityBody(t, defaultDraft()).includes('id="sev-lossy"'));
  assert.ok(!renderSeverityBody(t, defaultDraft(), "").includes('id="sev-lossy"'));
  const html = renderSeverityBody(t, defaultDraft(), "A saved value is unusable");
  assert.equal(html.split('id="sev-lossy"').length - 1, 1);
  assert.ok(html.includes('role="note"') && html.includes("A saved value is unusable"));
});

test("a phrase, a note or a label with markup is escaped in the markup", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const html = renderSeverityBody({ ...t, intro: evil }, withDraft((d) => d.phrases.low.push(evil)), evil);
  assert.ok(!html.includes(evil), "raw markup reached the page");
  // escapeHtml emits numeric entities (&#60; for "<"), not named ones; assert that form and that no raw tag survives.
  assert.ok(html.includes("&#60;img"), "the markup was not entity-escaped");
  assert.ok(!html.includes("<img"), "a raw tag reached the page");
});

test("every number input carries its range, value and a tooltip with the field's explanation", () => {
  const d = defaultDraft();
  const html = renderSeverityBody(t, d);
  assert.ok(html.includes(`id="n-threshold" step="1" min="${LIMITS.threshold.min}" max="${LIMITS.threshold.max}" value="${d.threshold}"`));
  assert.ok(html.includes(`id="n-body" step="1" min="${LIMITS.weight.min}" max="${LIMITS.weight.max}" value="${d.weights.body}"`));
  assert.ok(html.includes('aria-describedby="n-threshold-h"') && html.includes('id="n-threshold-h"'));
});

test("the script data carries the text, the draft, the saved draft, the shipped draft and every limit", () => {
  const draft = withDraft((d) => {
    d.threshold = 7;
  });
  const data = severityData(t, draft) as Record<string, unknown>;
  assert.deepEqual(data.draft, draft);
  assert.deepEqual(data.saved, draft, "saved defaults to the draft");
  assert.deepEqual(data.defaults, defaultDraft());
  assert.deepEqual(data.levels, EDIT_LEVELS);
  assert.deepEqual(data.limits, LIMITS);
  assert.deepEqual(data.ranges, NUMBER_RANGES);
  assert.equal(data.t, t);
  const saved = defaultDraft();
  assert.deepEqual((severityData(t, draft, saved) as { saved: unknown }).saved, saved);
});
