// Tally's raw XML->JSON is deeply nested and inconsistent (single items aren't
// arrays, empty tags become "", numeric strings stay strings). This flattens
// it into something predictable to hand back to Claude.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceValue(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (trimmed === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

// Recursively clean: drop attribute-only "@_" keys, unwrap single-key wrappers,
// coerce leaf strings to numbers/null where sensible.
export function cleanTallyResult(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(cleanTallyResult);
  }
  if (isPlainObject(input)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key.startsWith("@_")) continue; // drop XML attributes
      out[key] = cleanTallyResult(value);
    }
    return out;
  }
  return coerceValue(input);
}

// Pulls the list of records out of the DATA/ROW shape produced by
// collection.xml.njk's Report/Form/Part/Line structure, and returns a flat
// array regardless of whether Tally returned 0, 1, or many rows.
export function extractRecords(parsed: unknown): unknown[] {
  const cleaned = cleanTallyResult(parsed) as Record<string, unknown>;
  // Data-type collection exports (buildCollectionXml) return DATA at the
  // response root — Tally does not wrap them in ENVELOPE/BODY the way it
  // does for report/import requests. Check both shapes to be safe.
  const envelope = cleaned?.ENVELOPE as Record<string, unknown> | undefined;
  const body = envelope?.BODY as Record<string, unknown> | undefined;
  const data =
    (cleaned?.DATA as Record<string, unknown> | undefined) ??
    (body?.DATA as Record<string, unknown> | undefined) ??
    body;
  if (!data) return [];

  const records = (data as any)?.ROW;
  if (records === undefined || records === null) return [];
  return Array.isArray(records) ? records : [records];
}
