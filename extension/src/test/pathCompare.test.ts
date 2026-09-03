// Unit tests for the case-sensitivity-aware path comparison helpers
// (utils/pathCompare.ts). Added for the fix to shortcutStoreBase.ts's
// toFolderRelative, which used a raw fsPath.startsWith and could fail to
// recognize a file as inside its workspace folder when the two Uris disagreed
// on casing (a case-insensitive filesystem allows that on Windows and macOS).
// The isPathWithinBase/relativeToBase behavior is platform-dependent by design
// (case-insensitive on win32 and darwin, case-sensitive on Linux), so the
// casing-specific assertions are gated on process.platform, matching the pattern
// already used in processRegistry.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPathWithinBase, pathEquals, relativeToBase, relativeToBaseLoose } from "../utils/pathCompare";

test("isPathWithinBase matches the base path itself", () => {
  assert.equal(isPathWithinBase("/proj", "/proj", "/"), true);
});

test("isPathWithinBase matches a descendant separated by the boundary", () => {
  assert.equal(isPathWithinBase("/proj/src/a.ts", "/proj", "/"), true);
});

test("isPathWithinBase rejects a sibling whose name merely starts with base", () => {
  // Without the separator-boundary check, base "/proj" would wrongly match
  // "/project2" — a bare startsWith bug distinct from the casing one.
  assert.equal(isPathWithinBase("/project2/a.ts", "/proj", "/"), false);
});

test("isPathWithinBase rejects an unrelated path", () => {
  assert.equal(isPathWithinBase("/other/a.ts", "/proj", "/"), false);
});

test("relativeToBase strips the base and preserves original casing", () => {
  assert.equal(relativeToBase("/proj/src/A.ts", "/proj", "/"), "/src/A.ts");
});

test("relativeToBase returns the input unchanged when not under base", () => {
  assert.equal(relativeToBase("/other/a.ts", "/proj", "/"), "/other/a.ts");
});

test("relativeToBaseLoose strips the base without requiring a separator boundary", () => {
  // Used by toFolderRelative, where `uri` is always composed by joining onto
  // `base` (Uri.joinPath), so a sibling-folder false match cannot occur and a
  // mixed-separator boundary check would only misfire.
  assert.equal(relativeToBaseLoose("/proj/src/a.ts", "/proj"), "/src/a.ts");
});

test("relativeToBaseLoose returns the input unchanged when not a prefix", () => {
  assert.equal(relativeToBaseLoose("/other/a.ts", "/proj"), "/other/a.ts");
});

// Case-insensitive platforms: Windows (NTFS) and macOS (HFS+/APFS-default).
// Linux (ext4/btrfs) is case-sensitive. The pathCompare helpers normalize casing
// on win32 and darwin only, so the casing assertions must match the platform.
const isCaseInsensitive =
  process.platform === "win32" || process.platform === "darwin";

if (isCaseInsensitive) {
  // Use platform-correct separators and path shapes in test data so the same
  // assertions work on both Windows CI and macOS CI.
  const sep = process.platform === "win32" ? "\\" : "/";
  const base = process.platform === "win32" ? "D:\\Src\\Proj" : "/Src/Proj";
  const fullLower =
    process.platform === "win32"
      ? "d:\\src\\proj\\file.ts"
      : "/src/proj/file.ts";
  const fullMixed =
    process.platform === "win32"
      ? "d:\\src\\proj\\File.ts"
      : "/src/proj/File.ts";
  const other = process.platform === "win32" ? "D:\\Src\\Other" : "/Src/Other";
  const baseLower =
    process.platform === "win32" ? "d:\\src\\proj" : "/src/proj";

  test("case-insensitive: isPathWithinBase ignores casing differences", () => {
    // A workspace folder and a resolved file can disagree on casing — both
    // NTFS (Windows) and HFS+/APFS (macOS) allow this.
    assert.equal(isPathWithinBase(fullLower, base, sep), true);
  });

  test("case-insensitive: relativeToBase strips a differently-cased base but keeps the file's own casing", () => {
    // The comparison ignores case, but the returned remainder is sliced from
    // fullPath — so "File.ts" is never lowercased to "file.ts" for display.
    assert.equal(relativeToBase(fullMixed, base, sep), sep + "File.ts");
  });

  test("case-insensitive: relativeToBaseLoose is also case-insensitive", () => {
    // Same casing tolerance as relativeToBase, without the separator-boundary
    // requirement — this is the variant toFolderRelative actually uses.
    const expected = process.platform === "win32" ? "\\File.ts" : "/File.ts";
    assert.equal(relativeToBaseLoose(fullMixed, base), expected);
  });

  test("case-insensitive: pathEquals matches paths that differ only in casing", () => {
    // walkUp's stop-directory check needs this to recognize the workspace folder
    // root even when dirname resolution and the Uri casing disagree.
    assert.equal(pathEquals(base, baseLower), true);
  });

  test("case-insensitive: pathEquals rejects genuinely different paths", () => {
    assert.equal(pathEquals(base, other), false);
  });
} else {
  test("posix: isPathWithinBase is case-sensitive", () => {
    assert.equal(isPathWithinBase("/src/Proj/file.ts", "/src/proj", "/"), false);
  });

  test("posix: pathEquals is case-sensitive", () => {
    assert.equal(pathEquals("/src/Proj", "/src/proj"), false);
  });
}
