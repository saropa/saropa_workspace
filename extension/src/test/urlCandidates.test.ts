// Unit tests for the URL-candidate mapper (recipes/urlCandidates.ts). Only the pure
// urlCandidatesFromRecipes is exercised here — it takes RecipeResults and touches no
// extension host, so it runs under Node's built-in runner with the vscode stub (see
// esbuild.test.js). detectUrlCandidates itself reads the fs via the recipe detectors
// and is covered by the detector tests; this file pins the map + dedup contract.

import { test } from "node:test";
import assert from "node:assert/strict";
import { urlCandidatesFromRecipes } from "../recipes/urlCandidates";
import { RecipeResult } from "../recipes/detectors";

// A url-action recipe result with the fields the mapper reads.
function urlRecipe(recipeId: string, label: string, target: string, icon?: string): RecipeResult {
  return {
    recipeId,
    label,
    description: `detected from ${recipeId}`,
    icon,
    action: { kind: "url", url: target },
  };
}

test("maps url recipes to candidates carrying label, url, description, and icon", () => {
  const out = urlCandidatesFromRecipes([
    urlRecipe("github.home", "Open repo", "https://h/o/r", "github"),
  ]);
  assert.deepEqual(out, [
    {
      label: "Open repo",
      url: "https://h/o/r",
      description: "detected from github.home",
      icon: "github",
    },
  ]);
});

test("drops duplicate hrefs, keeping the first label seen", () => {
  // The same URL can arise from two sources (a homepage equal to the repo web base,
  // or the same remote across two folders); the picker must show it once.
  const out = urlCandidatesFromRecipes([
    urlRecipe("github.home", "Open repo", "https://h/o/r"),
    urlRecipe("deployed", "Open the deployed site", "https://h/o/r"),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Open repo");
});

test("empty input yields an empty list; omitted description/icon pass through as undefined", () => {
  assert.deepEqual(urlCandidatesFromRecipes([]), []);
  const out = urlCandidatesFromRecipes([
    { recipeId: "bare", label: "Bare", action: { kind: "url", url: "https://x" } },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].description, undefined);
  assert.equal(out[0].icon, undefined);
});

test("skips results that are not url actions or carry no href", () => {
  const results: RecipeResult[] = [
    { recipeId: "shell", label: "Run tests", action: { kind: "shell", shellCommand: "npm test" } },
    { recipeId: "urlless", label: "Bad", action: { kind: "url" } },
    { recipeId: "file", label: "A file", filePath: "a.ts" },
    urlRecipe("issues", "Open Issues", "https://h/o/r/issues"),
  ];
  const out = urlCandidatesFromRecipes(results);
  assert.deepEqual(out.map((c) => c.url), ["https://h/o/r/issues"]);
});
