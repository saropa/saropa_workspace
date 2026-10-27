// The keyword editor's pure part: checking a draft, finding what differs from the shipped
// dictionary, writing the difference into the rules file text, and counting which documents
// would change level.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SEVERITY, scoreDocument } from "../../board/severity";
import {
  EDIT_LEVELS, LIMITS, SeverityDraft, applyDraft, checkDraft, customizedParts, defaultDraft, dictFromDraft, dictOfSeverity, draftDiffers, draftFromDict, draftOfText,
  normalizeText, previewChanges, removeSeverity,
} from "../../board/severityEdit";

const clone = (d: SeverityDraft): SeverityDraft => JSON.parse(JSON.stringify(d));

test("normalizing lowercases, trims and folds white space", () => {
  assert.equal(normalizeText("  Data   LOSS "), "data loss");
  assert.equal(normalizeText("\t"), "");
  assert.equal(normalizeText("Ünïcode"), "ünïcode");
});

test("the shipped dictionary is a draft that differs from nothing and passes the check", () => {
  const d = defaultDraft();
  assert.deepEqual(draftDiffers(d), []);
  const c = checkDraft(d);
  assert.equal(c.ok, true);
  assert.deepEqual(c.ok && c.draft, d);
  assert.deepEqual(Object.keys(d.phrases), [...EDIT_LEVELS]);
});

test("a checked draft keeps the shipped spelling of a phrase, such as the space after nit", () => {
  const d = clone(defaultDraft());
  d.phrases.low = ["NIT", "Typo ", "brand new"];
  const c = checkDraft(d);
  assert.ok(c.ok);
  assert.deepEqual(c.ok && c.draft.phrases.low, ["nit ", "typo", "brand new"]);
  assert.deepEqual(draftDiffers(c.ok ? c.draft : d), ["phrases.low"]);
});

test("a draft is cleaned: empty and repeated entries drop out", () => {
  const d = clone(defaultDraft());
  d.phrases.high = ["Sign In", "sign   in", "", "  ", "welcome"];
  d.negation = ["no", "NO ", "hardly"];
  const c = checkDraft(d);
  assert.ok(c.ok);
  assert.deepEqual(c.ok && c.draft.phrases.high, ["sign in", "welcome"]);
  assert.deepEqual(c.ok && c.draft.negation, ["no ", "hardly"]);
});

test("a draft with a value out of range, of the wrong type, too long or too many is refused", () => {
  const bad = (f: (d: SeverityDraft) => void): string[] => {
    const d = clone(defaultDraft());
    f(d);
    const c = checkDraft(d);
    return c.ok ? [] : c.problems;
  };
  assert.deepEqual(bad((d) => (d.threshold = 0)), ["threshold"]);
  assert.deepEqual(bad((d) => (d.threshold = 31)), ["threshold"]);
  assert.deepEqual(bad((d) => (d.threshold = 2.5)), ["threshold"]);
  assert.deepEqual(bad((d) => (d.threshold = Number.NaN)), ["threshold"]);
  assert.deepEqual(bad((d) => (d.weights.title = -1)), ["weight"]);
  assert.deepEqual(bad((d) => (d.weights.body = 11)), ["weight"]);
  assert.deepEqual(bad((d) => (d.weights.perPhraseCap = 0)), ["cap"]);
  assert.deepEqual(bad((d) => (d.phrases.high = ["x".repeat(LIMITS.phraseChars + 1)])), ["tooLong"]);
  assert.deepEqual(bad((d) => (d.phrases.high = Array.from({ length: LIMITS.phrases + 1 }, (_x, i) => `p${i}`))), ["tooMany"]);
  assert.deepEqual(bad((d) => (d.negation = Array.from({ length: LIMITS.negation + 1 }, (_x, i) => `n${i}`))), ["tooMany"]);
  assert.deepEqual(bad((d) => (d.negation = ["x".repeat(LIMITS.negationChars + 1)])), ["tooLong"]);
  assert.deepEqual(bad((d) => (d.phrases.low = ["line\nbreak"])), ["badChar"]);
  assert.deepEqual(bad((d) => (d.phrases.low = ["tab\there"])), ["badChar"]);
  assert.deepEqual(bad((d) => (d.phrases.low = [5 as unknown as string])), ["shape"]);
  assert.deepEqual(bad((d) => ((d.phrases as unknown as Record<string, unknown>).low = "typo")), ["shape"]);
  assert.deepEqual(bad((d) => ((d as unknown as Record<string, unknown>).weights = null)), ["shape"]);
  assert.equal(checkDraft("nope").ok, false);
  assert.equal(checkDraft(null).ok, false);
  assert.equal(checkDraft([]).ok, false);
});

