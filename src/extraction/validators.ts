import { normalizeWhitespace, stripHonorific } from "../shared/normalization";

const negativeNameWords = /(department|university|faculty|research|home|contact|admissions|publications|laboratory|school|college)/i;

export function looksLikePersonName(value: string): boolean {
  const name = stripHonorific(value).name;
  const tokens = name.split(/\s+/).filter(Boolean);

  return tokens.length >= 2 && tokens.length <= 5 && !negativeNameWords.test(name) && /^[\p{L}'.-]+(\s+[\p{L}'.-]+)+$/u.test(name);
}

export function normalizePersonName(value: string): string {
  const stripped = stripHonorific(value).name;
  const commaMatch = stripped.match(/^([\p{L}'-]+),\s+(.+)$/u);
  if (commaMatch) {
    return normalizeWhitespace(`${commaMatch[2]} ${commaMatch[1]}`);
  }

  return normalizeWhitespace(stripped);
}

export function isLikelyUniversity(value: string): boolean {
  return /\b(university|college|institute|school|université|universitat|hochschule|kaist|dgist|unist|postech|epfl|eth zurich)\b/i.test(value);
}

export function isAcademicTitle(value: string, titles: string[]): string | null {
  const lowered = value.toLowerCase();
  return titles.find((title) => lowered.includes(title.toLowerCase())) ?? null;
}
