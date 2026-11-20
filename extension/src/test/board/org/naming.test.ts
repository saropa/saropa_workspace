// Covers group naming: container-folder detection, cleanName (dates, order numbers, kind words, sequence tokens,
// casing, acronyms, custom rules), clipName by code points, displayName per group kind, and dedupNames uniqueness.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACRONYMS, MAX_NAME, NameItem, cleanName, clipName, dedupNames, displayName, isContainerOnly } from "../../../board/org/naming";

test("isContainerOnly: generic folder names are containers, ignoring case and padding", () => {
  assert.equal(isContainerOnly("docs"), true);
  assert.equal(isContainerOnly("  Docs "), true);
  assert.equal(isContainerOnly("misc"), true);
});

test("isContainerOnly: a meaningful or empty name is not a container", () => {
  assert.equal(isContainerOnly("payments"), false);
  assert.equal(isContainerOnly(""), false);
});

test("cleanName: separators become spaces and the result is sentence case", () => {
  assert.equal(cleanName("payment_flow"), "Payment flow");
  assert.equal(cleanName("payment-flow.v"), "Payment flow v");
});

test("cleanName: camel case is split into words", () => {
  assert.equal(cleanName("PaymentFlow"), "Payment flow");
});

test("cleanName: empty and whitespace-only input give an empty name", () => {
  assert.equal(cleanName(""), "");
  assert.equal(cleanName("   "), "");
});

test("cleanName: known acronyms keep their canonical casing, including mixed-case ones", () => {
  assert.equal(cleanName("api_design"), "API design");
  // Without the whole-word check, the camel-case split would break iOS apart.
  assert.equal(cleanName("iOS_release_notes"), "iOS release notes");
  assert.ok(ACRONYMS.includes("iOS"));
});

test("cleanName: a short all-capitals word is kept as written", () => {
  assert.equal(cleanName("NASA_launch"), "NASA launch");
});

test("cleanName: acronyms can be replaced by the caller", () => {
  assert.equal(cleanName("foo_bar", ["FOO"]), "FOO bar");
});

test("cleanName: full dates and bare years are removed", () => {
  assert.equal(cleanName("2024-05-01_auth"), "Auth");
  assert.equal(cleanName("20240501_auth"), "Auth");
  assert.equal(cleanName("auth_2024_notes"), "Auth notes");
});

test("cleanName: dates are kept when the naming rules turn their removal off", () => {
  assert.equal(cleanName("2024-05-01_auth", ACRONYMS, { dates: false }), "2024 05 01 auth");
});

test("cleanName: a leading order number is removed", () => {
  assert.equal(cleanName("01_auth"), "Auth");
});

test("cleanName: version and sequence tokens are removed", () => {
  assert.equal(cleanName("auth_phase_2"), "Auth");
  assert.equal(cleanName("auth_v2"), "Auth");
  assert.equal(cleanName("share_keys_phase_1"), "Share keys");
});

test("cleanName: brackets are dropped", () => {
  assert.equal(cleanName("auth (draft)"), "Auth draft");
});

test("cleanName: leading kind words are dropped but a lone kind word stays", () => {
  assert.equal(cleanName("plan_auth_flow"), "Auth flow");
  // Dropping it would leave an empty name.
  assert.equal(cleanName("plan"), "Plan");
});

test("cleanName: the prefix words dropped can be replaced by the caller", () => {
  assert.equal(cleanName("foo_bar", ACRONYMS, { prefixes: new Set(["foo"]) }), "Bar");
  // "plan" is no longer a prefix once the set is replaced.
  assert.equal(cleanName("plan_x", ACRONYMS, { prefixes: new Set(["foo"]) }), "Plan x");
});

test("clipName: a name within the limit is returned as is", () => {
  assert.equal(clipName("short"), "short");
  assert.equal(clipName("abcde", 5), "abcde");
});

test("clipName: a longer name is cut to the limit with an ellipsis counted inside it", () => {
  assert.equal(clipName("abcdefgh", 5), "abcd…");
  const clipped = clipName("x".repeat(MAX_NAME + 8));
  assert.equal([...clipped].length, MAX_NAME);
  assert.ok(clipped.endsWith("…"));
});

test("clipName: an emoji is never cut in half", () => {
  // Each emoji is two UTF-16 units; slicing by units would leave a lone surrogate.
  assert.equal(clipName("😀".repeat(40), 5), "😀😀😀😀…");
});

// A translator stub that echoes its inputs, so the test checks which key and values displayName picks.
const echo = (key: string, params: Record<string, string | number>): string => `${key}|${JSON.stringify(params)}`;

