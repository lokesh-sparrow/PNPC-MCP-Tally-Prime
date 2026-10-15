const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function build(day: number, month: number, year: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${pad(day)}-${pad(month)}-${year}`;
}

function fullYear(y: string): number {
  return y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
}

// Turns the date spellings callers actually send into the DD-MM-YYYY every
// tool expects. Day-first is assumed for all-numeric dates (DD/MM/YYYY), the
// convention in India and the UAE. Returns null when the text isn't a real date.
export function normalizeDate(input: string): string | null {
  const s = input.trim();
  let m: RegExpExecArray | null;

  // 31-03-2026, 31/03/2026, 31.03.2026, 1-4-26
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(s);
  if (m) return build(parseInt(m[1], 10), parseInt(m[2], 10), fullYear(m[3]));

  // 2026-03-31, 2026/03/31 (also an ISO timestamp — the time part is dropped)
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return build(parseInt(m[3], 10), parseInt(m[2], 10), parseInt(m[1], 10));

  // 31-Mar-2026, 31 Mar 2026, 31 March 26, 31-Mar-26
  m = /^(\d{1,2})[-\s/.]+([A-Za-z]{3,9})[-\s/.,]+(\d{4}|\d{2})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return build(parseInt(m[1], 10), month, fullYear(m[3]));
  }

  // March 31, 2026 / Mar 31 2026
  m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return build(parseInt(m[2], 10), month, parseInt(m[3], 10));
  }

  return null;
}

type Schema = {
  type?: string;
  description?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
};

// Walks a tool's input schema alongside the arguments it was called with and
// rewrites every date field (any string property whose description says
// DD-MM-YYYY) into that format. A value that can't be read as a date fails
// here with a plain message, instead of reaching Tally as garbage.
export function normalizeDateArgs<T>(schema: Schema | undefined, value: T, path = ""): T {
  if (!schema || value === null || value === undefined) return value;

  if (schema.type === "array" && Array.isArray(value)) {
    return value.map((item, i) => normalizeDateArgs(schema.items, item, `${path}[${i}]`)) as unknown as T;
  }

  if (schema.type === "object" && schema.properties && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in out) out[key] = normalizeDateArgs(sub, out[key], path ? `${path}.${key}` : key);
    }
    return out as T;
  }

  if (schema.type === "string" && typeof value === "string" && schema.description?.includes("DD-MM-YYYY")) {
    if (value.trim() === "") return value;
    const fixed = normalizeDate(value);
    if (!fixed) {
      throw new Error(
        `'${path}' is '${value}', which isn't a valid date. Use DD-MM-YYYY, e.g. 31-03-2026 ` +
          `(31/03/2026, 2026-03-31 and 31-Mar-2026 are also accepted).`
      );
    }
    return fixed as unknown as T;
  }

  return value;
}
