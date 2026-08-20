import { XMLParser } from "fast-xml-parser";
import { render } from "./templates.js";

const TALLY_URL = process.env.TALLY_URL ?? "http://localhost:9000";

const parser = new XMLParser({ ignoreAttributes: false });

export class TallyConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TallyConnectionError";
  }
}

export async function tallyRequest(xml: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(TALLY_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: xml,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new TallyConnectionError(
        `Tally did not respond within 10s at ${TALLY_URL}. Is it busy or hung?`
      );
    }
    throw new TallyConnectionError(
      `Could not reach TallyPrime at ${TALLY_URL}. Make sure TallyPrime is running and ` +
        `the HTTP gateway is enabled (F1 > Settings > Connectivity).`
    );
  }

  if (!res.ok) {
    throw new TallyConnectionError(`Tally HTTP error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();

  if (!text || text.trim() === "") {
    throw new TallyConnectionError(
      "Tally returned an empty response. This usually means no company is open in TallyPrime."
    );
  }

  const parsed = parser.parse(text) as any;

  // Tally reports request-level errors inside the XML body itself, not via HTTP status.
  const lineError = parsed?.ENVELOPE?.BODY?.DATA?.LINEERROR ?? parsed?.ENVELOPE?.LINEERROR;
  if (lineError) {
    throw new TallyConnectionError(`Tally reported an error: ${lineError}`);
  }

  return parsed;
}

export type CollectionField = {
  name: string;
  // Tally's own SET expression needed to safely serialize non-string field
  // types differs per type (dates/amounts need conversion or they hang the
  // gateway rather than erroring) — default "string" is a plain passthrough.
  datatype?: "string" | "date" | "amount" | "number" | "boolean" | "quantity" | "rate";
  // Overrides the datatype-based SET expression entirely, for fields that need
  // a custom formula (e.g. multi-line ADDRESS needs $$FullList, not a plain $Address).
  expression?: string;
};

export type CollectionFilter = {
  name: string;
  // Raw Tally formula expression, e.g. "$IsRevenue" or '$$IsEqual:$Parent:"Stock-in-Hand"'.
  expression: string;
};

export function buildCollectionXml(
  type: string,
  fields: CollectionField[],
  filters?: CollectionFilter[],
  dateRange?: { fromDate: string; toDate: string }
): string {
  return render("collection.xml.njk", {
    type,
    fields,
    filters: filters ?? [],
    fromDate: dateRange?.fromDate,
    toDate: dateRange?.toDate,
  });
}