test("phrases are plain text: a pattern is a literal string, never a pattern", () => {
  const d = clone(defaultDraft());
  d.phrases.low = [".*", "(a+)+$", "a|b"];
  const c = checkDraft(d);
  assert.ok(c.ok);
  const dict = dictFromDraft(c.ok ? c.draft : d);
  assert.equal(scoreDocument("# Notes\n\nstuff a b aaaa\n", "docs/n.md", dict).severity, "medium", "nothing matches a pattern-looking phrase");
  assert.deepEqual(dict.phrases.low, [".*", "(a+)+$", "a|b"]);
});

test("a draft made from a dictionary falls back for values a hand edit broke", () => {
  const broken = { ...DEFAULT_SEVERITY, threshold: "many", weights: { title: -4, head: 2, body: 99, perPhraseCap: 3 }, negation: "no", phrases: { ...DEFAULT_SEVERITY.phrases, high: ["ok", 7, "line\nbreak", "ok"] } } as unknown as typeof DEFAULT_SEVERITY;
  const d = draftFromDict(broken);
  assert.equal(d.threshold, 3);
  assert.deepEqual(d.weights, { title: 3, head: 2, body: 1, perPhraseCap: 3 });
  assert.deepEqual(d.negation, DEFAULT_SEVERITY.negation);
  assert.deepEqual(d.phrases.high, ["ok"]);
});

test("a dictionary made from a draft keeps the parts the editor does not show", () => {
  const d = clone(defaultDraft());
  d.threshold = 5;
  d.phrases.extreme = ["payment"];
  const base = { ...DEFAULT_SEVERITY, minBodyDensity: 9, audience: { pro: ["vip"] } };
  const dict = dictFromDraft(d, base);
  assert.equal(dict.threshold, 5);
  assert.deepEqual(dict.phrases.extreme, ["payment"]);
  assert.equal(dict.minBodyDensity, 9);
  assert.deepEqual(dict.audience.pro, ["vip"]);
  assert.deepEqual(dict.phrases.critical, DEFAULT_SEVERITY.phrases.critical);
});

test("customizedParts names what a user's severity key changes, and nothing for the shipped values", () => {
  assert.deepEqual(customizedParts(undefined), []);
  assert.deepEqual(customizedParts("x"), []);
  assert.deepEqual(customizedParts({}), []);
  assert.deepEqual(customizedParts({ threshold: 3, weights: { title: 3 }, negation: [...DEFAULT_SEVERITY.negation].reverse() }), [], "the same values in any order are not a change");
  assert.deepEqual(customizedParts({ threshold: 5, weights: { head: 4 }, phrases: { high: ["onboarding"] }, minBodyDensity: 1, audience: { pro: ["vip"] } }), ["threshold", "weights", "phrases.high", "minBodyDensity", "audience"]);
  assert.deepEqual(customizedParts({ negation: ["no "] }), ["negation"]);
});

