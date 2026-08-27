#!/usr/bin/env python3
"""Convert an .xlsx workbook's first sheet to plain-text CSV on stdout.

Zero third-party dependencies — only the Python standard library (zipfile,
xml.etree.ElementTree). An .xlsx file is a zip archive of XML parts; this
reads xl/worksheets/sheet1.xml (the first sheet) and xl/sharedStrings.xml
(the shared string table most text cells reference by index rather than
storing inline) and reassembles them into rows.

Usage:
    python xlsx_to_csv.py <file.xlsx> [--sheet N]

Limitations, by design (read these before trusting the output):

- Legacy .xls (the old binary Excel format, pre-2007) is NOT supported —
  it isn't a zip archive at all, so this script fails on it outright with
  a clear error rather than producing garbage. Ask for an .xlsx re-save,
  or a CSV export, instead.
- Cell values are read RAW, with no access to Excel's display formatting.
  A date cell is really stored as a serial day-count number (e.g. 45852
  for 14-07-2026, counting from 30-12-1899) and prints as that number —
  not as a date string. A percentage is stored as a decimal fraction
  (e.g. 0.05 for "5%"). Any column that looks like a suspiciously large
  or small integer next to a header word like "Date", "Rate", or "%"
  should be treated as a formatted value and either converted (see the
  EXCEL_EPOCH note below) or cross-checked against the source document —
  never posted to Tally at face value.
- Only the FIRST sheet is converted by default. Pass --sheet 2 (1-indexed)
  for a different one; sheet order is read from xl/workbook.xml.
- Merged cells, formulas' cached values, and formatting are not
  distinguished from plain values — a formula cell's last-calculated
  result is emitted like any other value (Excel stores that alongside the
  formula itself), which is what you want for a bank statement export.
"""

from __future__ import annotations

import csv
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

# Excel's day-zero. A date-formatted cell's raw numeric value is the count
# of days since this date (with a historical off-by-one leap-year quirk
# Excel deliberately kept for backward compatibility with Lotus 1-2-3 —
# irrelevant for any date after 01-03-1900, which covers every real use
# of this script).
EXCEL_EPOCH_NOTE = "30-12-1899 — see this script's own docstring before treating a raw integer as a date"


def col_letters_to_index(cell_ref: str) -> int:
    """'C7' -> 2 (0-indexed column). Used to pad rows so columns line up
    even when a row has empty trailing/leading cells that Excel omits
    entirely rather than storing as blank."""
    letters = re.match(r"[A-Z]+", cell_ref).group(0)
    index = 0
    for ch in letters:
        index = index * 26 + (ord(ch) - ord("A") + 1)
    return index - 1


def load_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings = []
    for si in root.findall("m:si", NS):
        # A shared string can be a single <t>, or multiple <r><t>...</t></r>
        # runs (rich text with mixed formatting) — concatenate all text
        # regardless of which shape this particular entry uses.
        text_parts = [t.text or "" for t in si.iter("{%s}t" % NS["m"])]
        strings.append("".join(text_parts))
    return strings


def load_sheet_path(zf: zipfile.ZipFile, sheet_number: int) -> str:
    """Resolves the Nth sheet (1-indexed) to its actual worksheet XML path
    via xl/workbook.xml + xl/_rels/workbook.xml.rels — sheet1.xml isn't
    guaranteed to be the first sheet in display order once a workbook has
    been reordered/renamed in Excel."""
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    sheets = workbook.findall(".//m:sheets/m:sheet", NS)
    if sheet_number < 1 or sheet_number > len(sheets):
        raise ValueError(f"Workbook has {len(sheets)} sheet(s); sheet {sheet_number} doesn't exist.")
    target = sheets[sheet_number - 1]
    rid = target.get("{%s}id" % NS["r"])

    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    for rel in rels:
        if rel.get("Id") == rid:
            target_path = rel.get("Target")
            # Relationship targets come in two equally-legal shapes depending on
            # the writer: relative to xl/ (e.g. "worksheets/sheet1.xml", most
            # common) or absolute-style from the archive root (e.g.
            # "/xl/worksheets/sheet1.xml" — confirmed live from openpyxl).
            # startswith("xl/") alone misses the second shape, since it starts
            # with "/xl/" (leading slash), not "xl/" — strip a leading slash
            # first so both normalize to a path relative to the zip root.
            if target_path.startswith("/"):
                return target_path.lstrip("/")
            return "xl/" + target_path
    raise ValueError(f"Could not resolve sheet {sheet_number}'s relationship id '{rid}'.")


def parse_sheet(zf: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> list[list[str]]:
    root = ET.fromstring(zf.read(sheet_path))
    rows_out: list[list[str]] = []
    for row in root.findall(".//m:sheetData/m:row", NS):
        row_cells: dict[int, str] = {}
        max_col = -1
        for cell in row.findall("m:c", NS):
            ref = cell.get("r", "")
            col_idx = col_letters_to_index(ref) if ref else max_col + 1
            max_col = max(max_col, col_idx)
            cell_type = cell.get("t")
            value_el = cell.find("m:v", NS)
            if cell_type == "s" and value_el is not None:
                idx = int(value_el.text)
                row_cells[col_idx] = shared_strings[idx] if idx < len(shared_strings) else ""
            elif cell_type == "inlineStr":
                is_el = cell.find("m:is", NS)
                text = "".join(t.text or "" for t in (is_el.iter("{%s}t" % NS["m"]) if is_el is not None else []))
                row_cells[col_idx] = text
            elif value_el is not None:
                row_cells[col_idx] = value_el.text or ""
            else:
                row_cells[col_idx] = ""
        rows_out.append([row_cells.get(i, "") for i in range(max_col + 1)])
    return rows_out


def main() -> None:
    args = sys.argv[1:]
    # Confirmed live on Windows (this connector's only supported platform,
    # since TallyPrime itself is Windows-only): the default console encoding
    # is not UTF-8, so an em-dash in this script's own messages — or, more
    # importantly, a non-ASCII party/ledger name from a real document (e.g.
    # an Arabic name on a UAE client's invoice) flowing through stdout as
    # CSV — silently turns into "?"/mojibake instead of erroring. Force
    # UTF-8 explicitly rather than relying on the environment's default.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0 if args else 1)

    path = args[0]
    sheet_number = 1
    if "--sheet" in args:
        sheet_number = int(args[args.index("--sheet") + 1])

    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        print(
            f"'{path}' isn't a valid .xlsx file (not a zip archive). If this is a legacy "
            f".xls file, this script doesn't support that format - re-save as .xlsx or "
            f"export as CSV instead.",
            file=sys.stderr,
        )
        sys.exit(1)

    with zf:
        shared_strings = load_shared_strings(zf)
        sheet_path = load_sheet_path(zf, sheet_number)
        rows = parse_sheet(zf, sheet_path, shared_strings)

    writer = csv.writer(sys.stdout)
    for row in rows:
        writer.writerow(row)

    print(
        f"# {len(rows)} row(s) from sheet {sheet_number} of '{path}'. Raw cell values only - "
        f"see this script's docstring on date/percentage columns before trusting them "
        f"(Excel epoch: {EXCEL_EPOCH_NOTE}).",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
