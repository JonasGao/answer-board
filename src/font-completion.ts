export type FontToken = {
  start: number;
  end: number;
  leading: string;
  trailing: string;
  query: string;
};

function isQuote(value: string): boolean {
  return value === "'" || value === '"';
}

function commaPositions(value: string): number[] {
  const positions: number[] = [];
  let quote = "";
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (isQuote(char)) {
      if (quote === char && value[i - 1] !== "\\") quote = "";
      else if (!quote) quote = char;
    } else if (char === "," && !quote) positions.push(i);
  }
  return positions;
}

export function activeFontToken(value: string, cursor: number): FontToken {
  const commas = commaPositions(value);
  const previousPositions = commas.filter((position) => position < cursor);
  const previous = previousPositions[previousPositions.length - 1];
  const next = commas.find((position) => position >= cursor);
  const start = (previous ?? -1) + 1;
  const end = next ?? value.length;
  const raw = value.slice(start, end);
  const leading = raw.match(/^\s*/)?.[0] ?? "";
  const trailing = raw.match(/\s*$/)?.[0] ?? "";
  let query = raw.slice(leading.length, raw.length - trailing.length);
  if (query.length >= 2 && isQuote(query[0]) && query[query.length - 1] === query[0]) {
    query = query.slice(1, -1);
  } else if (isQuote(query[0])) {
    query = query.slice(1);
  }
  return { start, end, leading, trailing, query };
}

export function filterFontFamilies(
  families: string[],
  query: string,
  limit = 8,
): string[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length < 2) return [];
  return families
    .filter((family) => family.toLocaleLowerCase().startsWith(normalized))
    .slice(0, limit);
}

function quoteFamily(family: string): string {
  const trimmed = family.trim();
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function replaceFontToken(
  value: string,
  token: FontToken,
  family: string,
): { value: string; cursor: number } {
  const replacement = `${token.leading}${quoteFamily(family)}${token.trailing}`;
  const nextValue = value.slice(0, token.start) + replacement + value.slice(token.end);
  return {
    value: nextValue,
    cursor: token.start + token.leading.length + quoteFamily(family).length,
  };
}
