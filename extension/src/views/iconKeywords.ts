// The full icon-id -> search-keyword map, merged from the two generated data parts.
// Kept as a single exported map (the shape every consumer reads) while the bulk data
// lives in iconKeywordsData1/2.ts so no one file breaches the line cap.
import { ICON_KEYWORDS_PART_1 } from "./iconKeywordsData1";
import { ICON_KEYWORDS_PART_2 } from "./iconKeywordsData2";

// The merged keyword map itself — every codicon id mapped to its space-separated search
// terms, combined from the two data-part files above into the one flat lookup every
// consumer (the Customize icon search, its tests) actually imports.
export const ICON_KEYWORDS: Readonly<Record<string, string>> = {
  ...ICON_KEYWORDS_PART_1,
  ...ICON_KEYWORDS_PART_2,
};