test("displayName: a plain group shows its name", () => {
  assert.equal(displayName({ name: "Auth", kind: "stem" }, echo), "Auth");
});

test("displayName: a files group reads as touching the file", () => {
  assert.equal(displayName({ name: "x.dart", kind: "files" }, echo), 'releaseBoard.org.name.touches|{"file":"x.dart"}');
});

test("displayName: the Other group uses the root text for an empty folder and the folder text otherwise", () => {
  assert.equal(displayName({ name: "", kind: "other" }, echo), 'releaseBoard.org.name.otherRoot|{"folder":""}');
  assert.equal(displayName({ name: "lib", kind: "other" }, echo), 'releaseBoard.org.name.other|{"folder":"lib"}');
});

test("displayName: a sequence range is appended after a middle dot", () => {
  const out = displayName({ name: "Share keys", kind: "seq", range: { label: "phase", from: 1, to: 4 } }, echo);
  assert.equal(out, 'Share keys · releaseBoard.org.range.phase|{"from":1,"to":4}');
});

const item = (id: string, name: string, kind: string, folder: string, range?: NameItem["range"]): NameItem => ({ id, name, kind, folder, ...(range ? { range } : {}) });

test("dedupNames: unique names are returned unchanged", () => {
  const out = dedupNames([item("a", "Auth", "stem", "x"), item("b", "Billing", "stem", "x")]);
  assert.equal(out.get("a"), "Auth");
  assert.equal(out.get("b"), "Billing");
});

test("dedupNames: no items gives an empty map", () => {
  assert.equal(dedupNames([]).size, 0);
});

test("dedupNames: equal stem names are told apart by the nearest differing parent folder", () => {
  const out = dedupNames([item("a", "Login", "stem", "mobile/app"), item("b", "Login", "stem", "web/app")]);
  // The nearest segment ("app") is the same for both, so the next one out decides.
  assert.equal(out.get("a"), "Login · Mobile");
  assert.equal(out.get("b"), "Login · Web");
});

test("dedupNames: a folder group skips its own last segment when looking for a parent", () => {
  const out = dedupNames([item("a", "Auth", "folder", "docs/billing/auth"), item("b", "Auth", "folder", "docs/search/auth")]);
  assert.equal(out.get("a"), "Auth · Billing");
  assert.equal(out.get("b"), "Auth · Search");
});

test("dedupNames: a clash is decided by the clean function the caller passes", () => {
  const out = dedupNames([item("a", "Auth", "folder", "docs/billing/auth"), item("b", "Auth", "folder", "docs/search/auth")], (s) => s.toUpperCase());
  assert.equal(out.get("a"), "Auth · BILLING");
});

test("dedupNames: a clash with no usable folder gets numbers, the lowest id keeping the plain name", () => {
  // Listed out of order on purpose: the id, not the position, decides who keeps the plain name.
  const out = dedupNames([item("c", "Login", "stem", "x"), item("a", "Login", "stem", "x"), item("b", "Login", "stem", "x")]);
  assert.equal(out.get("a"), "Login");
  assert.equal(out.get("b"), "Login 2");
  assert.equal(out.get("c"), "Login 3");
});

test("dedupNames: a side with no parent folder keeps the plain name while the other is qualified", () => {
  const out = dedupNames([item("a", "Login", "stem", "docs/a"), item("b", "Login", "stem", "")]);
  assert.equal(out.get("a"), "Login · A");
  assert.equal(out.get("b"), "Login");
});

test("dedupNames: a files group and a stem group with the same name do not clash", () => {
  const out = dedupNames([item("a", "Auth", "files", "x"), item("b", "Auth", "stem", "x")]);
  assert.equal(out.get("a"), "Auth");
  assert.equal(out.get("b"), "Auth");
});

test("dedupNames: sequence groups with different ranges do not clash, equal ranges do", () => {
  const r13 = { label: "phase", from: 1, to: 3 };
  const r14 = { label: "phase", from: 1, to: 4 };
  const apart = dedupNames([item("a", "Share", "seq", "x", r13), item("b", "Share", "seq", "y", r14)]);
  assert.equal(apart.get("a"), "Share");
  assert.equal(apart.get("b"), "Share");
  const same = dedupNames([item("a", "Share", "seq", "x", r13), item("b", "Share", "seq", "y", r13)]);
  assert.equal(same.get("a"), "Share · X");
  assert.equal(same.get("b"), "Share · Y");
});
