import * as assert from "node:assert";
import { describe, it } from "node:test";
import { LINK_PREVIEW_ROWS, previewLinks } from "../../../board/org/linksPreview";
import type { LinkDoc } from "../../../board/org/linksSignals";

// A document with only the fields the engine reads; the names share no stem or sequence token, so only a phrase links them.
const doc = (path: string, text: string): LinkDoc => ({ project: "p", path, title: path, text });

describe("previewLinks", () => {
  const docs = [doc("docs/alpha.md", "This is blocked by `docs/zulu.md`."), doc("docs/zulu.md", "Nothing here.")];

  it("proposes the link a turned-on phrase reads", () => {
    const found = previewLinks({ docs, existing: [], rejected: [] }, ["blocked by"]);
    assert.strictEqual(found.total, 1);
    assert.strictEqual(found.rows[0].fromPath, "docs/alpha.md");
    assert.strictEqual(found.rows[0].toPath, "docs/zulu.md");
  });

  it("reads the document as a plain mention, not a phrase, when the phrase is turned off", () => {
    // The text still names the other file, so the weaker mention signal proposes it; the phrase signal must not.
    const found = previewLinks({ docs, existing: [], rejected: [] }, ["depends on"]);
    assert.ok(found.rows.every((r) => r.signal === "mention"));
  });

  it("proposes a phrase the draft adds", () => {
    const own = [doc("docs/alpha.md", "Held up by `docs/zulu.md`."), doc("docs/zulu.md", "")];
    assert.strictEqual(previewLinks({ docs: own, existing: [], rejected: [] }, ["held up by"]).total, 1);
  });

  it("leaves out a pair already linked and a pair that was rejected", () => {
    const link = { fromProject: "p", fromPath: "docs/alpha.md", toProject: "p", toPath: "docs/zulu.md" };
    assert.strictEqual(previewLinks({ docs, existing: [link as never], rejected: [] }, ["blocked by"]).total, 0);
    assert.strictEqual(previewLinks({ docs, existing: [], rejected: ["p/docs/alpha.md->p/docs/zulu.md"] }, ["blocked by"]).total, 0);
  });

  it("caps the listed rows but still counts every proposal", () => {
    const many: LinkDoc[] = [doc("docs/target.md", "")];
    for (let i = 0; i < LINK_PREVIEW_ROWS + 3; i += 1) {
      many.push(doc(`docs/w${String.fromCharCode(97 + i)}x.md`, "Blocked by `docs/target.md`."));
    }
    const found = previewLinks({ docs: many, existing: [], rejected: [] }, ["blocked by"]);
    assert.strictEqual(found.rows.length, LINK_PREVIEW_ROWS);
    assert.ok(found.total > LINK_PREVIEW_ROWS);
  });
});
