// This is server only because in general we only run this
// at build time. Not because it is particularly slow to run
// but all the names except the destination labels for predictions
// should be known in advance so there is no need to fix capitalization
// all over the place.
"server only";

// Identifies known acronyms that should be left in all caps
// Use src/build/headsigns.ts to help identify these.
const knownAcronyms = [
  "USM", // University of Southern Maine
  "MMC", // Maine Medical Center
  "JC", // JC Penney
  "CBHS", // Casco Bay High School
  "IDEXX", // IDEXX Laboratories
  "HS", // High School ex. "Deering HS"
  "IB", // Inbound
  "OB", // Outbound
  "SMCC", // Southern Maine Community College
];

/**
 * Capitalizes each word in a string, but also:
 *   - Leaves known acronyms fully uppercase (if matched as its own token).
 */
export function fixCapitalization(input: string): string {
  // 1) Split into tokens (words, punctuation, spaces, etc.)
  //    so that we can process them individually without losing delimiters.
  const tokens = input.split(/(\s+|[^A-Za-z']+)/);
  // Explanation of the split regex:
  //   - (\s+) captures sequences of whitespace separately
  //   - ([^A-Za-z']+) captures sequences of characters that aren't letters or apostrophe
  //     (like punctuation, slashes, numbers, etc.)
  // This keeps words (with possible apostrophes) as separate tokens.

  // 2) Process each token
  const processedTokens = tokens.map((token) => {
    // If this token itself is entirely non-alphabetic (punctuation, slash, etc.),
    // or just whitespace, we leave it alone.
    if (!/[A-Za-z]/.test(token)) {
      return token;
    }

    // Convert to uppercase in case the name is not all capitalized
    //   which it typically is as of writing this. But if they change
    //   their API we don't want this to break.
    const upper = token.toUpperCase();

    // Check if this upercased token is one of the known acronyms
    if (knownAcronyms.includes(upper)) {
      // If it's a known acronym, preserve it in uppercase form
      return upper;
    }

    // Otherwise, do "normal" title-case logic:
    //   Capitalize first character and keep the rest lowercase.
    //   e.g. "forest" => "Forest", "shaw's" => "Shaw's"
    //
    //   Shaw's example used because we previously had an issue where the 's
    //   was capitalized so it was returning Shaw'S. This is fixed by
    //   our splitting regex above.
    return upper.toLowerCase().replace(/\b\w/, (char) => char.toUpperCase());
  });

  // 3) Rebuild the string from tokens
  return processedTokens.join("");
}
