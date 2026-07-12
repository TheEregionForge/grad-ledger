export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeForComparison(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

export function stableBlockKey(value: string): string {
  return normalizeForComparison(value);
}

export function stripHonorific(name: string): { name: string; honorific?: string } {
  let cleaned = normalizeWhitespace(name);
  const honorifics: string[] = [];
  let match = cleaned.match(/^(prof\.?|professor|dr\.?|doctor)\s+/i);

  while (match) {
    honorifics.push(match[1].replace(/\.$/, ""));
    cleaned = normalizeWhitespace(cleaned.slice(match[0].length));
    match = cleaned.match(/^(prof\.?|professor|dr\.?|doctor)\s+/i);
  }

  return {
    honorific: honorifics[0],
    name: cleaned
  };
}

export function toCsvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
