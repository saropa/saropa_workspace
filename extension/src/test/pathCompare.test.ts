// Unit tests for the case-sensitivity-aware path comparison helpers
// (utils/pathCompare.ts). The helpers probe the local filesystem on first call
// to determine case-sensitivity (not just process.platform), so the casing-
// specific assertions are gated on the actual probe result via
// isCaseInsensitiveFS(). On Windows (NTFS) and default-config macOS (HFS+/APFS),
// the probe returns true; on Linux or case-sensitive APFS, it returns false.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCaseInsensitiveFS,
  isPathWithinBase,
  pathEquals,
  relativeToBase,
  relativeToBaseLoose,
} from "../utils/pathCompare";

// --- Platform-independent behavior tests ---

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

test("isCaseInsensitiveFS returns a boolean", () => {
  // Smoke check: the probe should run and return a stable boolean.
  const result = isCaseInsensitiveFS();
  assert.equal(typeof result, "boolean");
  // The result must be stable (cached after first probe).
  assert.equal(isCaseInsensitiveFS(), result);
});

// --- Case-sensitivity-dependent tests, gated on the actual filesystem probe ---

if (isCaseInsensitiveFS()) {
  // Case-insensitive FS (Windows NTFS, macOS HFS+/APFS-default).
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
    assert.equal(isPathWithinBase(fullLower, base, sep), true);
  });

  test("case-insensitive: relativeToBase strips differently-cased base, keeps file casing", () => {
    assert.equal(relativeToBase(fullMixed, base, sep), sep + "File.ts");
  });

  test("case-insensitive: relativeToBaseLoose is also case-insensitive", () => {
    const expected = process.platform === "win32" ? "\\File.ts" : "/File.ts";
    assert.equal(relativeToBaseLoose(fullMixed, base), expected);
  });

  test("case-insensitive: pathEquals matches paths differing only in casing", () => {
    assert.equal(pathEquals(base, baseLower), true);
  });

  test("case-insensitive: pathEquals rejects genuinely different paths", () => {
    assert.equal(pathEquals(base, other), false);
  });
} else {
  // Case-sensitive FS (Linux ext4/btrfs, macOS case-sensitive APFS).
  test("case-sensitive: isPathWithinBase is case-sensitive", () => {
    assert.equal(isPathWithinBase("/src/Proj/file.ts", "/src/proj", "/"), false);
  });

  test("case-sensitive: pathEquals is case-sensitive", () => {
    assert.equal(pathEquals("/src/Proj", "/src/proj"), false);
  });
}