test("applying a draft writes only the differences from the shipped dictionary", () => {
  const d = clone(defaultDraft());
  d.threshold = 4;
  d.weights.head = 5;
  d.phrases.high = [...d.phrases.high, "welcome tour"];
  const r = applyDraft('{\n  "version": 1\n}\n', d);
  assert.ok(r.ok && r.changed);
  const doc = JSON.parse(r.ok ? r.text : "{}");
  assert.deepEqual(doc.severity, { threshold: 4, weights: { head: 5 }, phrases: { high: [...DEFAULT_SEVERITY.phrases.high!, "welcome tour"] } });
  assert.equal(doc.version, 1);
  assert.ok(r.ok && r.text.endsWith("\n"));
});

test("the written file scores documents the way the draft does", () => {
  const d = clone(defaultDraft());
  d.phrases.extreme = d.phrases.extreme.filter((p) => p !== "price" && p !== "pricing");
  const r = applyDraft("{}", d);
  assert.ok(r.ok);
  const written = dictOfSeverity(JSON.parse(r.ok ? r.text : "{}").severity);
  assert.deepEqual(written, dictFromDraft(d));
  const text = "# Pricing page\n\nThe price list.\n";
  assert.equal(scoreDocument(text, "docs/p.md", DEFAULT_SEVERITY).severity, "extreme");
  assert.notEqual(scoreDocument(text, "docs/p.md", written).severity, "extreme");
});

test("a draft equal to the shipped dictionary removes the parts it set and leaves other content alone", () => {
  const before = JSON.stringify({ version: 1, pinned: ["a/b.md"], severity: { threshold: 9, weights: { head: 9 }, phrases: { high: ["x"], medium: ["keep"] }, audience: { pro: ["vip"] } } }, null, 2);
  const r = applyDraft(before, defaultDraft());
  assert.ok(r.ok && r.changed);
  const doc = JSON.parse(r.ok ? r.text : "{}");
  assert.deepEqual(doc, { version: 1, pinned: ["a/b.md"], severity: { phrases: { medium: ["keep"] }, audience: { pro: ["vip"] } } });
});

test("when nothing is left in severity the key goes", () => {
  const r = applyDraft('{"version":1,"severity":{"threshold":9}}', defaultDraft());
  assert.ok(r.ok);
  assert.deepEqual(JSON.parse(r.ok ? r.text : "{}"), { version: 1 });
});

test("a draft that changes nothing leaves the text exactly as it was, even a blank file", () => {
  const text = '{ "version": 1,   "pinned": [ "a" ] }';
  const same = applyDraft(text, defaultDraft());
  assert.deepEqual(same, { ok: true, text, changed: false });
  assert.deepEqual(applyDraft(undefined, defaultDraft()), { ok: true, text: "", changed: false });
  assert.deepEqual(applyDraft("  \n", defaultDraft()), { ok: true, text: "", changed: false });
});

test("a blank or missing file becomes a new file with a version and the severity key", () => {
  const d = clone(defaultDraft());
  d.threshold = 2;
  const r = applyDraft(undefined, d);
  assert.ok(r.ok && r.changed);
  assert.equal(r.ok && r.text, '{\n  "version": 1,\n  "severity": {\n    "threshold": 2\n  }\n}\n');
});

test("indent and line ends of the file are kept", () => {
  const d = clone(defaultDraft());
  d.threshold = 2;
  const r = applyDraft('{\r\n    "version": 1\r\n}\r\n', d);
  assert.ok(r.ok);
  assert.equal(r.ok && r.text, '{\r\n    "version": 1,\r\n    "severity": {\r\n        "threshold": 2\r\n    }\r\n}\r\n');
});

test("a file that cannot be rewritten safely is refused", () => {
  const d = clone(defaultDraft());
  d.threshold = 2;
  assert.deepEqual(applyDraft("{ // note\n}", d), { ok: false, reason: "parse" });
  assert.deepEqual(applyDraft("[]", d), { ok: false, reason: "shape" });
  assert.deepEqual(applyDraft('{"severity": "x"}', d), { ok: false, reason: "shape" });
  assert.deepEqual(applyDraft('{"severity": {"weights": []}}', d), { ok: false, reason: "shape" });
  assert.deepEqual(applyDraft('{"severity": {"phrases": 3}}', d), { ok: false, reason: "shape" });
  assert.deepEqual(applyDraft('{"version": 1, "version": 2}', d), { ok: false, reason: "lossy" });
  assert.deepEqual(applyDraft('{"version": 12345678901234567890123}', d), { ok: false, reason: "lossy" });
});

