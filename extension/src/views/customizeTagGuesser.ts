// Content-based tag guesser for the Customize panel. Tokenizes file content,
// filters stop words (grammar, pronouns, generic programming keywords), scores
// by frequency weighted toward longer words, and returns the top candidates.

const STOP_WORDS = new Set([
  "the", "and", "but", "for", "nor", "yet", "not",
  "this", "that", "these", "those", "with", "from", "into", "through",
  "during", "before", "after", "above", "below", "between", "out", "off",
  "over", "under", "about", "than", "also", "just", "only", "own", "same",
  "more", "most", "other", "some", "such", "very", "each", "every", "both",
  "few", "all", "any", "now", "then", "here", "there", "when", "where",
  "why", "how", "who", "whom", "which", "what", "too",
  "you", "your", "yours", "his", "her", "hers", "its", "our", "ours",
  "they", "them", "their", "theirs", "mine", "she", "him",
  "are", "was", "were", "been", "being", "have", "has", "had", "having",
  "does", "did", "doing", "done", "will", "would", "could", "should",
  "can", "may", "might", "shall", "must", "get", "got", "gets",
  "make", "made", "makes", "let", "set", "use", "used",
  "while", "else",
  "var", "let", "const", "function", "return", "import", "export", "default",
  "class", "new", "null", "undefined", "true", "false", "void",
  "type", "interface", "extends", "implements", "static", "public", "private",
  "def", "self", "none", "print", "pass", "lambda", "yield", "raise",
  "try", "except", "catch", "finally", "throw", "throws", "elif", "assert",
  "async", "await", "super", "abstract", "final", "override",
  "case", "switch", "break", "continue", "delete", "typeof", "instanceof",
  "enum", "struct", "package", "protected", "readonly", "declare",
]);

export function guessTagsFromContent(content: string, max = 6): string[] {
  // Split camelCase/PascalCase into separate words before lowercasing
  const expanded = content
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  const words = expanded.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  if (words.length === 0) {
    return [];
  }

  const freq = new Map<string, number>();
  for (const w of words) {
    if (STOP_WORDS.has(w)) {
      continue;
    }
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  return Array.from(freq.entries())
    .map(([word, count]) => ({ word, score: count * Math.sqrt(word.length) }))
    .filter((e) => e.score > 1.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((e) => e.word);
}
