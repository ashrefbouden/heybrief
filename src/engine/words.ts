// Unicode-aware word matching. JavaScript's \b only knows ASCII letters, so it fails on
// "terminé" (French) and on every Arabic word. These helpers use \p{L} boundaries instead.

const B = '[^\\p{L}\\p{N}_]';

/** Regex matching any of the alternatives as whole words (alternatives are regex source). */
export function words(alternatives: string[], flags = 'iu'): RegExp {
  return new RegExp(`(?:^|${B})(?:${alternatives.join('|')})(?=$|${B})`, flags);
}

/** Same as words() but anchored at the start of the text (after optional spaces). */
export function startsWithWord(alternatives: string[], flags = 'iu'): RegExp {
  return new RegExp(`^\\s*(?:${alternatives.join('|')})(?=$|${B})`, flags);
}
