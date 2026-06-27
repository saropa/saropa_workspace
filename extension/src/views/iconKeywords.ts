// The full icon-id -> search-keyword map, merged from the two generated data parts.
// Kept as a single exported map (the shape every consumer reads) while the bulk data
// lives in iconKeywordsData1/2.ts so no one file breaches the line cap.
import { ICON_KEYWORDS_PART_1 } from "./iconKeywordsData1";
import { ICON_KEYWORDS_PART_2 } from "./iconKeywordsData2";

export const ICON_KEYWORDS: Readonly<Record<string, string>> = {
  ...ICON_KEYWORDS_PART_1,
  ...ICON_KEYWORDS_PART_2,
};