test("restoring removes the whole severity key and nothing else", () => {
  const r = removeSeverity('{"version":1,"severity":{"threshold":9,"audience":{"pro":["x"]}},"pinned":["a"]}');
  assert.ok(r.ok && r.changed);
  assert.deepEqual(JSON.parse(r.ok ? r.text : "{}"), { version: 1, pinned: ["a"] });
  assert.deepEqual(removeSeverity('{"version":1}'), { ok: true, text: '{"version":1}', changed: false });
  assert.deepEqual(removeSeverity("{ // x\n}"), { ok: false, reason: "parse" });
});

test("the draft a file text stands for", () => {
  assert.deepEqual(draftOfText(undefined), defaultDraft());
  assert.equal(draftOfText("{ // x"), undefined);
  const d = draftOfText('{"severity":{"threshold":6}}');
  assert.equal(d?.threshold, 6);
});

const DOCS = [
  { title: "Pricing", project: "App", path: "docs/pricing.md", text: "# Pricing\n\nThe price of the plan.\n" },
  { title: "Typo", project: "App", path: "docs/typo.md", text: "# Typo in the readme\n\nA cosmetic typo.\n" },
  { title: "Plain", project: "Db", path: "docs/plain.md", text: "# Plain\n\nNothing special.\n" },
].map((d) => ({ ...d, before: scoreDocument(d.text, d.path).severity }));

test("the shipped dictionary changes nothing", () => {
  const r = previewChanges(DOCS, DEFAULT_SEVERITY, "deliberate");
  assert.deepEqual(r, { checked: 3, changed: 0, lowered: 0, raised: 0, eased: 0, tightened: 0, examples: [] });
});

test("the preview counts documents that change level, how many stop the release no longer, and lists them", () => {
  const d = clone(defaultDraft());
  d.phrases.extreme = d.phrases.extreme.filter((p) => p !== "price" && p !== "pricing");
  d.phrases.critical = [...d.phrases.critical, "typo"];
  const r = previewChanges(DOCS, dictFromDraft(d), "deliberate");
  assert.equal(r.checked, 3);
  assert.equal(r.changed, 2);
  assert.equal(r.lowered, 1);
  assert.equal(r.raised, 1);
  assert.equal(r.eased, 1);
  assert.equal(r.tightened, 1, "the typo document was Low and is now Critical: it starts to stop the release");
});

test("a document that starts to stop the release is counted", () => {
  const d = clone(defaultDraft());
  d.phrases.critical = [...d.phrases.critical, "plain"];
  const r = previewChanges(DOCS, dictFromDraft(d), "deliberate");
  assert.equal(r.tightened, 1);
  assert.equal(r.examples[0].title, "Plain");
  assert.deepEqual([r.examples[0].from, r.examples[0].to, r.examples[0].stopsFrom, r.examples[0].stopsTo], ["medium", "critical", false, true]);
});

test("examples put documents that stop the release no longer first, and are cut at the limit", () => {
  const d = clone(defaultDraft());
  d.threshold = 30;
  const many = Array.from({ length: 12 }, (_x, i) => ({ title: `Doc ${i}`, project: "App", path: `docs/d${i}.md`, text: "# Pricing\n\nprice\n", before: "extreme" as const }));
  const r = previewChanges([...DOCS, ...many], dictFromDraft(d), "deliberate", 5);
  assert.equal(r.changed, 14, "the two shipped documents change as well");
  assert.equal(r.examples.length, 5);
  assert.ok(r.examples.every((e) => e.stopsFrom && !e.stopsTo));
});
