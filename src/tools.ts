import { tallyRequest, buildCollectionXml, TallyConnectionError, TALLY_URL } from "./tally.js";
import { cleanTallyResult, extractRecords } from "./clean.js";
import { render } from "./templates.js";
import { syncAll, syncVouchers, syncVoucherItems, runSql, cacheProfitAndLoss, cacheStockSummary, cacheBalanceSheet, cacheTrialBalance, cacheVatSummary, cacheGstSummary } from "./db.js";
import { readAuditLog, summarizeAuditLog, auditLogPath } from "./audit.js";
import { getPermissionStatus } from "./permissions.js";

export const tools = [
  {
    name: "get_ledgers",
    description: "Get all ledgers (accounts) from TallyPrime",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_stock_items",
    description: "Get all stock items from TallyPrime",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_vouchers",
    description:
      "Get vouchers (Day Book) from TallyPrime filtered by date range. Returns a flat array of rows (guid, date, " +
      "voucher_type, voucher_number, party_ledger, amount, narration) — headers only, no stock item or ledger " +
      "line detail (use get_ledger_vouchers or query_sql for that). Rebuilt on the same Voucher collection query " +
      "sync_vouchers_to_sql already uses: an earlier version called Tally's canned 'Day Book' report directly, " +
      "which was confirmed live to silently ignore the date range entirely (returning the same fixed set " +
      "regardless of what was requested, even for a year before the company's books start) — this version " +
      "correctly scopes to the requested range.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date in DD-MM-YYYY format" },
        to: { type: "string", description: "End date in DD-MM-YYYY format" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_company_info",
    description: "Get the currently open company info from TallyPrime",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_profit_and_loss",
    description: "Get the Profit & Loss statement from TallyPrime for a date range",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date in DD-MM-YYYY format" },
        to: { type: "string", description: "End date in DD-MM-YYYY format" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_balance_sheet",
    description: "Get the Balance Sheet from TallyPrime as of a given date",
    inputSchema: {
      type: "object",
      properties: {
        asOf: { type: "string", description: "As-of date in DD-MM-YYYY format" },
      },
      required: ["asOf"],
    },
  },
  {
    name: "get_trial_balance",
    description: "Get the Trial Balance from TallyPrime for a date range",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date in DD-MM-YYYY format" },
        to: { type: "string", description: "End date in DD-MM-YYYY format" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_groups",
    description: "Get all account groups (e.g. Sundry Debtors, Fixed Assets) from TallyPrime",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_voucher_types",
    description: "Get all voucher types configured in TallyPrime (e.g. Payment, Sales, Journal)",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_cost_centres",
    description: "Get all cost centres from TallyPrime",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_stock_summary",
    description: "Get the Stock Summary report from TallyPrime as of a given date",
    inputSchema: {
      type: "object",
      properties: {
        asOf: { type: "string", description: "As-of date in DD-MM-YYYY format" },
      },
      required: ["asOf"],
    },
  },
  {
    name: "get_bills_receivable",
    description: "Get outstanding Bills Receivable from TallyPrime as of a given date",
    inputSchema: {
      type: "object",
      properties: {
        asOf: { type: "string", description: "As-of date in DD-MM-YYYY format" },
      },
      required: ["asOf"],
    },
  },
  {
    name: "get_bills_payable",
    description: "Get outstanding Bills Payable from TallyPrime as of a given date",
    inputSchema: {
      type: "object",
      properties: {
        asOf: { type: "string", description: "As-of date in DD-MM-YYYY format" },
      },
      required: ["asOf"],
    },
  },
  {
    name: "get_cash_flow",
    description:
      "Get the Cash Flow statement from TallyPrime for a date range — Tally's own canned report, reachable " +
      "directly via a plain Export Data request (confirmed live, unlike the VAT/GST return reports). Returns " +
      "Tally's native monthly-period breakdown shape (DSPPERIOD/DSPACCINFO arrays) as-is.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, DD-MM-YYYY" },
        to: { type: "string", description: "End date, DD-MM-YYYY" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_funds_flow",
    description:
      "Get the Funds Flow statement from TallyPrime for a date range — Tally's own canned report, reachable " +
      "directly via a plain Export Data request. Returns Tally's native monthly-period breakdown shape as-is.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, DD-MM-YYYY" },
        to: { type: "string", description: "End date, DD-MM-YYYY" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_ratio_analysis",
    description:
      "Get the Ratio Analysis report from TallyPrime for a date range (Working Capital, Current Ratio, Quick " +
      "Ratio, Inventory Turnover, Debtors/Creditors Turnover, and similar standard ratios) — Tally's own canned " +
      "report, reachable directly via a plain Export Data request. Returns Tally's native RATIONAME/value array " +
      "shape as-is.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, DD-MM-YYYY" },
        to: { type: "string", description: "End date, DD-MM-YYYY" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_sales_register",
    description:
      "Get the Sales Register from TallyPrime for a date range — a month-by-month summary of Sales voucher " +
      "activity, Tally's own canned report reachable directly via a plain Export Data request. For individual " +
      "Sales voucher line detail (not just monthly totals), use get_vouchers or get_ledger_vouchers instead.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, DD-MM-YYYY" },
        to: { type: "string", description: "End date, DD-MM-YYYY" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_purchase_register",
    description:
      "Get the Purchase Register from TallyPrime for a date range — a month-by-month summary of Purchase " +
      "voucher activity, same design as get_sales_register.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, DD-MM-YYYY" },
        to: { type: "string", description: "End date, DD-MM-YYYY" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_journal_register",
    description:
      "Get the Journal Register from TallyPrime for a date range — a month-by-month summary of Journal voucher " +
      "activity, same design as get_sales_register.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, DD-MM-YYYY" },
        to: { type: "string", description: "End date, DD-MM-YYYY" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_payment_register",
    description:
      "Get the Payment Register from TallyPrime for a date range — a month-by-month summary of Payment voucher " +
      "activity, same design as get_sales_register. For Receipt vouchers specifically, use " +
      "get_receipts_and_payments instead — Tally has no separate standalone 'Receipt Register' report reachable " +
      "this way (confirmed live: 'Could not find Report').",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, DD-MM-YYYY" },
        to: { type: "string", description: "End date, DD-MM-YYYY" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_receipts_and_payments",
    description:
      "Get the Receipts and Payments report from TallyPrime for a date range — a cash/bank-ledger-wise view " +
      "combining Receipt and Payment activity, Tally's own canned report. This is the closest reachable " +
      "equivalent to a standalone Cash Book/Bank Book — Tally's actual 'Cash Book'/'Bank Book' menu reports are " +
      "not reachable via a plain Export Data request (confirmed live: 'Could not find Report'), even though " +
      "they're registered report names — for a single cash or bank ledger's own transaction history instead, " +
      "use get_ledger_vouchers with that ledger's name.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, DD-MM-YYYY" },
        to: { type: "string", description: "End date, DD-MM-YYYY" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_reorder_status",
    description:
      "Get the Reorder Status report from TallyPrime for a date range — stock items with a reorder level " +
      "configured, and where their current quantity stands against it (closingStock, onPurchaseOrder, " +
      "onSaleOrder, reorderLevel, shortfall, minimumQty, requiredQty per row). Tally's own report returns every " +
      "stock item regardless of reorder setup (confirmed live: a 10,770-item company with no reorder levels " +
      "configured returned a ~1.4MB all-null dump) — this tool filters that down to only rows that actually have " +
      "a reorder level set, since that's the only subset the report can say anything useful about. An empty " +
      "rows array with a note means no items have a reorder level configured at all, not an error — use " +
      "get_stock_summary for a plain quantity view of every item regardless of reorder setup.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, DD-MM-YYYY" },
        to: { type: "string", description: "End date, DD-MM-YYYY" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_vat_liability_summary",
    description:
      "Get a UAE VAT liability summary for a date range. Each row is a VAT ledger with its closing balance for " +
      "the period, classified as input/output/rcm/other — 'rcm' (reverse charge) is kept separate from plain " +
      "input/output because reverse-charge liability is the thing that's easily missed manually, even though it " +
      "nets to a wash for most businesses — tagged with how it was found — 'structural' (Tally's own " +
      "Type-of-duty/tax field is set to VAT on that ledger) or 'name_pattern' (matched Input/Output/Payable/" +
      "Receivable VAT naming). Both signals are used together, not one alone — confirmed live on real company " +
      "data that Tally's structural tag is precise but has near-zero recall: every properly-tagged ledger had a " +
      "zero balance, while the ledgers actually carrying real money were created without that tag set at all. " +
      "Not filtered by any particular parent group — real companies were confirmed to scatter these ledgers " +
      "across many different groups, not one standard group. netTotal sums all rows using Tally's own debit/" +
      "credit sign convention. Not Tally's canned VAT return report (confirmed live it isn't reachable via a " +
      "plain Export Data request) — reconstructed from ledger balances the same way get_profit_and_loss is. If " +
      "no matching ledgers exist, returns an explicit note instead of a bare zero — a company with no VAT " +
      "ledgers (not registered, or unrecognizable naming) is a different fact from a real zero liability period.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, DD-MM-YYYY" },
        to: { type: "string", description: "End date, DD-MM-YYYY" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_gst_liability_summary",
    description:
      "Get an India GST liability summary for a date range. Same design as get_vat_liability_summary — each row " +
      "is a GST ledger (CGST/SGST/IGST, input/output/payable/receivable/RCM) with its closing balance for the " +
      "period, classified as input/output/rcm/other ('rcm' kept separate from input/output — reverse-charge " +
      "liability is the thing that's easily missed manually), tagged 'structural' (Tally's Type-of-duty/tax field = GST) or " +
      "'name_pattern' (matched Input/Output CGST/SGST/IGST or GST Payable/Receivable/RCM naming) — both signals " +
      "used together for the same reason: confirmed live that Tally's structural tag alone misses every ledger " +
      "with real activity in a real company file. Deliberately excludes generic expense ledgers that merely " +
      "mention GST in their name (a freight ledger, a GST write-off/ineligible-ITC ledger) — those aren't tax " +
      "liability lines and including them would misstate the position. netTotal sums all rows using Tally's own " +
      "debit/credit sign convention. Not a canned GSTR export — reconstructed from ledger balances. If no " +
      "matching ledgers exist, returns an explicit note instead of a bare zero.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, DD-MM-YYYY" },
        to: { type: "string", description: "End date, DD-MM-YYYY" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_ledger_vouchers",
    description: "Get all voucher entries posted to a specific ledger within a date range",
    inputSchema: {
      type: "object",
      properties: {
        ledgerName: { type: "string", description: "Exact ledger name" },
        from: { type: "string", description: "Start date in DD-MM-YYYY format" },
        to: { type: "string", description: "End date in DD-MM-YYYY format" },
      },
      required: ["ledgerName", "from", "to"],
    },
  },
  {
    name: "create_ledger",
    description:
      "Create a new ledger (account) in TallyPrime, or rename/update an existing one by passing oldName",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the new ledger, or the new name when renaming an existing one" },
        oldName: {
          type: "string",
          description:
            "Exact name of an existing ledger to alter/rename (optional). If provided, updates that ledger instead of creating a new one — pass the same value as 'name' to update parent/opening balance without renaming.",
        },
        parent: {
          type: "string",
          description: "Parent group, e.g. 'Sundry Debtors', 'Sundry Creditors', 'Bank Accounts'",
        },
        openingBalance: {
          type: "number",
          description: "Opening balance (optional, defaults to 0)",
        },
        maintainBillWise: {
          type: "boolean",
          description:
            "Enable bill-wise tracking on this ledger (required for create_voucher's Agst Ref / New Ref bill allocation to work). Almost always wanted for Sundry Debtors/Creditors party ledgers. Defaults to false/off.",
        },
        trn: {
          type: "string",
          description: "Tax Registration Number (UAE VAT TRN) for this party ledger, e.g. '100326595400003'.",
        },
        email: { type: "string", description: "Contact email for this ledger." },
        website: { type: "string", description: "Website for this ledger." },
        phone: { type: "string", description: "Landline phone number for this ledger." },
        mobile: { type: "string", description: "Mobile number for this ledger." },
        billCreditPeriod: { type: "number", description: "Credit period in days for bill-wise settlement." },
        creditLimit: {
          type: "number",
          description: "Credit limit amount for this party ledger. Setting this also enables 'override credit limit' so the limit actually takes effect.",
        },
        address: {
          type: "array",
          items: { type: "string" },
          description: "Mailing address, one line per array entry (e.g. ['Office 12, Port Saeed', 'Deira']).",
        },
        state: {
          type: "string",
          description:
            "State/Emirate, e.g. 'Dubai'. Plain free text — Tally does not validate this against a master list, so match this company's existing convention (check get_company_info or an existing ledger) rather than a formal name.",
        },
        country: {
          type: "string",
          description:
            "Country, e.g. 'UAE'. Plain free text — Tally does not validate or normalize this (e.g. 'United Arab Emirates' is stored literally, not converted to 'UAE'), so match this company's existing convention (check get_company_info or an existing ledger) instead of guessing a formal name.",
        },
        pincode: { type: "string", description: "Postal/PIN code (optional — omit for countries that don't use one)." },
        mailingName: { type: "string", description: "Mailing name for the address, if different from the ledger name." },
        addressApplicableFrom: {
          type: "string",
          description:
            "Date in DD-MM-YYYY format from which this address is effective. Required by Tally for the address to actually persist (it's a date-versioned list internally) — defaults to today if any address field is set and this is omitted.",
        },
        extraFields: {
          type: "object",
          description:
            "Escape hatch for any other native Tally ledger field not covered above — pass exact Tally XML tag names as keys (e.g. {'LEDGERCONTACT': 'Ahmed'}). Not validated; use exact Tally field names from a master export.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["name", "parent"],
    },
  },
  {
    name: "delete_master",
    description:
      "Delete one or more masters (ledger, group, stock item, voucher type, unit, godown, cost centre, etc.) from TallyPrime by name. " +
      "If a master was used in a voucher you're also deleting, delete the voucher first and confirm it succeeded before calling this — " +
      "doing both in the same parallel batch can race (the master delete reaching Tally before the voucher delete has committed), " +
      "confirmed live. If a ledger/stock item was used in both a Sales AND a Purchase item-invoice, it may return 'Cannot be deleted!' " +
      "permanently even with no transactions left — this is fixed by running Company Data → Rewrite in Tally itself (confirmed live), " +
      "not by retrying or sequencing.",
    inputSchema: {
      type: "object",
      properties: {
        collection: {
          type: "string",
          description:
            "Type of master to delete, as Tally's XML tag name, e.g. 'LEDGER', 'GROUP', 'STOCKITEM', 'VOUCHERTYPE', 'UNIT', 'GODOWN', 'COSTCATEGORY', 'COSTCENTRE'",
        },
        names: {
          type: "array",
          items: { type: "string" },
          description: "Exact name(s) of the master(s) to delete",
        },
      },
      required: ["collection", "names"],
    },
  },
  {
    name: "set_company",
    description:
      "Switch TallyPrime's active company context. Changes which company subsequent tool calls and reports operate on — validate the name with get_ledgers/get_company_info or the company list first",
    inputSchema: {
      type: "object",
      properties: {
        companyName: { type: "string", description: "Exact name of the company to make active, as it appears in Tally" },
      },
      required: ["companyName"],
    },
  },
  {
    name: "set_period",
    description:
      "Switch TallyPrime's active reporting period. Changes the global from/to date context used by Tally for subsequent report queries until changed again",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date in DD-MM-YYYY format" },
        to: { type: "string", description: "End date in DD-MM-YYYY format" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "create_voucher",
    description:
      "Create a new voucher (e.g. Payment, Receipt, Sales, Purchase, Journal) in TallyPrime. " +
      "Either pass debitLedger/creditLedger/amount for a simple 2-leg voucher, or pass 'entries' " +
      "for a voucher with 3+ lines (e.g. one payment split across several expense ledgers).",
    inputSchema: {
      type: "object",
      properties: {
        voucherType: {
          type: "string",
          description: "Voucher type, e.g. 'Payment', 'Receipt', 'Sales', 'Purchase', 'Journal'",
        },
        date: { type: "string", description: "Voucher date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        debitLedger: { type: "string", description: "Ledger name to debit (simple 2-leg mode; omit if using 'entries')" },
        creditLedger: { type: "string", description: "Ledger name to credit (simple 2-leg mode; omit if using 'entries')" },
        amount: { type: "number", description: "Amount of the transaction (simple 2-leg mode; omit if using 'entries')" },
        debitBillName: {
          type: "string",
          description:
            "Bill reference name to allocate the debit leg against, e.g. for a Payment settling a Purchase bill. Omit for vouchers with no bill-wise tracking.",
        },
        debitBillType: {
          type: "string",
          description:
            "'New Ref' to open a new bill (e.g. a Purchase/Sales invoice), or 'Agst Ref' to settle an existing one by its exact bill reference name (e.g. a Payment/Receipt against a prior invoice). Also accepts 'Advance' or 'On Account'. Defaults to 'New Ref' if debitBillName is set.",
        },
        creditBillName: { type: "string", description: "Same as debitBillName, for the credit leg." },
        creditBillType: { type: "string", description: "Same as debitBillType, for the credit leg." },
        debitCostCentre: { type: "string", description: "Cost centre to allocate the debit leg to (optional)." },
        creditCostCentre: { type: "string", description: "Cost centre to allocate the credit leg to (optional)." },
        costCategory: {
          type: "string",
          description: "Cost category the cost centre belongs to. Defaults to 'Primary Cost Category'.",
        },
        entries: {
          type: "array",
          description:
            "For a voucher with more than 2 lines (e.g. one payment covering three expense ledgers): an array of " +
            "{ ledgerName, amount, type: 'debit'|'credit', billName?, billType?, costCentre?, costCategory? }. " +
            "Debit and credit amounts must sum to the same total (Tally's double-entry rule) or the call fails " +
            "with a clear error before reaching Tally. When provided, this replaces debitLedger/creditLedger/amount entirely.",
          items: {
            type: "object",
            properties: {
              ledgerName: { type: "string" },
              amount: { type: "number" },
              type: { type: "string", enum: ["debit", "credit"] },
              billName: { type: "string" },
              billType: { type: "string" },
              costCentre: { type: "string" },
              costCategory: { type: "string" },
            },
            required: ["ledgerName", "amount", "type"],
          },
        },
      },
      required: ["voucherType", "date"],
    },
  },
  {
    name: "create_stock_journal",
    description:
      "Create a Stock Journal voucher in TallyPrime, moving inventory from one or more source stock items to " +
      "one or more destination stock items (transfer, manufacturing-style conversion with multiple raw materials " +
      "consumed and/or multiple finished/by-products produced, etc). Inventory-only — no ledger entries.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Voucher date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        sources: {
          type: "array",
          description: "One or more stock items being consumed/issued.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item being consumed" },
              qty: { type: "number", description: "Quantity consumed" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this line is issued from (optional)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
        destinations: {
          type: "array",
          description: "One or more stock items being produced/received.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item being produced" },
              qty: { type: "number", description: "Quantity produced" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this line is received into (optional)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
        additionalCosts: {
          type: "array",
          description:
            "Optional additional costs (labour, freight, overhead, etc) incurred in production, posted through " +
            "an expense ledger and folded into the value of the destination item(s) rather than left as a " +
            "separate P&L line.",
          items: {
            type: "object",
            properties: {
              ledgerName: { type: "string", description: "Exact name of the expense ledger to post this cost to" },
              amount: { type: "number", description: "Cost amount" },
              allocationType: {
                type: "string",
                enum: ["Appropriate by Value", "Appropriate by Quantity", "Not Applicable"],
                description:
                  "How to apportion this cost across multiple destination items. Default: 'Appropriate by Value'.",
              },
            },
            required: ["ledgerName", "amount"],
          },
        },
        voucherNumber: {
          type: "string",
          description: "Explicit voucher number. Normally omit and let Tally auto-number.",
        },
        voucherType: {
          type: "string",
          description:
            "Voucher type to post against. Defaults to 'Stock Journal'. Pass the name of a voucher type " +
            "created via create_voucher_type with useAsManufacturingJournal to post as a real Manufacturing " +
            "Journal instead — same underlying voucher shape either way.",
        },
      },
      required: ["date", "sources", "destinations"],
    },
  },
  {
    name: "update_stock_journal",
    description:
      "Update an existing Stock Journal voucher in TallyPrime, replacing its source/destination lines and " +
      "narration. Same fields as create_stock_journal, plus voucherNumber. Matched by date + voucher number — use " +
      "get_ledger_vouchers or get_vouchers first to confirm it exists and is unique. Refuses if another voucher " +
      "type shares the same number on that date (confirmed live: Tally's Alter lookup ignores voucher type and can " +
      "silently corrupt the wrong one) — resolve the collision in Tally first if that happens.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing voucher's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the stock journal to update" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        sources: {
          type: "array",
          description: "One or more stock items being consumed/issued.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item being consumed" },
              qty: { type: "number", description: "Quantity consumed" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this line is issued from (optional)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
        destinations: {
          type: "array",
          description: "One or more stock items being produced/received.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item being produced" },
              qty: { type: "number", description: "Quantity produced" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this line is received into (optional)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
        additionalCosts: {
          type: "array",
          description:
            "Optional additional costs (labour, freight, overhead, etc) incurred in production, posted through " +
            "an expense ledger and folded into the value of the destination item(s) rather than left as a " +
            "separate P&L line.",
          items: {
            type: "object",
            properties: {
              ledgerName: { type: "string", description: "Exact name of the expense ledger to post this cost to" },
              amount: { type: "number", description: "Cost amount" },
              allocationType: {
                type: "string",
                enum: ["Appropriate by Value", "Appropriate by Quantity", "Not Applicable"],
                description:
                  "How to apportion this cost across multiple destination items. Default: 'Appropriate by Value'.",
              },
            },
            required: ["ledgerName", "amount"],
          },
        },
        voucherType: {
          type: "string",
          description:
            "Voucher type of the existing voucher. Defaults to 'Stock Journal' — must match the type it was " +
            "originally created with (e.g. a custom Manufacturing Journal type), or the lookup will not find it.",
        },
      },
      required: ["date", "voucherNumber", "sources", "destinations"],
    },
  },
  {
    name: "create_material_in",
    description:
      "Create a Material In voucher in TallyPrime — records stock received back from a job worker (or any party " +
      "holding your material for processing), tracked against that party's ledger without a real accounting " +
      "posting (this is Tally's job-work memorandum tracking, not a purchase). Uses Tally's native 'Multi " +
      "Consumption Voucher View' shape. EXTRAPOLATED from a genuine Tally-exported XML template for this exact " +
      "voucher type, not verified against a real manually-created example in this project — verify carefully " +
      "after use, especially on a company with godown/batch tracking enabled (pass godown on every item).",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Voucher date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        partyLedger: { type: "string", description: "Exact name of the job worker/party ledger this material is being received from" },
        items: {
          type: "array",
          description: "One or more stock items being received.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item received" },
              qty: { type: "number", description: "Quantity received" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this is received into (optional, but required if the company has location tracking enabled)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
        voucherNumber: { type: "string", description: "Explicit voucher number. Normally omit and let Tally auto-number." },
      },
      required: ["date", "partyLedger", "items"],
    },
  },
  {
    name: "update_material_in",
    description:
      "Update an existing Material In voucher in TallyPrime, replacing its item lines and narration. Same fields " +
      "as create_material_in, plus voucherNumber. Matched by date + voucher number — use get_ledger_vouchers or " +
      "get_vouchers first to confirm it exists and is unique. Refuses if another voucher type shares the same " +
      "number on that date (confirmed live: Tally's Alter lookup ignores voucher type and can silently corrupt " +
      "the wrong one) — resolve the collision in Tally first if that happens.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing voucher's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the voucher to update" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        partyLedger: { type: "string", description: "Exact name of the job worker/party ledger this material is being received from" },
        items: {
          type: "array",
          description: "One or more stock items being received — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item received" },
              qty: { type: "number", description: "Quantity received" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this is received into (optional, but required if the company has location tracking enabled)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
      },
      required: ["date", "voucherNumber", "partyLedger", "items"],
    },
  },
  {
    name: "create_material_out",
    description:
      "Create a Material Out voucher in TallyPrime — records stock sent out to a job worker for processing, " +
      "tracked against that party's ledger without a real accounting posting (job-work memorandum tracking, not " +
      "a sale). Mirror of create_material_in. Same EXTRAPOLATED caveat and godown requirement apply.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Voucher date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        partyLedger: { type: "string", description: "Exact name of the job worker/party ledger this material is being sent to" },
        items: {
          type: "array",
          description: "One or more stock items being sent out.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item sent out" },
              qty: { type: "number", description: "Quantity sent" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this is issued from (optional, but required if the company has location tracking enabled)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
        voucherNumber: { type: "string", description: "Explicit voucher number. Normally omit and let Tally auto-number." },
      },
      required: ["date", "partyLedger", "items"],
    },
  },
  {
    name: "update_material_out",
    description:
      "Update an existing Material Out voucher in TallyPrime, replacing its item lines and narration. Same fields " +
      "as create_material_out, plus voucherNumber. Same matching/collision caveats as update_material_in.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing voucher's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the voucher to update" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        partyLedger: { type: "string", description: "Exact name of the job worker/party ledger this material is being sent to" },
        items: {
          type: "array",
          description: "One or more stock items being sent out — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item sent out" },
              qty: { type: "number", description: "Quantity sent" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this is issued from (optional, but required if the company has location tracking enabled)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
      },
      required: ["date", "voucherNumber", "partyLedger", "items"],
    },
  },
  {
    name: "create_rejections_in",
    description:
      "Create a Rejections In voucher in TallyPrime — records goods rejected and returned to you (e.g. by a " +
      "customer or a job worker returning defective components). Inventory movement only, same shape as a " +
      "Sales/Purchase item line but with no party ledger. EXTRAPOLATED: no confirmed real-world XML example was " +
      "available for this exact voucher type — built by analogy to Tally's other inventory-only voucher shapes " +
      "(Physical Stock). Verify carefully after use, and expect to need godown on every item if the company has " +
      "location tracking enabled.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Voucher date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        items: {
          type: "array",
          description: "One or more stock items being received back as rejected.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity received" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this is received into (optional, but required if the company has location tracking enabled)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
        voucherNumber: { type: "string", description: "Explicit voucher number. Normally omit and let Tally auto-number." },
      },
      required: ["date", "items"],
    },
  },
  {
    name: "update_rejections_in",
    description:
      "Update an existing Rejections In voucher in TallyPrime, replacing its item lines and narration. Same " +
      "fields as create_rejections_in, plus voucherNumber. Same matching/collision caveats as update_material_in.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing voucher's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the voucher to update" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        items: {
          type: "array",
          description: "One or more stock items being received back as rejected — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity received" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this is received into (optional, but required if the company has location tracking enabled)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
      },
      required: ["date", "voucherNumber", "items"],
    },
  },
  {
    name: "create_rejections_out",
    description:
      "Create a Rejections Out voucher in TallyPrime — records goods you're rejecting and returning outward " +
      "(e.g. back to a supplier, or components you're sending back to a job worker as defective). Mirror of " +
      "create_rejections_in. Same EXTRAPOLATED caveat and godown requirement apply.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Voucher date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        items: {
          type: "array",
          description: "One or more stock items being sent out as rejected.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity sent" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this is issued from (optional, but required if the company has location tracking enabled)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
        voucherNumber: { type: "string", description: "Explicit voucher number. Normally omit and let Tally auto-number." },
      },
      required: ["date", "items"],
    },
  },
  {
    name: "update_rejections_out",
    description:
      "Update an existing Rejections Out voucher in TallyPrime, replacing its item lines and narration. Same " +
      "fields as create_rejections_out, plus voucherNumber. Same matching/collision caveats as update_material_in.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing voucher's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the voucher to update" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        items: {
          type: "array",
          description: "One or more stock items being sent out as rejected — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity sent" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos'" },
              godown: { type: "string", description: "Godown this is issued from (optional, but required if the company has location tracking enabled)" },
              batchName: { type: "string", description: "Batch name (optional, defaults to 'Primary Batch')" },
            },
            required: ["stockItem", "qty", "rate", "unit"],
          },
        },
      },
      required: ["date", "voucherNumber", "items"],
    },
  },
  {
    name: "create_physical_stock",
    description:
      "Create a Physical Stock voucher in TallyPrime — records a physical count and updates the stock item's " +
      "book quantity to match it (that's the point of the voucher). Confirmed live against a real Tally-exported " +
      "XML template (uses DIFFACTUALQTY=Yes at voucher level, not a per-line flag) after an earlier version of " +
      "this tool was found to corrupt the closing balance to a nonsensical negative number — fixed and " +
      "re-verified: counting 95 of an item that had 100 correctly closed the item at 95. It does not post any " +
      "monetary/ledger write-off for the resulting shortage or excess value — do that separately with " +
      "create_voucher if needed.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Physical count date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description" },
        items: {
          type: "array",
          description: "One entry per counted stock item.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item counted" },
              actualQty: { type: "number", description: "Actual counted quantity" },
              unit: { type: "string" },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Defaults to 'Primary Batch' if the item is batch-tracked." },
            },
            required: ["stockItem", "actualQty", "unit"],
          },
        },
        voucherNumber: {
          type: "string",
          description:
            "Explicit voucher number. Normally omit and let Tally auto-number — but some Tally configurations stop " +
            "auto-numbering certain voucher types via the XML gateway (confirmed live for item-invoice types). If " +
            "creation fails with a blank EXCEPTIONS:1, check get_vouchers for the highest existing number of this " +
            "voucher type and retry with voucherNumber set to the next one.",
        },
      },
      required: ["date", "items"],
    },
  },
  {
    name: "update_physical_stock",
    description:
      "Update an existing Physical Stock voucher in TallyPrime, replacing its counted item lines and narration. " +
      "Same fields as create_physical_stock, plus voucherNumber. Matched by date + voucher number — use " +
      "get_ledger_vouchers or get_vouchers first to confirm it exists and is unique. Refuses if another voucher " +
      "type shares the same number on that date (confirmed live: Tally's Alter lookup ignores voucher type and can " +
      "silently corrupt the wrong one) — resolve the collision in Tally first if that happens.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing voucher's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the physical stock voucher to update" },
        narration: { type: "string", description: "Narration / description" },
        items: {
          type: "array",
          description: "One entry per counted stock item — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item counted" },
              actualQty: { type: "number", description: "Actual counted quantity" },
              unit: { type: "string" },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Defaults to 'Primary Batch' if the item is batch-tracked." },
            },
            required: ["stockItem", "actualQty", "unit"],
          },
        },
      },
      required: ["date", "voucherNumber", "items"],
    },
  },
  {
    name: "create_sales_invoice",
    description:
      "Create an item-invoice Sales voucher in TallyPrime — a real invoice with stock item lines (quantity, rate), " +
      "each posted to its own Sales ledger, plus one optional VAT/tax line on the total. Distinct from create_voucher, " +
      "which only supports plain ledger-to-ledger entries with no stock items. WARNING (confirmed live): if the same " +
      "party ledger or stock item is used in BOTH a Sales and a Purchase item-invoice, it can become undeletable via " +
      "the API afterward (returns 'Cannot be deleted!' even with zero balance) — using it in only one of the two is " +
      "fine and stays deletable. If it does happen, running Company Data → Rewrite in Tally itself clears it " +
      "(confirmed live) — this is not a permanent lock.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Invoice date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description for the invoice" },
        partyLedger: { type: "string", description: "Customer ledger name (the party being invoiced)" },
        items: {
          type: "array",
          description: "One entry per invoice line.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos' — must match the stock item's unit" },
              salesLedger: { type: "string", description: "Sales ledger this line's amount is posted to, e.g. 'Sales Accounts'" },
              godown: {
                type: "string",
                description:
                  "Godown for this line. Only skip this if the company has no multi-godown tracking at all — if it does, " +
                  "omitting this fails silently (CREATED:0, EXCEPTIONS:1, no error text) even though everything else is valid. " +
                  "Confirmed by live testing. Check get_company_info or an existing invoice first if unsure.",
              },
              batchName: { type: "string", description: "Real batch/lot number for this line, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount (e.g. 10 for 10% off). Optional." },
              vatLedger: { type: "string", description: "Per-item VAT ledger override, if this line has a different tax rate than the invoice default. Requires vatRatePercent." },
              vatRatePercent: { type: "number", description: "Per-item VAT rate override, e.g. 5. Required if this item's vatLedger is set." },
            },
            required: ["stockItem", "qty", "rate", "unit", "salesLedger"],
          },
        },
        vatLedger: { type: "string", description: "Default VAT/tax ledger applied to any item that doesn't set its own vatLedger (optional — omit for a fully non-taxable invoice)." },
        vatRatePercent: { type: "number", description: "Default VAT rate as a percentage, e.g. 5. Required if vatLedger is set. Items with mixed rates can override this per-line." },
        billName: {
          type: "string",
          description: "Bill reference name for bill-wise tracking (requires the party ledger's maintainBillWise to be on). Omit if not using bill-wise tracking.",
        },
        billType: { type: "string", description: "Defaults to 'New Ref'." },
        voucherNumber: {
          type: "string",
          description:
            "Explicit voucher number. Normally omit this and let Tally auto-number — but some Tally configurations " +
            "(confirmed live: after a Company Data → Rewrite in at least one case) stop auto-numbering item-invoice " +
            "vouchers via the XML gateway and fail with a blank EXCEPTIONS:1/no error text unless a number is given " +
            "explicitly. If a create call fails with no error text, check get_vouchers for the highest existing " +
            "number of this voucher type and retry with voucherNumber set to the next one.",
        },
      },
      required: ["date", "partyLedger", "items"],
    },
  },
  {
    name: "update_sales_invoice",
    description:
      "Update an existing item-invoice Sales voucher in TallyPrime, replacing its item lines, party, and narration. " +
      "Same fields as create_sales_invoice, plus voucherNumber. Matched by date + voucher number — use " +
      "get_ledger_vouchers or get_vouchers first to confirm it exists and is unique. Refuses if another voucher " +
      "type shares the same number on that date (confirmed live: Tally's Alter lookup ignores voucher type and can " +
      "silently corrupt the wrong one) — resolve the collision in Tally first if that happens.",
    inputSchema: {
      type: "object",
      properties: {
        voucherNumber: { type: "string", description: "Exact voucher number of the invoice to update" },
        date: { type: "string", description: "Existing invoice's date in DD-MM-YYYY format" },
        narration: { type: "string", description: "New narration / description for the invoice" },
        partyLedger: { type: "string", description: "Customer ledger name (the party being invoiced)" },
        items: {
          type: "array",
          description: "One entry per invoice line — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string" },
              qty: { type: "number" },
              rate: { type: "number" },
              unit: { type: "string" },
              salesLedger: { type: "string" },
              godown: { type: "string" },
              batchName: { type: "string" },
              discountPercent: { type: "number" },
              vatLedger: { type: "string" },
              vatRatePercent: { type: "number" },
            },
            required: ["stockItem", "qty", "rate", "unit", "salesLedger"],
          },
        },
        vatLedger: { type: "string", description: "Default VAT ledger for items without their own override." },
        vatRatePercent: { type: "number", description: "Default VAT rate. Required if vatLedger is set." },
        billName: { type: "string" },
        billType: { type: "string" },
      },
      required: ["voucherNumber", "date", "partyLedger", "items"],
    },
  },
  {
    name: "create_purchase_invoice",
    description:
      "Create an item-invoice Purchase voucher in TallyPrime — mirror of create_sales_invoice for the buying side. " +
      "A real invoice with stock item lines (quantity, rate), each posted to its own Purchase ledger, plus one " +
      "optional VAT/tax line on the total. WARNING (confirmed live, same as create_sales_invoice): if the same party " +
      "ledger or stock item is used in BOTH a Sales and a Purchase item-invoice, it can become undeletable via the " +
      "API afterward — using it in only one of the two is fine and stays deletable. If it does happen, running " +
      "Company Data → Rewrite in Tally itself clears it (confirmed live) — this is not a permanent lock.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Invoice date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description for the invoice" },
        partyLedger: { type: "string", description: "Supplier ledger name (the party being paid)" },
        items: {
          type: "array",
          description: "One entry per invoice line.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure, e.g. 'Nos' — must match the stock item's unit" },
              purchaseLedger: { type: "string", description: "Purchase ledger this line's amount is posted to, e.g. 'Purchase Accounts'" },
              godown: {
                type: "string",
                description:
                  "Godown for this line. Only skip this if the company has no multi-godown tracking at all — if it does, " +
                  "omitting this fails silently (CREATED:0, EXCEPTIONS:1, no error text) even though everything else is valid. " +
                  "Confirmed by live testing. Check get_company_info or an existing invoice first if unsure.",
              },
              batchName: { type: "string", description: "Real batch/lot number for this line, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount (e.g. 10 for 10% off). Optional." },
              vatLedger: { type: "string", description: "Per-item VAT ledger override, if this line has a different tax rate than the invoice default. Requires vatRatePercent." },
              vatRatePercent: { type: "number", description: "Per-item VAT rate override, e.g. 5. Required if this item's vatLedger is set." },
            },
            required: ["stockItem", "qty", "rate", "unit", "purchaseLedger"],
          },
        },
        vatLedger: { type: "string", description: "Default Input VAT ledger applied to any item that doesn't set its own vatLedger (optional — omit for a fully non-taxable invoice)." },
        vatRatePercent: { type: "number", description: "Default VAT rate as a percentage, e.g. 5. Required if vatLedger is set. Items with mixed rates can override this per-line." },
        billName: {
          type: "string",
          description: "Bill reference name for bill-wise tracking (requires the party ledger's maintainBillWise to be on). Omit if not using bill-wise tracking.",
        },
        billType: { type: "string", description: "Defaults to 'New Ref'." },
        voucherNumber: {
          type: "string",
          description:
            "Explicit voucher number. Normally omit this and let Tally auto-number — but some Tally configurations " +
            "(confirmed live: after a Company Data → Rewrite in at least one case) stop auto-numbering item-invoice " +
            "vouchers via the XML gateway and fail with a blank EXCEPTIONS:1/no error text unless a number is given " +
            "explicitly. If a create call fails with no error text, check get_vouchers for the highest existing " +
            "number of this voucher type and retry with voucherNumber set to the next one.",
        },
      },
      required: ["date", "partyLedger", "items"],
    },
  },
  {
    name: "update_purchase_invoice",
    description:
      "Update an existing item-invoice Purchase voucher in TallyPrime, replacing its item lines, party, and " +
      "narration. Same fields as create_purchase_invoice, plus voucherNumber. Matched by date + voucher number — " +
      "use get_ledger_vouchers or get_vouchers first to confirm it exists and is unique. Refuses if another voucher " +
      "type shares the same number on that date (confirmed live: Tally's Alter lookup ignores voucher type and can " +
      "silently corrupt the wrong one) — resolve the collision in Tally first if that happens.",
    inputSchema: {
      type: "object",
      properties: {
        voucherNumber: { type: "string", description: "Exact voucher number of the invoice to update" },
        date: { type: "string", description: "Existing invoice's date in DD-MM-YYYY format" },
        narration: { type: "string", description: "New narration / description for the invoice" },
        partyLedger: { type: "string", description: "Supplier ledger name (the party being paid)" },
        items: {
          type: "array",
          description: "One entry per invoice line — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string" },
              qty: { type: "number" },
              rate: { type: "number" },
              unit: { type: "string" },
              purchaseLedger: { type: "string" },
              godown: { type: "string" },
              batchName: { type: "string" },
              discountPercent: { type: "number" },
              vatLedger: { type: "string" },
              vatRatePercent: { type: "number" },
            },
            required: ["stockItem", "qty", "rate", "unit", "purchaseLedger"],
          },
        },
        vatLedger: { type: "string", description: "Default VAT ledger for items without their own override." },
        vatRatePercent: { type: "number", description: "Default VAT rate. Required if vatLedger is set." },
        billName: { type: "string" },
        billType: { type: "string" },
      },
      required: ["voucherNumber", "date", "partyLedger", "items"],
    },
  },
  {
    name: "create_credit_note",
    description:
      "Create an item-invoice Credit Note in TallyPrime — a Sales return, reversing stock and revenue for returned " +
      "items. Same shape as create_sales_invoice but with the debit/credit convention flipped, matching Purchase's " +
      "sign pattern (a Credit Note is structurally a reverse Sales entry). Confirmed live on a real company: " +
      "returning 5 units correctly increased the item's book quantity by exactly 5. Same godown and dual-role " +
      "deletion caveats as create_sales_invoice apply.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Credit note date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Customer ledger name (the party being credited)" },
        items: {
          type: "array",
          description: "One entry per returned line.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item being returned" },
              qty: { type: "number", description: "Quantity returned" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string" },
              salesLedger: { type: "string", description: "Sales/Sales Returns ledger this line is reversed against, e.g. the same ledger used on the original invoice" },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking (same silent-fail behavior as create_sales_invoice)." },
              batchName: { type: "string" },
              discountPercent: { type: "number" },
              vatLedger: { type: "string" },
              vatRatePercent: { type: "number" },
            },
            required: ["stockItem", "qty", "rate", "unit", "salesLedger"],
          },
        },
        vatLedger: { type: "string", description: "Default VAT ledger for items without their own override." },
        vatRatePercent: { type: "number", description: "Default VAT rate. Required if vatLedger is set." },
        billName: { type: "string", description: "Bill reference to settle against, e.g. the original invoice's bill name. Defaults to 'Agst Ref' billType." },
        billType: { type: "string", description: "Defaults to 'Agst Ref' — settling against the original invoice's bill, unlike create_sales_invoice's 'New Ref' default." },
        voucherNumber: {
          type: "string",
          description:
            "Explicit voucher number. Normally omit and let Tally auto-number — but some Tally configurations stop " +
            "auto-numbering item-invoice vouchers via the XML gateway (confirmed live). If creation fails with a " +
            "blank EXCEPTIONS:1, check get_vouchers for the highest existing number of this voucher type and retry " +
            "with voucherNumber set to the next one.",
        },
      },
      required: ["date", "partyLedger", "items"],
    },
  },
  {
    name: "update_credit_note",
    description:
      "Update an existing item-invoice Credit Note in TallyPrime, replacing its item lines, party, and narration. " +
      "Same fields as create_credit_note, plus voucherNumber. Matched by date + voucher number — use " +
      "get_ledger_vouchers or get_vouchers first to confirm it exists and is unique. Refuses if another voucher " +
      "type shares the same number on that date (confirmed live: Tally's Alter lookup ignores voucher type and can " +
      "silently corrupt the wrong one) — resolve the collision in Tally first if that happens.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing credit note's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the credit note to update" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Customer ledger name (the party being credited)" },
        items: {
          type: "array",
          description: "One entry per returned line — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item being returned" },
              qty: { type: "number", description: "Quantity returned" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string" },
              salesLedger: { type: "string", description: "Sales/Sales Returns ledger this line is reversed against, e.g. the same ledger used on the original invoice" },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking (same silent-fail behavior as create_sales_invoice)." },
              batchName: { type: "string" },
              discountPercent: { type: "number" },
              vatLedger: { type: "string" },
              vatRatePercent: { type: "number" },
            },
            required: ["stockItem", "qty", "rate", "unit", "salesLedger"],
          },
        },
        vatLedger: { type: "string", description: "Default VAT ledger for items without their own override." },
        vatRatePercent: { type: "number", description: "Default VAT rate. Required if vatLedger is set." },
        billName: { type: "string", description: "Bill reference to settle against, e.g. the original invoice's bill name. Defaults to 'Agst Ref' billType." },
        billType: { type: "string", description: "Defaults to 'Agst Ref' — settling against the original invoice's bill, unlike create_sales_invoice's 'New Ref' default." },
      },
      required: ["date", "voucherNumber", "partyLedger", "items"],
    },
  },
  {
    name: "create_debit_note",
    description:
      "Create an item-invoice Debit Note in TallyPrime — a Purchase return, reversing stock and expense for " +
      "returned items. Same shape as create_purchase_invoice but with the debit/credit convention flipped, " +
      "matching Sales's sign pattern (a Debit Note is structurally a reverse Purchase entry). Confirmed live on a " +
      "real company: returning 3 units correctly decreased the item's book quantity by exactly 3. Same godown " +
      "and dual-role deletion caveats as create_purchase_invoice apply.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Debit note date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Supplier ledger name (the party being debited)" },
        items: {
          type: "array",
          description: "One entry per returned line.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item being returned" },
              qty: { type: "number", description: "Quantity returned" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string" },
              purchaseLedger: { type: "string", description: "Purchase/Purchase Returns ledger this line is reversed against" },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking (same silent-fail behavior as create_purchase_invoice)." },
              batchName: { type: "string" },
              discountPercent: { type: "number" },
              vatLedger: { type: "string" },
              vatRatePercent: { type: "number" },
            },
            required: ["stockItem", "qty", "rate", "unit", "purchaseLedger"],
          },
        },
        vatLedger: { type: "string", description: "Default VAT ledger for items without their own override." },
        vatRatePercent: { type: "number", description: "Default VAT rate. Required if vatLedger is set." },
        billName: { type: "string", description: "Bill reference to settle against, e.g. the original bill's name. Defaults to 'Agst Ref' billType." },
        billType: { type: "string", description: "Defaults to 'Agst Ref' — settling against the original purchase's bill, unlike create_purchase_invoice's 'New Ref' default." },
        voucherNumber: {
          type: "string",
          description:
            "Explicit voucher number. Normally omit and let Tally auto-number — but some Tally configurations stop " +
            "auto-numbering item-invoice vouchers via the XML gateway (confirmed live). If creation fails with a " +
            "blank EXCEPTIONS:1, check get_vouchers for the highest existing number of this voucher type and retry " +
            "with voucherNumber set to the next one.",
        },
      },
      required: ["date", "partyLedger", "items"],
    },
  },
  {
    name: "update_debit_note",
    description:
      "Update an existing item-invoice Debit Note in TallyPrime, replacing its item lines, party, and narration. " +
      "Same fields as create_debit_note, plus voucherNumber. Matched by date + voucher number — use " +
      "get_ledger_vouchers or get_vouchers first to confirm it exists and is unique. Refuses if another voucher " +
      "type shares the same number on that date (confirmed live: Tally's Alter lookup ignores voucher type and can " +
      "silently corrupt the wrong one) — resolve the collision in Tally first if that happens.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing debit note's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the debit note to update" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Supplier ledger name (the party being debited)" },
        items: {
          type: "array",
          description: "One entry per returned line — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item being returned" },
              qty: { type: "number", description: "Quantity returned" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string" },
              purchaseLedger: { type: "string", description: "Purchase/Purchase Returns ledger this line is reversed against" },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking (same silent-fail behavior as create_purchase_invoice)." },
              batchName: { type: "string" },
              discountPercent: { type: "number" },
              vatLedger: { type: "string" },
              vatRatePercent: { type: "number" },
            },
            required: ["stockItem", "qty", "rate", "unit", "purchaseLedger"],
          },
        },
        vatLedger: { type: "string", description: "Default VAT ledger for items without their own override." },
        vatRatePercent: { type: "number", description: "Default VAT rate. Required if vatLedger is set." },
        billName: { type: "string", description: "Bill reference to settle against, e.g. the original bill's name. Defaults to 'Agst Ref' billType." },
        billType: { type: "string", description: "Defaults to 'Agst Ref' — settling against the original purchase's bill, unlike create_purchase_invoice's 'New Ref' default." },
      },
      required: ["date", "voucherNumber", "partyLedger", "items"],
    },
  },
  {
    name: "create_delivery_note",
    description:
      "Create a Delivery Note in TallyPrime — an item-line inventory voucher recording goods dispatched to a " +
      "customer before or without a full Sales invoice (e.g. against a Sales Order). Same item-line shape as " +
      "create_sales_invoice (stock item, quantity, rate, Sales ledger per line) but ISINVOICE is set to No and " +
      "there's no VAT/tax line — a Delivery Note doesn't invoice the customer, it just moves stock out and " +
      "records the reference. Distinct from create_rejections_out, which has no party/ledger amount at all. " +
      "IMPORTANT (confirmed live): the Delivery Note voucher type must be active in the company first — check in " +
      "Tally's UI (voucher types can be turned off per company) — otherwise the API still reports CREATED:1 " +
      "even though the voucher won't show up in any report or be findable by get_vouchers/delete_voucher until " +
      "the type is turned on. Once active, get_vouchers and delete_voucher find it correctly. " +
      "get_ledger_vouchers will still never show it, by design, not a gap — that tool deliberately excludes " +
      "inventory-classified vouchers (see its own description). ALSO confirmed live: Delivery Note can silently " +
      "stop auto-numbering via the gateway, same failure mode as item-invoice types (Sales/Purchase/Credit " +
      "Note/Debit Note) — symptom is a blank EXCEPTIONS:1 with no useful error text (the real cause, 'Voucher " +
      "No. is missing', only shows in Tally's own Import Data UI). If creation fails this way, pass " +
      "voucherNumber explicitly (check get_vouchers for the next free number of this voucher type).",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Delivery date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Customer ledger name" },
        items: {
          type: "array",
          description: "One entry per line.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity dispatched" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              salesLedger: { type: "string", description: "Sales ledger this line's amount is notionally posted to, e.g. 'Sales Accounts'" },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking (same silent-fail behavior as create_sales_invoice)." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount. Optional." },
            },
            required: ["stockItem", "qty", "rate", "unit", "salesLedger"],
          },
        },
        voucherNumber: {
          type: "string",
          description:
            "Explicit voucher number. Normally omit and let Tally auto-number — but this connector confirmed live " +
            "that Delivery Note can stop auto-numbering via the gateway (same as item-invoice types). If creation " +
            "fails with a blank EXCEPTIONS:1, check get_vouchers for the highest existing number of this voucher " +
            "type and retry with voucherNumber set to the next one.",
        },
      },
      required: ["date", "partyLedger", "items"],
    },
  },
  {
    name: "update_delivery_note",
    description:
      "Update an existing Delivery Note in TallyPrime, replacing its item lines, party, and narration. Same " +
      "fields as create_delivery_note, plus voucherNumber. Matched by date + voucher number — use " +
      "get_ledger_vouchers or get_vouchers first to confirm it exists and is unique. Refuses if another voucher " +
      "type shares the same number on that date (confirmed live: Tally's Alter lookup ignores voucher type and " +
      "can silently corrupt the wrong one) — resolve the collision in Tally first if that happens.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing delivery note's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the delivery note to update" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Customer ledger name" },
        items: {
          type: "array",
          description: "One entry per line — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity dispatched" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              salesLedger: { type: "string", description: "Sales ledger this line's amount is notionally posted to, e.g. 'Sales Accounts'" },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount. Optional." },
            },
            required: ["stockItem", "qty", "rate", "unit", "salesLedger"],
          },
        },
      },
      required: ["date", "voucherNumber", "partyLedger", "items"],
    },
  },
  {
    name: "create_receipt_note",
    description:
      "Create a Receipt Note in TallyPrime — an item-line inventory voucher recording goods received from a " +
      "supplier before or without a full Purchase invoice (e.g. against a Purchase Order). Same item-line shape " +
      "as create_purchase_invoice (stock item, quantity, rate, Purchase ledger per line) but ISINVOICE is set to " +
      "No and there's no VAT/tax line — mirror of create_delivery_note on the buying side. Same caveat as " +
      "create_delivery_note: the voucher type must be active in the company first, or it won't show up in " +
      "get_vouchers/delete_voucher until it is. get_ledger_vouchers will still never show it, by design.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Receipt date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Supplier ledger name" },
        items: {
          type: "array",
          description: "One entry per line.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity received" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              purchaseLedger: { type: "string", description: "Purchase ledger this line's amount is notionally posted to, e.g. 'Purchase Accounts'" },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount. Optional." },
            },
            required: ["stockItem", "qty", "rate", "unit", "purchaseLedger"],
          },
        },
        voucherNumber: { type: "string", description: "Explicit voucher number — normally omit and let Tally auto-number." },
      },
      required: ["date", "partyLedger", "items"],
    },
  },
  {
    name: "update_receipt_note",
    description:
      "Update an existing Receipt Note in TallyPrime, replacing its item lines, party, and narration. Same " +
      "fields as create_receipt_note, plus voucherNumber. Same matching/collision caveats as update_delivery_note.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing receipt note's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the receipt note to update" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Supplier ledger name" },
        items: {
          type: "array",
          description: "One entry per line — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity received" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              purchaseLedger: { type: "string", description: "Purchase ledger this line's amount is notionally posted to, e.g. 'Purchase Accounts'" },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount. Optional." },
            },
            required: ["stockItem", "qty", "rate", "unit", "purchaseLedger"],
          },
        },
      },
      required: ["date", "voucherNumber", "partyLedger", "items"],
    },
  },
  {
    name: "create_sales_order",
    description:
      "Create a Sales Order in TallyPrime — a future commitment to sell, before any goods move or invoicing " +
      "happens. Same item-line shape as create_sales_invoice/create_delivery_note but VCHTYPE is 'Sales Order' " +
      "and Tally classifies it as an Order-class voucher, structurally different from Delivery Note's " +
      "inventory-class. Follow up with create_delivery_note (dispatch) and/or create_sales_invoice (billing) " +
      "against the same party once goods actually move. Same voucher-type-active prerequisite as " +
      "create_delivery_note (confirmed live) — check it's on in the company before relying on this. " +
      "orderNumber and each item's dueDate are REQUIRED (unlike other item-invoice tools, where the equivalent " +
      "fields are optional): confirmed live that Tally rejects an Order-class voucher with 'Order No. is " +
      "missing in Item Allocations' and separately 'Due Date of Order is missing in Item Allocations' without " +
      "them. Reverse-engineered from a real manually-created Sales Order's own export: the UI's 'Order no.' " +
      "field is backed by the voucher-level REFERENCE tag (independent of the voucher number — the real example " +
      "had voucherNumber '1' and Order no. '12345' as genuinely different values), while the per-item Order No. " +
      "and Due Date both live nested inside each item's BATCHALLOCATIONS.LIST, not as direct ALLINVENTORYENTRIES " +
      "fields as their names might suggest. Also confirmed live: Tally silently reassigns its own voucher number " +
      "for Order-class vouchers regardless of an explicit voucherNumber passed in (its 'Auto Retain' numbering " +
      "style for this voucher type) — check the actual assigned number via get_vouchers after creating one, " +
      "don't assume the value you passed was used.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Order date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Customer ledger name" },
        items: {
          type: "array",
          description: "One entry per line.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity ordered" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              salesLedger: { type: "string", description: "Sales ledger this line's amount is notionally posted to" },
              dueDate: { type: "string", description: "Expected delivery date for this line, DD-MM-YYYY. REQUIRED — confirmed live that Tally rejects an Order-class voucher with 'Due Date of Order is missing in Item Allocations' without one." },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount. Optional." },
            },
            required: ["stockItem", "qty", "rate", "unit", "salesLedger", "dueDate"],
          },
        },
        orderNumber: { type: "string", description: "REQUIRED — the order reference shown as 'Order no.' in Tally's UI. Independent of voucherNumber; can be any value the customer/business uses to reference this order." },
        voucherNumber: { type: "string", description: "Explicit voucher number — normally omit and let Tally auto-number. Distinct from orderNumber." },
      },
      required: ["date", "partyLedger", "items", "orderNumber"],
    },
  },
  {
    name: "update_sales_order",
    description:
      "Update an existing Sales Order in TallyPrime, replacing its item lines, party, order number, and " +
      "narration. Same fields as create_sales_order (orderNumber and each item's dueDate still REQUIRED), plus " +
      "voucherNumber to locate the existing voucher. Matched by date + voucher number — use get_ledger_vouchers " +
      "or get_vouchers first to confirm it exists and is unique. Refuses if another voucher type shares the same " +
      "number on that date (confirmed live: Tally's Alter lookup ignores voucher type and can silently corrupt " +
      "the wrong one) — resolve the collision in Tally first if that happens. Note voucherNumber here is the " +
      "existing voucher's own number to match by — Tally may still not let you change it, since Order-class " +
      "vouchers use 'Auto Retain' numbering (see create_sales_order).",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing order's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the sales order to update" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Customer ledger name" },
        items: {
          type: "array",
          description: "One entry per line — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity ordered" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              salesLedger: { type: "string", description: "Sales ledger this line's amount is notionally posted to" },
              dueDate: { type: "string", description: "Expected delivery date for this line, DD-MM-YYYY. REQUIRED." },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount. Optional." },
            },
            required: ["stockItem", "qty", "rate", "unit", "salesLedger", "dueDate"],
          },
        },
        orderNumber: { type: "string", description: "REQUIRED — the order reference shown as 'Order no.' in Tally's UI." },
      },
      required: ["date", "voucherNumber", "partyLedger", "items", "orderNumber"],
    },
  },
  {
    name: "create_purchase_order",
    description:
      "Create a Purchase Order in TallyPrime — a future commitment to buy, before any goods move or invoicing " +
      "happens. Same item-line shape as create_purchase_invoice/create_receipt_note but VCHTYPE is 'Purchase " +
      "Order' and Tally classifies it as an Order-class voucher. Follow up with create_receipt_note (goods in) " +
      "and/or create_purchase_invoice (billing) against the same party once goods actually arrive. Same " +
      "voucher-type-active prerequisite as create_delivery_note (confirmed live). orderNumber and each item's " +
      "dueDate are REQUIRED — same reasoning as create_sales_order: reverse-engineered from a real Sales Order " +
      "export, confirmed the same live errors and Auto Retain numbering behavior apply here too.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Order date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Supplier ledger name" },
        items: {
          type: "array",
          description: "One entry per line.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity ordered" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              purchaseLedger: { type: "string", description: "Purchase ledger this line's amount is notionally posted to" },
              dueDate: { type: "string", description: "Expected receipt date for this line, DD-MM-YYYY. REQUIRED — confirmed live that Tally rejects an Order-class voucher with 'Due Date of Order is missing in Item Allocations' without one." },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount. Optional." },
            },
            required: ["stockItem", "qty", "rate", "unit", "purchaseLedger", "dueDate"],
          },
        },
        orderNumber: { type: "string", description: "REQUIRED — the order reference shown as 'Order no.' in Tally's UI. Independent of voucherNumber; can be any value the business uses to reference this order." },
        voucherNumber: { type: "string", description: "Explicit voucher number — normally omit and let Tally auto-number. Distinct from orderNumber." },
      },
      required: ["date", "partyLedger", "items", "orderNumber"],
    },
  },
  {
    name: "update_purchase_order",
    description:
      "Update an existing Purchase Order in TallyPrime, replacing its item lines, party, order number, and " +
      "narration. Same fields as create_purchase_order, plus voucherNumber. Same matching/collision caveats as " +
      "update_sales_order.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing order's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the purchase order to update" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Supplier ledger name" },
        items: {
          type: "array",
          description: "One entry per line — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity ordered" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              purchaseLedger: { type: "string", description: "Purchase ledger this line's amount is notionally posted to" },
              dueDate: { type: "string", description: "Expected receipt date for this line, DD-MM-YYYY. REQUIRED." },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount. Optional." },
            },
            required: ["stockItem", "qty", "rate", "unit", "purchaseLedger", "dueDate"],
          },
        },
        orderNumber: { type: "string", description: "REQUIRED — the order reference shown as 'Order no.' in Tally's UI." },
      },
      required: ["date", "voucherNumber", "partyLedger", "items", "orderNumber"],
    },
  },
  {
    name: "create_job_work_in_order",
    description:
      "Create a Job Work In Order in TallyPrime — used when this company is the job worker, booking an order to " +
      "process raw materials a customer will supply, into a finished item the company will deliver back. Each " +
      "item line is the finished item expected to be delivered eventually, plus a nested list of components — " +
      "the raw materials the customer is expected to supply for that item. Reverse-engineered from a real " +
      "manually-created Job Work In Order's own export (same technique used for Sales Order): the component list " +
      "lives nested two levels deep, inside each item's own order allocation (VOUCHERCOMPONENTLIST.LIST inside " +
      "BATCHALLOCATIONS.LIST inside ALLINVENTORYENTRIES.LIST), each component carrying its own nested " +
      "BATCHALLOCATIONS.LIST with a PARENTITEM back-reference to the item it belongs to. Confirmed live: this " +
      "structure creates cleanly (no VAT/tax lines, no per-item ledger allocation — just the one balancing party " +
      "ledger entry for the total). Same voucher-type-active prerequisite as other Order-class vouchers, and " +
      "orderNumber + each item's dueDate are REQUIRED (same reasoning as create_sales_order). Distinct from " +
      "create_job_work_out_order, which is for the opposite direction (sending materials out to a job worker).",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Order date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Customer ledger name (the principal who is giving this job work order)" },
        items: {
          type: "array",
          description: "One entry per finished item this company will deliver back to the customer.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the finished/output stock item to be delivered" },
              qty: { type: "number", description: "Quantity of the finished item expected" },
              rate: { type: "number", description: "Rate per unit of the finished item" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              dueDate: { type: "string", description: "Expected delivery date for this line, DD-MM-YYYY. REQUIRED — same 'Due Date of Order' requirement as Sales Order/Purchase Order." },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              components: {
                type: "array",
                description: "Raw materials the customer is expected to supply for this finished item.",
                items: {
                  type: "object",
                  properties: {
                    stockItem: { type: "string", description: "Exact name of the raw material stock item" },
                    qty: { type: "number", description: "Quantity of raw material expected from the customer" },
                    rate: { type: "number", description: "Rate per unit of the raw material" },
                    unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
                    godown: { type: "string", description: "Godown for this component. Required if the company has multi-godown tracking." },
                    batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
                  },
                  required: ["stockItem", "qty", "rate", "unit"],
                },
              },
            },
            required: ["stockItem", "qty", "rate", "unit", "dueDate", "components"],
          },
        },
        orderNumber: { type: "string", description: "REQUIRED — the order reference shown as 'Order no.' in Tally's UI. Independent of voucherNumber." },
        voucherNumber: { type: "string", description: "Explicit voucher number — normally omit and let Tally auto-number. Distinct from orderNumber." },
      },
      required: ["date", "partyLedger", "items", "orderNumber"],
    },
  },
  {
    name: "update_job_work_in_order",
    description:
      "Update an existing Job Work In Order in TallyPrime, replacing its item lines (and their component lists), " +
      "party, order number, and narration. Same fields as create_job_work_in_order, plus voucherNumber. Matched " +
      "by date + voucher number — use get_ledger_vouchers or get_vouchers first to confirm it exists and is " +
      "unique. Refuses if another voucher type shares the same number on that date (confirmed live: Tally's " +
      "Alter lookup ignores voucher type and can silently corrupt the wrong one) — resolve the collision in " +
      "Tally first if that happens.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing order's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the job work order to update" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Customer ledger name (the principal who is giving this job work order)" },
        items: {
          type: "array",
          description: "One entry per finished item — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the finished/output stock item to be delivered" },
              qty: { type: "number", description: "Quantity of the finished item expected" },
              rate: { type: "number", description: "Rate per unit of the finished item" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              dueDate: { type: "string", description: "Expected delivery date for this line, DD-MM-YYYY. REQUIRED." },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              components: {
                type: "array",
                description: "Raw materials the customer is expected to supply for this finished item.",
                items: {
                  type: "object",
                  properties: {
                    stockItem: { type: "string", description: "Exact name of the raw material stock item" },
                    qty: { type: "number", description: "Quantity of raw material expected from the customer" },
                    rate: { type: "number", description: "Rate per unit of the raw material" },
                    unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
                    godown: { type: "string", description: "Godown for this component. Required if the company has multi-godown tracking." },
                    batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
                  },
                  required: ["stockItem", "qty", "rate", "unit"],
                },
              },
            },
            required: ["stockItem", "qty", "rate", "unit", "dueDate", "components"],
          },
        },
        orderNumber: { type: "string", description: "REQUIRED — the order reference shown as 'Order no.' in Tally's UI." },
      },
      required: ["date", "voucherNumber", "partyLedger", "items", "orderNumber"],
    },
  },
  {
    name: "create_job_work_out_order",
    description:
      "Create a Job Work Out Order in TallyPrime — used when this company is the principal, sending raw " +
      "materials out to a job worker (subcontractor) and expecting a finished item back. Mirror image of " +
      "create_job_work_in_order: each item line is the finished item expected to be received from the job " +
      "worker, plus a nested list of components — the raw materials this company will send out for that item. " +
      "Same nested XML structure as create_job_work_in_order, with the accounting direction flipped (matching " +
      "the existing Sales-side vs Purchase-side sign convention already used by create_sales_order vs " +
      "create_purchase_order in this connector) since this voucher represents an inward expected receipt rather " +
      "than an outward delivery. Confirmed live: creates cleanly with no exceptions. Same voucher-type-active " +
      "prerequisite and required orderNumber/dueDate as create_job_work_in_order.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Order date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Job worker (subcontractor) ledger name" },
        items: {
          type: "array",
          description: "One entry per finished item expected back from the job worker.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the finished/output stock item expected back" },
              qty: { type: "number", description: "Quantity of the finished item expected" },
              rate: { type: "number", description: "Rate per unit of the finished item" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              dueDate: { type: "string", description: "Expected receipt date for this line, DD-MM-YYYY. REQUIRED." },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              components: {
                type: "array",
                description: "Raw materials this company will send out to the job worker for this finished item.",
                items: {
                  type: "object",
                  properties: {
                    stockItem: { type: "string", description: "Exact name of the raw material stock item" },
                    qty: { type: "number", description: "Quantity of raw material to be sent out" },
                    rate: { type: "number", description: "Rate per unit of the raw material" },
                    unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
                    godown: { type: "string", description: "Godown for this component. Required if the company has multi-godown tracking." },
                    batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
                  },
                  required: ["stockItem", "qty", "rate", "unit"],
                },
              },
            },
            required: ["stockItem", "qty", "rate", "unit", "dueDate", "components"],
          },
        },
        orderNumber: { type: "string", description: "REQUIRED — the order reference shown as 'Order no.' in Tally's UI. Independent of voucherNumber." },
        voucherNumber: { type: "string", description: "Explicit voucher number — normally omit and let Tally auto-number. Distinct from orderNumber." },
      },
      required: ["date", "partyLedger", "items", "orderNumber"],
    },
  },
  {
    name: "update_job_work_out_order",
    description:
      "Update an existing Job Work Out Order in TallyPrime, replacing its item lines (and their component " +
      "lists), party, order number, and narration. Same fields as create_job_work_out_order, plus voucherNumber. " +
      "Same matching/collision caveats as update_job_work_in_order.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing order's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the job work order to update" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Job worker (subcontractor) ledger name" },
        items: {
          type: "array",
          description: "One entry per finished item — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the finished/output stock item expected back" },
              qty: { type: "number", description: "Quantity of the finished item expected" },
              rate: { type: "number", description: "Rate per unit of the finished item" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              dueDate: { type: "string", description: "Expected receipt date for this line, DD-MM-YYYY. REQUIRED." },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              components: {
                type: "array",
                description: "Raw materials this company will send out to the job worker for this finished item.",
                items: {
                  type: "object",
                  properties: {
                    stockItem: { type: "string", description: "Exact name of the raw material stock item" },
                    qty: { type: "number", description: "Quantity of raw material to be sent out" },
                    rate: { type: "number", description: "Rate per unit of the raw material" },
                    unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
                    godown: { type: "string", description: "Godown for this component. Required if the company has multi-godown tracking." },
                    batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
                  },
                  required: ["stockItem", "qty", "rate", "unit"],
                },
              },
            },
            required: ["stockItem", "qty", "rate", "unit", "dueDate", "components"],
          },
        },
        orderNumber: { type: "string", description: "REQUIRED — the order reference shown as 'Order no.' in Tally's UI." },
      },
      required: ["date", "voucherNumber", "partyLedger", "items", "orderNumber"],
    },
  },
  {
    name: "create_sales_quotation",
    description:
      "Create a Sales Quotation in TallyPrime — a pre-order price quote to a prospective customer, one step " +
      "before create_sales_order. Same item-line shape as create_sales_order, including the same orderNumber " +
      "(REFERENCE) and per-item dueDate requirements — confirmed live that Tally classifies Sales Quotation as " +
      "an Order-class voucher (PARENT 'Sales Order' in get_voucher_types) and rejects it the same way without " +
      "them. Same voucher-type-active prerequisite as create_delivery_note. Follow up with create_sales_order " +
      "once the customer accepts.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Quotation date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Prospective customer ledger name" },
        items: {
          type: "array",
          description: "One entry per line.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity quoted" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              salesLedger: { type: "string", description: "Sales ledger this line's amount is notionally posted to" },
              dueDate: { type: "string", description: "Expected validity/delivery date for this line, DD-MM-YYYY. REQUIRED — same 'Due Date of Order' requirement as create_sales_order." },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount. Optional." },
            },
            required: ["stockItem", "qty", "rate", "unit", "salesLedger", "dueDate"],
          },
        },
        orderNumber: { type: "string", description: "REQUIRED — the order reference shown as 'Order no.' in Tally's UI. Independent of voucherNumber." },
        voucherNumber: { type: "string", description: "Explicit voucher number — normally omit and let Tally auto-number. Distinct from orderNumber." },
      },
      required: ["date", "partyLedger", "items", "orderNumber"],
    },
  },
  {
    name: "update_sales_quotation",
    description:
      "Update an existing Sales Quotation in TallyPrime, replacing its item lines, party, order number, and " +
      "narration. Same fields as create_sales_quotation, plus voucherNumber. Same matching/collision caveats as " +
      "update_sales_order.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Existing quotation's date in DD-MM-YYYY format" },
        voucherNumber: { type: "string", description: "Exact voucher number of the quotation to update" },
        narration: { type: "string", description: "Narration / description" },
        partyLedger: { type: "string", description: "Prospective customer ledger name" },
        items: {
          type: "array",
          description: "One entry per line — replaces all existing lines.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the stock item" },
              qty: { type: "number", description: "Quantity quoted" },
              rate: { type: "number", description: "Rate per unit" },
              unit: { type: "string", description: "Unit of measure — must match the stock item's unit" },
              salesLedger: { type: "string", description: "Sales ledger this line's amount is notionally posted to" },
              dueDate: { type: "string", description: "Expected validity/delivery date for this line, DD-MM-YYYY. REQUIRED." },
              godown: { type: "string", description: "Godown for this line. Required if the company has multi-godown tracking." },
              batchName: { type: "string", description: "Real batch/lot number, if the item has batch tracking. Defaults to 'Primary Batch'." },
              discountPercent: { type: "number", description: "Discount percentage applied to this line's amount. Optional." },
            },
            required: ["stockItem", "qty", "rate", "unit", "salesLedger", "dueDate"],
          },
        },
        orderNumber: { type: "string", description: "REQUIRED — the order reference shown as 'Order no.' in Tally's UI." },
      },
      required: ["date", "voucherNumber", "partyLedger", "items", "orderNumber"],
    },
  },
  {
    name: "create_group",
    description:
      "Create a new account group in TallyPrime, nested under a parent group, or rename/reparent an existing one " +
      "by passing oldName.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the group (the new name, if renaming)" },
        oldName: { type: "string", description: "Existing group's current name — pass this to rename/reparent instead of creating a new group." },
        parent: {
          type: "string",
          description: "Parent group, e.g. 'Primary', 'Current Assets'",
        },
      },
      required: ["name", "parent"],
    },
  },
  {
    name: "create_stock_group",
    description:
      "Create a new Stock Group in TallyPrime, nested under a parent stock group. Distinct from create_group " +
      "(account groups like Sundry Debtors) — this is the category stock items are filed under (create_stock_item's " +
      "'group' field). Required before creating a stock item under a brand-new category that doesn't exist yet.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the new stock group" },
        parent: { type: "string", description: "Parent stock group, e.g. 'Primary'" },
      },
      required: ["name", "parent"],
    },
  },
  {
    name: "create_unit",
    description:
      "Create a new Unit of Measure in TallyPrime — a simple unit (e.g. 'Kg', 'Box', 'Ltr') by default, or a " +
      "compound unit (e.g. 'Box of 12 Nos') by passing baseUnit/additionalUnit/conversion. Required before " +
      "creating or invoicing a stock item in a unit that doesn't exist yet — stock item/invoice tools fail with " +
      "'Unit does not exist!' otherwise. For a compound unit, both baseUnit and additionalUnit must already " +
      "exist as simple units first (confirmed live pattern: create both simple units, then the compound unit " +
      "referencing them). A simple unit's symbol (and baseUnit/additionalUnit, since those reference existing " +
      "simple units' symbols) cannot contain whitespace — confirmed live: Tally rejects that with 'Master name " +
      "contains invalid characters', checked client-side before this ever reaches Tally. A compound unit's own " +
      "display name (e.g. 'Box of 12 Nos') can still contain spaces.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "The unit symbol as referenced elsewhere, e.g. 'Kg', 'Box', 'Box of 12 Nos'" },
        formalName: { type: "string", description: "Full name, e.g. 'Kilograms'. Optional." },
        decimalPlaces: { type: "number", description: "Decimal precision for quantities in this simple unit. Defaults to 0 (whole numbers only, e.g. 'Nos'). Ignored for a compound unit." },
        baseUnit: { type: "string", description: "For a compound unit only: the larger/outer unit, e.g. 'Box'. Must already exist as a simple unit." },
        additionalUnit: { type: "string", description: "For a compound unit only: the smaller unit it's made of, e.g. 'Nos'. Must already exist as a simple unit. Required if baseUnit is set." },
        conversion: { type: "number", description: "For a compound unit only: how many additionalUnit make one baseUnit, e.g. 12. Required if baseUnit is set." },
      },
      required: ["symbol"],
    },
  },
  {
    name: "create_godown",
    description:
      "Create a new Godown/Location in TallyPrime, optionally nested under a parent godown (e.g. a sub-location " +
      "under a main warehouse). Required before referencing a godown that doesn't exist yet on an invoice/voucher " +
      "line — those fail with 'Godown does not exist!' otherwise. Pass the parent's plain name, not a dotted path " +
      "(confirmed live: 'MAIN LOCATION.DUBAI' is invalid, 'MAIN LOCATION' as parent + 'DUBAI' as name is correct).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the new godown" },
        parent: { type: "string", description: "Parent godown name, if nesting under an existing one. Omit for a top-level godown." },
      },
      required: ["name"],
    },
  },
  {
    name: "create_cost_category",
    description:
      "Create a new Cost Category in TallyPrime (a grouping of cost centres, e.g. 'Branch', 'Project'). Required " +
      "before creating a cost centre under a category that doesn't exist yet.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the new cost category" },
        allocateToRevenue: { type: "boolean", description: "Allow allocation to revenue items. Defaults to true." },
        allocateToNonRevenue: { type: "boolean", description: "Allow allocation to non-revenue (balance sheet) items. Defaults to true." },
      },
      required: ["name"],
    },
  },
  {
    name: "create_cost_centre",
    description:
      "Create a new Cost Centre in TallyPrime (e.g. a department, branch, or project used to tag voucher entries " +
      "for cost tracking — see create_voucher's costCentre fields).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the new cost centre" },
        category: { type: "string", description: "Cost category this belongs to. Defaults to 'Primary Cost Category' if omitted." },
        parent: { type: "string", description: "Parent cost centre, if nesting under an existing one." },
      },
      required: ["name"],
    },
  },
  {
    name: "create_voucher_type",
    description:
      "Create a new custom Voucher Type in TallyPrime (e.g. 'Bank Payment' as a sub-type of 'Payment', with its " +
      "own numbering series/abbreviation) — or rename/reconfigure an existing one by passing oldName. Base types " +
      "to derive from: 'Payment', 'Receipt', 'Journal', 'Contra', 'Sales', 'Purchase', 'Credit Note', 'Debit " +
      "Note', 'Stock Journal', 'Physical Stock', etc. — must be an exact existing voucher type name (check " +
      "get_voucher_types first). Setting numberingMethod explicitly is useful given the confirmed-live issue " +
      "where some Tally configurations stop auto-numbering item-invoice-mode voucher types via the XML gateway " +
      "unless a voucherNumber is supplied on every create call — see create_sales_invoice's voucherNumber note. " +
      "Confirmed live separately: a brand-new custom voucher type created WITHOUT numberingMethod set can accept " +
      "vouchers with a completely blank voucher number (not even '1') — pass numberingMethod: 'Automatic' " +
      "explicitly to avoid ending up with unreferenceable vouchers you can only look up/delete by date.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the voucher type (the new name, if renaming)" },
        oldName: { type: "string", description: "Existing voucher type's current name — pass this to rename/reconfigure instead of creating a new one." },
        parent: { type: "string", description: "Base voucher type this derives from, e.g. 'Payment', 'Sales', 'Journal'. Must already exist (see get_voucher_types)." },
        numberingMethod: {
          type: "string",
          description:
            "'Automatic', 'Manual', 'Automatic (Manual Override)', or 'Multi User Auto'. Controls whether Tally " +
            "auto-assigns voucher numbers on create, and whether an explicit voucherNumber is accepted/required.",
        },
        abbreviation: { type: "string", description: "Short code shown for this voucher type in reports, e.g. 'Bank Pymt'." },
        preventDuplicates: { type: "boolean", description: "Reject a new voucher if its number duplicates an existing one of this type." },
        useAsManufacturingJournal: {
          type: "boolean",
          description:
            "Flag this voucher type as a Manufacturing Journal (only meaningful with parent 'Stock Journal'). " +
            "Same underlying voucher XML as a plain Stock Journal — this only changes how Tally labels/reports " +
            "it. Pass this voucher type's name as 'voucherType' to create_stock_journal/update_stock_journal to " +
            "post against it instead of the generic 'Stock Journal' type.",
        },
        extraFields: { type: "object", description: "Escape hatch for any other native Tally VOUCHERTYPE field by exact XML tag name — not validated." },
      },
      required: ["name", "parent"],
    },
  },
  {
    name: "create_stock_item",
    description: "Create a new stock item in TallyPrime",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the new stock item" },
        group: {
          type: "string",
          description: "Stock group, e.g. 'Primary' (use 'Primary' if there are no custom stock groups)",
        },
        unit: { type: "string", description: "Unit of measure, e.g. 'Nos', 'Kg', 'Box'" },
        openingBalance: { type: "number", description: "Opening quantity (optional, defaults to 0)" },
        openingRate: { type: "number", description: "Opening rate per unit (optional, defaults to 0)" },
        description: { type: "string", description: "Free-text description of the item." },
        rateOfVat: { type: "number", description: "VAT rate percentage for this item, e.g. 5." },
        ignoreNegativeStock: {
          type: "boolean",
          description: "Allow this item's stock to go negative without a warning/block.",
        },
        extraFields: {
          type: "object",
          description:
            "Escape hatch for any other native Tally stock item field not covered above — pass exact Tally XML tag names as keys. Not validated; use exact field names from a master export.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["name", "group", "unit"],
    },
  },
  {
    name: "update_stock_item",
    description: "Update an existing stock item in TallyPrime — same fields as create_stock_item, all optional except name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact name of the existing stock item" },
        group: { type: "string", description: "New stock group" },
        unit: { type: "string", description: "New unit of measure" },
        description: { type: "string", description: "Free-text description of the item." },
        rateOfVat: { type: "number", description: "VAT rate percentage for this item, e.g. 5." },
        ignoreNegativeStock: { type: "boolean", description: "Allow this item's stock to go negative without a warning/block." },
        extraFields: {
          type: "object",
          description: "Escape hatch for any other native Tally stock item field, same as on create_stock_item.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_stock_item",
    description:
      "Delete a stock item from TallyPrime. Fails if it has transactions posted against it. If deleting a voucher that " +
      "used this item in the same turn, delete the voucher first and confirm it succeeded before calling this — doing " +
      "both in parallel can race (confirmed live). If this item was used in both a Sales AND a Purchase item-invoice, " +
      "it may return 'Cannot be deleted!' even with zero balance and no transactions left — fixed by Company Data → " +
      "Rewrite in Tally itself (confirmed live), not by retrying.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact name of the stock item to delete" },
      },
      required: ["name"],
    },
  },
  {
    name: "set_bill_of_materials",
    description:
      "Attach a Bill of Materials (recipe) to an existing finished-goods stock item, so a Manufacturing/Stock " +
      "Journal producing this item can have its component quantities computed from a fixed ratio instead of " +
      "typed by hand every time. Uses Tally's native MULTICOMPONENTLIST.LIST structure. This is a pure " +
      "convenience layer over create_stock_journal — it does not affect stock or post anything by itself; you " +
      "still call create_stock_journal to actually record a production run, scaling each component's qty by " +
      "the ratio to basicQty yourself (this tool does not auto-compute that scaling for you). EXTRAPOLATED from " +
      "a genuine Tally-exported XML template's stock item master shape, not reverse-engineered from a real " +
      "manually-created BOM — verify carefully after use, especially natureOfItem's accepted values.",
    inputSchema: {
      type: "object",
      properties: {
        stockItem: { type: "string", description: "Exact name of the existing finished-goods stock item to attach this BOM to" },
        componentListName: { type: "string", description: "Name for this BOM/recipe (Tally allows more than one per item). Defaults to 'Primary'." },
        basicQty: { type: "number", description: "The quantity of stockItem this recipe produces (the ratio base). Defaults to 1." },
        unit: { type: "string", description: "Unit of measure for basicQty, e.g. 'Nos'." },
        components: {
          type: "array",
          description: "The raw materials (and any co-products/scrap) in this recipe.",
          items: {
            type: "object",
            properties: {
              stockItem: { type: "string", description: "Exact name of the component stock item" },
              qty: { type: "number", description: "Quantity of this component required to produce basicQty of the finished item" },
              unit: { type: "string", description: "Unit of measure for qty" },
              natureOfItem: {
                type: "string",
                enum: ["Component", "Co-Product", "By-Product", "Scrap"],
                description: "What role this line plays in the recipe. Defaults to 'Component' (a consumed raw material).",
              },
              godown: { type: "string", description: "Godown this component is normally drawn from (optional)." },
            },
            required: ["stockItem", "qty", "unit"],
          },
        },
      },
      required: ["stockItem", "components"],
    },
  },
  {
    name: "update_voucher",
    description:
      "Update an existing voucher in TallyPrime, replacing its ledger entries and narration. " +
      "The voucher is matched by type + date + voucher number, so that combination must be unique " +
      "and must exactly match an existing voucher (use get_ledger_vouchers or get_vouchers first to confirm it). " +
      "Either pass debitLedger/creditLedger/amount for a simple 2-leg voucher, or pass 'entries' for 3+ lines, " +
      "same as create_voucher. Refuses if another voucher type shares the same number on that date (confirmed " +
      "live: Tally's Alter lookup ignores voucher type and can silently corrupt the wrong one) — resolve the " +
      "collision in Tally first if that happens.",
    inputSchema: {
      type: "object",
      properties: {
        voucherType: { type: "string", description: "Voucher type, e.g. 'Payment', 'Receipt', 'Journal'" },
        voucherNumber: { type: "string", description: "Exact voucher number of the voucher to update" },
        date: { type: "string", description: "Existing voucher's date in DD-MM-YYYY format" },
        narration: { type: "string", description: "New narration / description for the voucher" },
        debitLedger: { type: "string", description: "Ledger name to debit (simple 2-leg mode; omit if using 'entries')" },
        creditLedger: { type: "string", description: "Ledger name to credit (simple 2-leg mode; omit if using 'entries')" },
        amount: { type: "number", description: "New amount of the transaction (simple 2-leg mode; omit if using 'entries')" },
        debitCostCentre: { type: "string", description: "Cost centre to allocate the debit leg to (optional)." },
        creditCostCentre: { type: "string", description: "Cost centre to allocate the credit leg to (optional)." },
        costCategory: {
          type: "string",
          description: "Cost category the cost centre belongs to. Defaults to 'Primary Cost Category'.",
        },
        entries: {
          type: "array",
          description:
            "For a voucher with more than 2 lines: an array of { ledgerName, amount, type: 'debit'|'credit', " +
            "billName?, billType?, costCentre?, costCategory? }, same shape as create_voucher's entries. Debit and " +
            "credit amounts must sum to the same total. When provided, this replaces debitLedger/creditLedger/amount.",
          items: {
            type: "object",
            properties: {
              ledgerName: { type: "string" },
              amount: { type: "number" },
              type: { type: "string", enum: ["debit", "credit"] },
              billName: { type: "string" },
              billType: { type: "string" },
              costCentre: { type: "string" },
              costCategory: { type: "string" },
            },
            required: ["ledgerName", "amount", "type"],
          },
        },
      },
      required: ["voucherType", "voucherNumber", "date"],
    },
  },
  {
    name: "delete_voucher",
    description:
      "Permanently delete an existing voucher from TallyPrime — removes it entirely with no trace " +
      "(distinct from cancelling, which keeps it visible but marked Cancelled). The voucher is matched " +
      "by type + date + voucher number, so that combination must be unique and must exactly match an " +
      "existing voucher (use get_ledger_vouchers or get_vouchers first to confirm it). This has no undo. " +
      "Refuses if another voucher type shares the same number on that date (confirmed live: Tally's lookup " +
      "ignores voucher type and can silently target the wrong one) — resolve the collision in Tally first.",
    inputSchema: {
      type: "object",
      properties: {
        voucherType: { type: "string", description: "Voucher type, e.g. 'Payment', 'Receipt', 'Journal'" },
        voucherNumber: { type: "string", description: "Exact voucher number of the voucher to delete" },
        date: { type: "string", description: "Existing voucher's date in DD-MM-YYYY format" },
      },
      required: ["voucherType", "voucherNumber", "date"],
    },
  },
  {
    name: "sync_to_sql",
    description:
      "Pull ledgers, groups, and stock items from TallyPrime into this session's SQL cache (in-memory — gone when " +
      "this session ends, and replaced whenever you switch company and re-sync, so nothing lingers between " +
      "different companies), so query_sql can run fast arbitrary queries without hitting Tally each time. Does " +
      "NOT sync vouchers — use sync_vouchers_to_sql for those, one date range at a time.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "sync_vouchers_to_sql",
    description:
      "Pull voucher HEADERS (date, type, number, party ledger, amount, narration — not line items) for one date " +
      "range into this session's SQL cache (in-memory, gone when the session ends), so query_sql can " +
      "aggregate/report on them (e.g. sales by customer by month) without re-fetching from Tally. Call this once " +
      "per chunk to build up full multi-year history for the CURRENTLY OPEN company within this session — " +
      "re-running for the SAME range just refreshes it (safe to re-run), and each call only touches vouchers " +
      "within its own date range, so calling it for 2024 then 2025 gives you both, not just the latest. If you " +
      "switch companies (set_company), sync again — the cache doesn't track which company a row came from, so " +
      "don't query across a company switch without re-syncing first. IMPORTANT: pick a chunk size that won't " +
      "time out — a full year (~7,500 vouchers here) took ~6s against the 10s request timeout; prefer quarterly " +
      "or monthly chunks for a busy company, and back off further if a call times out. Does not include stock " +
      "item / ledger line detail (see get_ledger_vouchers/get_vouchers for that).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date in DD-MM-YYYY format" },
        to: { type: "string", description: "End date in DD-MM-YYYY format" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "sync_voucher_items_to_sql",
    description:
      "Pull voucher INVENTORY LINE ITEMS (stock item, qty, rate, amount, godown, batch — one row per item per " +
      "batch allocation) for one date range into this session's SQL cache, so query_sql can compute movement " +
      "analysis, godown-wise stock, or batch detail directly. This is the raw data those analyses need — Tally " +
      "has no exportable 'Movement Analysis'/'Stock Ageing Analysis'/'Godown Summary' report reachable over the " +
      "gateway (confirmed live against all 138 registered report names, and confirmed live that per-godown " +
      "$ClosingBalance/SVGODOWNNAME scoping doesn't work either), so this connector doesn't try to replicate " +
      "those as report tools — pull the line items with this, then write the aggregation as SQL. qty/amount are " +
      "UNSIGNED as Tally stores them on the inventory entry; use is_deemed_positive together with voucher_type " +
      "to work out inward vs outward direction. A voucher with no stock items (Payment, Journal, etc.) " +
      "contributes zero rows, not an empty one. Same chunked, additive-by-date-range model and same timeout " +
      "caution as sync_vouchers_to_sql — quarterly/monthly chunks for a busy company.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date in DD-MM-YYYY format" },
        to: { type: "string", description: "End date in DD-MM-YYYY format" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "query_sql",
    description:
      "Run a read-only SQL SELECT query against this session's in-memory cache (gone when the session ends). " +
      "Tables: ledgers(name, parent, closing_balance), groups(name, parent), stock_items(name, parent, " +
      "closing_balance), vouchers(guid, date, voucher_type, voucher_number, party_ledger, amount, narration), " +
      "voucher_items(voucher_guid, date, voucher_type, voucher_number, stock_item, qty, rate, amount, " +
      "is_deemed_positive, godown, batch) — all five populated only by explicitly calling " +
      "sync_to_sql/sync_vouchers_to_sql/sync_voucher_items_to_sql first. Movement analysis, godown-wise stock, " +
      "and batch/ageing detail are just SELECTs over voucher_items — there is no separate report tool for them. " +
      "profit_and_loss(ledger_name, group_name, closing_balance, period_from, period_to), " +
      "stock_summary(name, parent, opening_qty, closing_qty, opening_value, closing_value, as_of_date), " +
      "balance_sheet(group_name, amount, as_of_date), trial_balance(name, debit_amount, credit_amount, " +
      "period_from, period_to), and vat_summary(ledger_name, category, closing_balance, period_from, period_to) " +
      "are populated automatically, no separate sync step — every get_profit_and_loss/get_stock_summary/" +
      "get_balance_sheet/get_trial_balance/get_vat_liability_summary call refreshes its table with that call's " +
      "result, so a follow-up question about the same report can query it here instead of re-fetching from " +
      "Tally. Each of these five only ever holds the most recent call's data, not a history — re-call the " +
      "report tool if you need a different period. None of the tables track which company they came from — " +
      "re-sync/re-fetch after switching companies before querying.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT statement" },
      },
      required: ["sql"],
    },
  },
  {
    name: "get_audit_log",
    description:
      "Read this connector's append-only audit log — every tool call made through it (read or write), with " +
      "timestamp, arguments, outcome (success/error/denied), and a best-effort Tally company tag. Entries older " +
      "than 90 days are permanently deleted (checked once per server startup, not kept indefinitely) — this is " +
      "not a full historical record beyond that window. Use this to review what an agent actually did against " +
      "this Tally company, e.g. before trusting a session's claimed results, or to hand a reviewer a plain " +
      "record of every write made in a given period.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max number of most-recent matching entries to return. Defaults to 50." },
        toolFilter: { type: "string", description: "Only return entries for this exact tool name." },
        writesOnly: { type: "boolean", description: "Only return write calls (skip reads) — for reviewing what actually changed." },
        fromDate: { type: "string", description: "Inclusive start date, DD-MM-YYYY. Filters by when the call happened." },
        toDate: { type: "string", description: "Inclusive end date, DD-MM-YYYY." },
        company: {
          type: "string",
          description:
            "Only return entries tagged with this exact Tally company name. Tagging is best-effort — a call " +
            "made before this connector learned which company was open (via get_company_info, get_health_check, " +
            "or set_company) is stored with no company and won't match any value here.",
        },
        format: {
          type: "string",
          enum: ["json", "summary"],
          description:
            "'json' (default) returns the raw matching entries. 'summary' returns a compact table with " +
            "counts by outcome — meant to be handed to someone reviewing what changed, without them needing " +
            "to parse JSON themselves.",
        },
      },
    },
  },
  {
    name: "get_health_check",
    description:
      "Check whether this connector is actually safe and working right now: is Tally's gateway reachable, is a " +
      "company open (and which one), what TALLY_URL it's talking to, whether read-only mode is on, and which " +
      "tools (if any) are explicitly disabled. Use this before trusting a session, or when something feels off, " +
      "instead of inferring connector state from a single tool call's success/failure.",
    inputSchema: { type: "object", properties: {} },
  },
];

function reportXml(reportName: string, staticVariables: Record<string, string>): string {
  return render("report.xml.njk", { reportName, staticVariables: Object.entries(staticVariables) });
}

type TaxLedgerRow = { ledgerName: string; category: "input" | "output" | "rcm" | "other"; matchMethod: "structural" | "name_pattern"; closingBalance: number };

// Shared by get_vat_liability_summary and get_gst_liability_summary. Neither
// tax return report is reachable via a plain Export Data request (confirmed
// live for both VAT's "Vat Return and Annexures" and GST's canned reports),
// so both are reconstructed from ledger balances instead, the same
// technique get_profit_and_loss uses.
//
// Hybrid classification, not either signal alone — confirmed live on two
// real companies that Tally's own $TaxType field (set via the proper GST/VAT
// ledger-creation wizard) is precise but has near-zero recall: every
// TaxType-tagged ledger in both test companies had a ZERO balance, while
// every ledger actually carrying real money was created as a plain ledger
// without TaxType set at all. Relying on TaxType alone would return a
// structurally correct but financially empty result. So: include a ledger
// if EITHER its $TaxType matches OR its name matches a known pattern, and
// tag which method found it so a reviewer can see the confidence per row —
// not filtered by parent group at all, since real companies were confirmed
// to scatter these ledgers across many different groups, not one standard
// "Duties & Taxes" group as official docs describe.
async function buildTaxLiabilitySummary(
  { from, to }: { from: string; to: string },
  taxType: string,
  namePatterns: RegExp[]
): Promise<{ rows: TaxLedgerRow[]; netTotal: number | null; from: string; to: string }> {
  const dateRange = { fromDate: toTallyActionDate(from), toDate: toTallyActionDate(to) };
  const xml = buildCollectionXml(
    "Ledger",
    [{ name: "NAME" }, { name: "CLOSINGBALANCE", datatype: "amount" }, { name: "TAXTYPE" }],
    [],
    dateRange
  );
  const allRows = extractRecords(await tallyRequest(xml)) as { NAME: string; CLOSINGBALANCE: number; TAXTYPE: string }[];

  const rows: TaxLedgerRow[] = [];
  for (const r of allRows) {
    const isStructural = r.TAXTYPE === taxType;
    const isNamePattern = namePatterns.some((p) => p.test(r.NAME));
    if (!isStructural && !isNamePattern) continue;
    rows.push({
      ledgerName: r.NAME,
      // RCM checked first and kept as its own category, separate from
      // input/output — reverse-charge liability is the thing that's
      // "easily missed manually" (it nets to a wash for most businesses,
      // but still has to be booked on both sides), so an "Input VAT - RCM"
      // ledger getting folded into the generic "input" bucket would bury
      // exactly the exposure this is meant to surface.
      // Word-boundary match anywhere in the name, not just a prefix —
      // confirmed live that real companies name these both ways ("Input
      // CGST" vs "CGST INPUT"/"CGST OUTPUT"), and a prefix-only check
      // silently miscategorized every row as "other" for a company using
      // the suffix style, even though inclusion still worked correctly.
      category: /\brcm\b/i.test(r.NAME) || /reverse\s*charge/i.test(r.NAME)
        ? "rcm"
        : /\binput\b/i.test(r.NAME)
        ? "input"
        : /\boutput\b/i.test(r.NAME)
        ? "output"
        : "other",
      matchMethod: isStructural ? "structural" : "name_pattern",
      closingBalance: r.CLOSINGBALANCE,
    });
  }

  const netTotal = rows.length > 0 ? rows.reduce((sum, r) => sum + (r.closingBalance || 0), 0) : null;
  return { rows, netTotal, from, to };
}

function todayTallyDate(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function createLedgerXml(args: {
  name: string;
  parent: string;
  openingBalance: number;
  oldName?: string;
  maintainBillWise?: boolean;
  trn?: string;
  email?: string;
  website?: string;
  phone?: string;
  mobile?: string;
  billCreditPeriod?: number;
  creditLimit?: number;
  address?: string[];
  state?: string;
  country?: string;
  pincode?: string;
  mailingName?: string;
  addressApplicableFrom?: string;
  extraFields?: Record<string, string>;
}): string {
  const hasAddressFields = !!(args.address?.length || args.state || args.country || args.pincode || args.mailingName);
  return render("create-ledger.xml.njk", {
    ...args,
    addressApplicableFrom: hasAddressFields
      ? args.addressApplicableFrom
        ? args.addressApplicableFrom.split("-").reverse().join("")
        : todayTallyDate()
      : undefined,
  });
}

function deleteMasterXml(collectionTag: string, names: string[]): string {
  return render("delete-master.xml.njk", { collectionTag, names });
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toTallyActionDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split("-");
  return `${parseInt(dd, 10)}-${MONTH_ABBR[parseInt(mm, 10) - 1]}-${yyyy}`;
}

function invokeActionXml(action: string, variables: { name: string; value: string }[]): string {
  return render("invoke-action.xml.njk", { action, variables });
}

type VoucherEntryInput = {
  ledgerName: string;
  amount: number;
  type: "debit" | "credit";
  billName?: string;
  billType?: string;
  costCentre?: string;
  costCategory?: string;
};

function buildVoucherEntries(args: {
  debitLedger?: string;
  creditLedger?: string;
  amount?: number;
  debitBillName?: string;
  debitBillType?: string;
  creditBillName?: string;
  creditBillType?: string;
  debitCostCentre?: string;
  creditCostCentre?: string;
  costCategory?: string;
  entries?: VoucherEntryInput[];
}) {
  if (args.entries?.length) {
    const debitTotal = args.entries.filter((e) => e.type === "debit").reduce((s, e) => s + e.amount, 0);
    const creditTotal = args.entries.filter((e) => e.type === "credit").reduce((s, e) => s + e.amount, 0);
    if (Math.abs(debitTotal - creditTotal) > 0.01) {
      throw new Error(
        `Voucher entries do not balance: debits total ${debitTotal}, credits total ${creditTotal}. Tally requires double-entry balance.`
      );
    }
    return args.entries.map((e) => ({
      ledgerName: e.ledgerName,
      isDeemedPositive: e.type === "debit" ? "Yes" : "No",
      amount: e.type === "debit" ? -e.amount : e.amount,
      billName: e.billName,
      billType: e.billType ?? "New Ref",
      costCentre: e.costCentre,
      costCategory: e.costCategory ?? "Primary Cost Category",
    }));
  }

  if (!args.debitLedger || !args.creditLedger || args.amount === undefined) {
    throw new Error("create_voucher requires either 'entries', or all of debitLedger/creditLedger/amount.");
  }
  return [
    {
      ledgerName: args.debitLedger,
      isDeemedPositive: "Yes",
      amount: -args.amount,
      billName: args.debitBillName,
      billType: args.debitBillType ?? "New Ref",
      costCentre: args.debitCostCentre,
      costCategory: args.costCategory ?? "Primary Cost Category",
    },
    {
      ledgerName: args.creditLedger,
      isDeemedPositive: "No",
      amount: args.amount,
      billName: args.creditBillName,
      billType: args.creditBillType ?? "New Ref",
      costCentre: args.creditCostCentre,
      costCategory: args.costCategory ?? "Primary Cost Category",
    },
  ];
}

function createVoucherXml(args: {
  voucherType: string;
  date: string;
  narration?: string;
  debitLedger?: string;
  creditLedger?: string;
  amount?: number;
  debitBillName?: string;
  debitBillType?: string;
  creditBillName?: string;
  creditBillType?: string;
  debitCostCentre?: string;
  creditCostCentre?: string;
  costCategory?: string;
  entries?: VoucherEntryInput[];
}): string {
  const entries = buildVoucherEntries(args);
  return render("create-voucher.xml.njk", {
    voucherType: args.voucherType,
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    entries,
  });
}

type StockJournalLineInput = {
  stockItem: string;
  qty: number;
  rate: number;
  unit: string;
  godown?: string;
  batchName?: string;
};

function computeStockJournalLines(lines: StockJournalLineInput[]) {
  return lines.map((line) => ({
    ...line,
    amount: line.qty * line.rate,
    batchName: line.batchName ?? "Primary Batch",
  }));
}

type AdditionalCostInput = {
  ledgerName: string;
  amount: number;
  // Tally's own field controlling how this cost is auto-apportioned across
  // multiple destination items in the same voucher — confirmed live via a
  // real Tally-exported Stock Journal template (ADDLALLOCTYPE tag).
  allocationType?: "Appropriate by Value" | "Appropriate by Quantity" | "Not Applicable";
};

function computeAdditionalCosts(costs: AdditionalCostInput[] | undefined) {
  return (costs ?? []).map((cost) => ({
    ...cost,
    allocationType: cost.allocationType ?? "Appropriate by Value",
  }));
}

function createDeliveryNoteXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: (Omit<InvoiceItemInput, "vatLedger" | "vatRatePercent"> & { salesLedger: string })[];
  voucherNumber?: string;
}): string {
  const { items, partyAmount } = computeInvoiceLines(args.items, undefined, undefined);
  return render("create-delivery-note.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    voucherNumber: args.voucherNumber,
  });
}

function updateDeliveryNoteXml(
  args: Parameters<typeof createDeliveryNoteXml>[0] & { voucherNumber: string }
): string {
  const { items, partyAmount } = computeInvoiceLines(args.items, undefined, undefined);
  return render("update-delivery-note.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
  });
}

function createReceiptNoteXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: (Omit<InvoiceItemInput, "vatLedger" | "vatRatePercent"> & { purchaseLedger: string })[];
  voucherNumber?: string;
}): string {
  const { items, partyAmount } = computeInvoiceLines(args.items, undefined, undefined);
  return render("create-receipt-note.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    voucherNumber: args.voucherNumber,
  });
}

function updateReceiptNoteXml(
  args: Parameters<typeof createReceiptNoteXml>[0] & { voucherNumber: string }
): string {
  const { items, partyAmount } = computeInvoiceLines(args.items, undefined, undefined);
  return render("update-receipt-note.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
  });
}

function createSalesOrderXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: (Omit<InvoiceItemInput, "vatLedger" | "vatRatePercent"> & { salesLedger: string; dueDate: string })[];
  orderNumber: string;
  voucherNumber?: string;
}): string {
  const { items, partyAmount } = computeInvoiceLines(args.items, undefined, undefined);
  return render("create-sales-order.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items: items.map((item, i) => ({ ...item, dueDate: toTallyActionDate(args.items[i].dueDate) })),
    partyAmount,
    orderNumber: args.orderNumber,
    voucherNumber: args.voucherNumber,
  });
}

function updateSalesOrderXml(
  args: Parameters<typeof createSalesOrderXml>[0] & { voucherNumber: string }
): string {
  const { items, partyAmount } = computeInvoiceLines(args.items, undefined, undefined);
  return render("update-sales-order.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items: items.map((item, i) => ({ ...item, dueDate: toTallyActionDate(args.items[i].dueDate) })),
    partyAmount,
    orderNumber: args.orderNumber,
  });
}

function createSalesQuotationXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: (Omit<InvoiceItemInput, "vatLedger" | "vatRatePercent"> & { salesLedger: string; dueDate: string })[];
  orderNumber: string;
  voucherNumber?: string;
}): string {
  const { items, partyAmount } = computeInvoiceLines(args.items, undefined, undefined);
  return render("create-sales-quotation.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items: items.map((item, i) => ({ ...item, dueDate: toTallyActionDate(args.items[i].dueDate) })),
    partyAmount,
    orderNumber: args.orderNumber,
    voucherNumber: args.voucherNumber,
  });
}

function updateSalesQuotationXml(
  args: Parameters<typeof createSalesQuotationXml>[0] & { voucherNumber: string }
): string {
  const { items, partyAmount } = computeInvoiceLines(args.items, undefined, undefined);
  return render("update-sales-quotation.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items: items.map((item, i) => ({ ...item, dueDate: toTallyActionDate(args.items[i].dueDate) })),
    partyAmount,
    orderNumber: args.orderNumber,
  });
}

type JobWorkComponentInput = {
  stockItem: string;
  qty: number;
  rate: number;
  unit: string;
  godown?: string;
  batchName?: string;
};

type JobWorkItemInput = {
  stockItem: string;
  qty: number;
  rate: number;
  unit: string;
  dueDate: string;
  godown?: string;
  batchName?: string;
  components: JobWorkComponentInput[];
};

function computeJobWorkItems(items: JobWorkItemInput[], dueDates: string[]) {
  return items.map((item, i) => ({
    ...item,
    amount: item.qty * item.rate,
    batchName: item.batchName ?? "Primary Batch",
    dueDate: dueDates[i],
    components: item.components.map((c) => ({
      ...c,
      amount: c.qty * c.rate,
      batchName: c.batchName ?? "Primary Batch",
    })),
  }));
}

function createJobWorkInOrderXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: JobWorkItemInput[];
  orderNumber: string;
  voucherNumber?: string;
}): string {
  const items = computeJobWorkItems(
    args.items,
    args.items.map((i) => toTallyActionDate(i.dueDate))
  );
  return render("create-job-work-in-order.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    totalAmount: items.reduce((s, i) => s + i.amount, 0),
    orderNumber: args.orderNumber,
    voucherNumber: args.voucherNumber,
  });
}

function createJobWorkOutOrderXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: JobWorkItemInput[];
  orderNumber: string;
  voucherNumber?: string;
}): string {
  const items = computeJobWorkItems(
    args.items,
    args.items.map((i) => toTallyActionDate(i.dueDate))
  );
  return render("create-job-work-out-order.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    totalAmount: items.reduce((s, i) => s + i.amount, 0),
    orderNumber: args.orderNumber,
    voucherNumber: args.voucherNumber,
  });
}

function updateJobWorkInOrderXml(
  args: Parameters<typeof createJobWorkInOrderXml>[0] & { voucherNumber: string }
): string {
  const items = computeJobWorkItems(
    args.items,
    args.items.map((i) => toTallyActionDate(i.dueDate))
  );
  return render("update-job-work-in-order.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    totalAmount: items.reduce((s, i) => s + i.amount, 0),
    orderNumber: args.orderNumber,
  });
}

function updateJobWorkOutOrderXml(
  args: Parameters<typeof createJobWorkOutOrderXml>[0] & { voucherNumber: string }
): string {
  const items = computeJobWorkItems(
    args.items,
    args.items.map((i) => toTallyActionDate(i.dueDate))
  );
  return render("update-job-work-out-order.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    totalAmount: items.reduce((s, i) => s + i.amount, 0),
    orderNumber: args.orderNumber,
  });
}

function createPurchaseOrderXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: (Omit<InvoiceItemInput, "vatLedger" | "vatRatePercent"> & { purchaseLedger: string; dueDate: string })[];
  orderNumber: string;
  voucherNumber?: string;
}): string {
  const { items, partyAmount } = computeInvoiceLines(args.items, undefined, undefined);
  return render("create-purchase-order.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items: items.map((item, i) => ({ ...item, dueDate: toTallyActionDate(args.items[i].dueDate) })),
    partyAmount,
    orderNumber: args.orderNumber,
    voucherNumber: args.voucherNumber,
  });
}

function updatePurchaseOrderXml(
  args: Parameters<typeof createPurchaseOrderXml>[0] & { voucherNumber: string }
): string {
  const { items, partyAmount } = computeInvoiceLines(args.items, undefined, undefined);
  return render("update-purchase-order.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items: items.map((item, i) => ({ ...item, dueDate: toTallyActionDate(args.items[i].dueDate) })),
    partyAmount,
    orderNumber: args.orderNumber,
  });
}

function createStockJournalXml(args: {
  date: string;
  narration?: string;
  sources: StockJournalLineInput[];
  destinations: StockJournalLineInput[];
  additionalCosts?: AdditionalCostInput[];
  voucherNumber?: string;
  // Defaults to plain "Stock Journal". Pass the name of a voucher type created
  // via create_voucher_type with useAsManufacturingJournal to post against a
  // real Manufacturing Journal instead — same XML shape either way.
  voucherType?: string;
}): string {
  const { date, narration, sources, destinations, additionalCosts, voucherNumber, voucherType } = args;
  return render("create-stock-journal.xml.njk", {
    tallyDate: date.split("-").reverse().join(""),
    narration: narration ?? "",
    sources: computeStockJournalLines(sources),
    destinations: computeStockJournalLines(destinations),
    additionalCosts: computeAdditionalCosts(additionalCosts),
    voucherNumber,
    voucherType: voucherType ?? "Stock Journal",
  });
}

function updateStockJournalXml(
  args: Parameters<typeof createStockJournalXml>[0] & { voucherNumber: string }
): string {
  const { date, narration, sources, destinations, additionalCosts, voucherNumber, voucherType } = args;
  return render("update-stock-journal.xml.njk", {
    tallyDate: date.split("-").reverse().join(""),
    voucherNumber,
    narration: narration ?? "",
    sources: computeStockJournalLines(sources),
    destinations: computeStockJournalLines(destinations),
    additionalCosts: computeAdditionalCosts(additionalCosts),
    voucherType: voucherType ?? "Stock Journal",
  });
}

type MaterialMoveItemInput = {
  stockItem: string;
  qty: number;
  rate: number;
  unit: string;
  godown?: string;
  batchName?: string;
};

function computeMaterialMoveItems(items: MaterialMoveItemInput[]) {
  return items.map((item) => ({
    ...item,
    amount: item.qty * item.rate,
    batchName: item.batchName ?? "Primary Batch",
  }));
}

function createMaterialInXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: MaterialMoveItemInput[];
  voucherNumber?: string;
}): string {
  const computedItems = computeMaterialMoveItems(args.items);
  return render("create-material-in.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items: computedItems,
    totalAmount: computedItems.reduce((s, i) => s + i.amount, 0),
    voucherNumber: args.voucherNumber,
  });
}

function createMaterialOutXml(args: Parameters<typeof createMaterialInXml>[0]): string {
  const computedItems = computeMaterialMoveItems(args.items);
  return render("create-material-out.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items: computedItems,
    totalAmount: computedItems.reduce((s, i) => s + i.amount, 0),
    voucherNumber: args.voucherNumber,
  });
}

function updateMaterialInXml(
  args: Parameters<typeof createMaterialInXml>[0] & { voucherNumber: string }
): string {
  const computedItems = computeMaterialMoveItems(args.items);
  return render("update-material-in.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items: computedItems,
    totalAmount: computedItems.reduce((s, i) => s + i.amount, 0),
  });
}

function updateMaterialOutXml(args: Parameters<typeof updateMaterialInXml>[0]): string {
  const computedItems = computeMaterialMoveItems(args.items);
  return render("update-material-out.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items: computedItems,
    totalAmount: computedItems.reduce((s, i) => s + i.amount, 0),
  });
}

function createRejectionsInXml(args: {
  date: string;
  narration?: string;
  items: MaterialMoveItemInput[];
  voucherNumber?: string;
}): string {
  return render("create-rejections-in.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    items: computeMaterialMoveItems(args.items),
    voucherNumber: args.voucherNumber,
  });
}

function createRejectionsOutXml(args: Parameters<typeof createRejectionsInXml>[0]): string {
  return render("create-rejections-out.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    items: computeMaterialMoveItems(args.items),
    voucherNumber: args.voucherNumber,
  });
}

function updateRejectionsInXml(
  args: Parameters<typeof createRejectionsInXml>[0] & { voucherNumber: string }
): string {
  return render("update-rejections-in.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    items: computeMaterialMoveItems(args.items),
  });
}

function updateRejectionsOutXml(args: Parameters<typeof updateRejectionsInXml>[0]): string {
  return render("update-rejections-out.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    items: computeMaterialMoveItems(args.items),
  });
}

type PhysicalStockItemInput = {
  stockItem: string;
  actualQty: number;
  unit: string;
  godown?: string;
  batchName?: string;
};

function createPhysicalStockXml(args: {
  date: string;
  narration?: string;
  items: PhysicalStockItemInput[];
  voucherNumber?: string;
}): string {
  return render("create-physical-stock.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    items: args.items.map((item) => ({ ...item, batchName: item.batchName ?? "Primary Batch" })),
    voucherNumber: args.voucherNumber,
  });
}

function updatePhysicalStockXml(
  args: Parameters<typeof createPhysicalStockXml>[0] & { voucherNumber: string }
): string {
  return render("update-physical-stock.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    items: args.items.map((item) => ({ ...item, batchName: item.batchName ?? "Primary Batch" })),
  });
}

type InvoiceItemInput = {
  stockItem: string;
  qty: number;
  rate: number;
  unit: string;
  godown?: string;
  batchName?: string;
  discountPercent?: number;
  vatLedger?: string;
  vatRatePercent?: number;
};

function computeInvoiceLines(
  items: InvoiceItemInput[],
  defaultVatLedger: string | undefined,
  defaultVatRatePercent: number | undefined
) {
  for (const item of items) {
    if (item.vatLedger && item.vatRatePercent === undefined) {
      throw new Error(`Item '${item.stockItem}': vatRatePercent is required when vatLedger is set on an item.`);
    }
  }
  if (defaultVatLedger && defaultVatRatePercent === undefined) {
    throw new Error("vatRatePercent is required when vatLedger is set.");
  }

  const computedItems = items.map((item) => {
    const gross = item.qty * item.rate;
    const discounted = item.discountPercent ? gross * (1 - item.discountPercent / 100) : gross;
    return {
      ...item,
      amount: Math.round(discounted * 100) / 100,
      batchName: item.batchName ?? "Primary Batch",
    };
  });
  const netTotal = computedItems.reduce((s, i) => s + i.amount, 0);

  const groups = new Map<string, { vatLedger: string; vatRatePercent: number; netAmount: number }>();
  for (const item of computedItems) {
    const ledger = item.vatLedger ?? defaultVatLedger;
    const rate = item.vatRatePercent ?? defaultVatRatePercent;
    if (!ledger) continue;
    const key = `${ledger}::${rate}`;
    const g = groups.get(key) ?? { vatLedger: ledger, vatRatePercent: rate!, netAmount: 0 };
    g.netAmount += item.amount;
    groups.set(key, g);
  }
  const taxGroups = [...groups.values()].map((g) => ({
    vatLedger: g.vatLedger,
    vatRatePercent: g.vatRatePercent,
    vatAmount: Math.round(g.netAmount * (g.vatRatePercent / 100) * 100) / 100,
  }));
  const totalVat = taxGroups.reduce((s, g) => s + g.vatAmount, 0);
  const partyAmount = Math.round((netTotal + totalVat) * 100) / 100;

  return { items: computedItems, taxGroups, partyAmount };
}

function createSalesInvoiceXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: (InvoiceItemInput & { salesLedger: string })[];
  vatLedger?: string;
  vatRatePercent?: number;
  billName?: string;
  billType?: string;
  voucherNumber?: string;
}): string {
  const { items, taxGroups, partyAmount } = computeInvoiceLines(args.items, args.vatLedger, args.vatRatePercent);
  return render("create-sales-invoice.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    taxGroups,
    billName: args.billName,
    billType: args.billType ?? "New Ref",
    voucherNumber: args.voucherNumber,
  });
}

function createPurchaseInvoiceXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: (InvoiceItemInput & { purchaseLedger: string })[];
  vatLedger?: string;
  vatRatePercent?: number;
  billName?: string;
  billType?: string;
  voucherNumber?: string;
}): string {
  const { items, taxGroups, partyAmount } = computeInvoiceLines(args.items, args.vatLedger, args.vatRatePercent);
  return render("create-purchase-invoice.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    taxGroups,
    billName: args.billName,
    billType: args.billType ?? "New Ref",
    voucherNumber: args.voucherNumber,
  });
}

function createCreditNoteXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: (InvoiceItemInput & { salesLedger: string })[];
  vatLedger?: string;
  vatRatePercent?: number;
  billName?: string;
  billType?: string;
  voucherNumber?: string;
}): string {
  const { items, taxGroups, partyAmount } = computeInvoiceLines(args.items, args.vatLedger, args.vatRatePercent);
  return render("create-credit-note.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    taxGroups,
    billName: args.billName,
    billType: args.billType ?? "Agst Ref",
    voucherNumber: args.voucherNumber,
  });
}

function createDebitNoteXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: (InvoiceItemInput & { purchaseLedger: string })[];
  vatLedger?: string;
  vatRatePercent?: number;
  billName?: string;
  billType?: string;
  voucherNumber?: string;
}): string {
  const { items, taxGroups, partyAmount } = computeInvoiceLines(args.items, args.vatLedger, args.vatRatePercent);
  return render("create-debit-note.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    taxGroups,
    billName: args.billName,
    billType: args.billType ?? "Agst Ref",
    voucherNumber: args.voucherNumber,
  });
}

function updateSalesInvoiceXml(
  args: Parameters<typeof createSalesInvoiceXml>[0] & { voucherNumber: string }
): string {
  const { items, taxGroups, partyAmount } = computeInvoiceLines(args.items, args.vatLedger, args.vatRatePercent);
  return render("update-sales-invoice.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    taxGroups,
    billName: args.billName,
    billType: args.billType ?? "New Ref",
  });
}

function updatePurchaseInvoiceXml(
  args: Parameters<typeof createPurchaseInvoiceXml>[0] & { voucherNumber: string }
): string {
  const { items, taxGroups, partyAmount } = computeInvoiceLines(args.items, args.vatLedger, args.vatRatePercent);
  return render("update-purchase-invoice.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    taxGroups,
    billName: args.billName,
    billType: args.billType ?? "New Ref",
  });
}

function updateCreditNoteXml(
  args: Parameters<typeof createCreditNoteXml>[0] & { voucherNumber: string }
): string {
  const { items, taxGroups, partyAmount } = computeInvoiceLines(args.items, args.vatLedger, args.vatRatePercent);
  return render("update-credit-note.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    taxGroups,
    billName: args.billName,
    billType: args.billType ?? "Agst Ref",
  });
}

function updateDebitNoteXml(
  args: Parameters<typeof createDebitNoteXml>[0] & { voucherNumber: string }
): string {
  const { items, taxGroups, partyAmount } = computeInvoiceLines(args.items, args.vatLedger, args.vatRatePercent);
  return render("update-debit-note.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    voucherNumber: args.voucherNumber,
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    taxGroups,
    billName: args.billName,
    billType: args.billType ?? "Agst Ref",
  });
}

// "Primary" is the conceptual root of Tally's group/stock-group hierarchy,
// not a real master record — passing it literally as PARENT throws
// "Group 'Primary' does not exist!" (confirmed live). An empty PARENT tag
// is what actually means "top level" to Tally's import.
function normalizeParent(parent: string): string {
  return parent.trim().toLowerCase() === "primary" ? "" : parent;
}

function createGroupXml(name: string, parent: string, oldName?: string): string {
  return render("create-group.xml.njk", { name, parent: normalizeParent(parent), oldName });
}

function createStockGroupXml(name: string, parent: string): string {
  return render("create-stock-group.xml.njk", { name, parent: normalizeParent(parent) });
}

function createUnitXml(args: {
  symbol: string;
  formalName?: string;
  decimalPlaces?: number;
  baseUnit?: string;
  additionalUnit?: string;
  conversion?: number;
}): string {
  if (args.baseUnit && (!args.additionalUnit || !args.conversion)) {
    throw new Error("additionalUnit and conversion are both required when baseUnit is set (compound unit).");
  }
  // Confirmed live: Tally rejects a simple unit's SYMBOL/NAME containing whitespace
  // with "Master name contains invalid characters" — but a compound unit's own
  // NAME (e.g. "Box of 12 Nos") is unaffected; only the simple units it references
  // (baseUnit/additionalUnit) need to be space-free, since those are real SYMBOLs.
  const namesToCheck = args.baseUnit ? [args.baseUnit, args.additionalUnit as string] : [args.symbol];
  for (const name of namesToCheck) {
    if (/\s/.test(name)) {
      throw new Error(
        `Unit symbol "${name}" contains whitespace — Tally rejects this with "Master name contains invalid ` +
          `characters" for a simple unit's symbol (confirmed live). Use a space-free symbol, e.g. "Box" or ` +
          `"Nos", not "Box Unit". A compound unit's own display name (the 'symbol' argument when baseUnit is ` +
          `set) can still contain spaces, e.g. "Box of 12 Nos" — only the simple units it references cannot.`
      );
    }
  }
  return render("create-unit.xml.njk", {
    symbol: args.symbol,
    formalName: args.formalName,
    decimalPlaces: args.decimalPlaces ?? 0,
    baseUnit: args.baseUnit,
    additionalUnit: args.additionalUnit,
    conversion: args.conversion,
  });
}

function createGodownXml(name: string, parent?: string): string {
  return render("create-godown.xml.njk", { name, parent: parent ? normalizeParent(parent) : undefined });
}

function createCostCategoryXml(args: { name: string; allocateToRevenue?: boolean; allocateToNonRevenue?: boolean }): string {
  return render("create-cost-category.xml.njk", {
    name: args.name,
    allocateToRevenue: args.allocateToRevenue ?? true,
    allocateToNonRevenue: args.allocateToNonRevenue ?? true,
  });
}

function createCostCentreXml(args: { name: string; category?: string; parent?: string }): string {
  return render("create-cost-centre.xml.njk", args);
}

function createVoucherTypeXml(args: {
  name: string;
  oldName?: string;
  parent: string;
  numberingMethod?: string;
  abbreviation?: string;
  preventDuplicates?: boolean;
  // Tally's flag (confirmed live via a real Tally-exported voucher type template)
  // that marks this voucher type as a Manufacturing Journal — same underlying
  // Stock Journal XML shape, but reported/labelled distinctly in Tally.
  useAsManufacturingJournal?: boolean;
  extraFields?: Record<string, string>;
}): string {
  return render("create-voucher-type.xml.njk", args);
}

function updateStockItemXml(args: {
  name: string;
  group?: string;
  unit?: string;
  description?: string;
  rateOfVat?: number;
  ignoreNegativeStock?: boolean;
  extraFields?: Record<string, string>;
}): string {
  return render("update-stock-item.xml.njk", {
    ...args,
    group: args.group ? normalizeParent(args.group) : undefined,
  });
}

type BomComponentInput = {
  stockItem: string;
  qty: number;
  unit: string;
  natureOfItem?: string;
  godown?: string;
};

function setBillOfMaterialsXml(args: {
  stockItem: string;
  componentListName?: string;
  basicQty?: number;
  unit?: string;
  components: BomComponentInput[];
}): string {
  return render("set-bill-of-materials.xml.njk", {
    stockItem: args.stockItem,
    componentListName: args.componentListName ?? "Primary",
    basicQty: args.basicQty ?? 1,
    unit: args.unit ?? "",
    components: args.components.map((c) => ({ ...c, natureOfItem: c.natureOfItem ?? "Component" })),
  });
}

function deleteStockItemXml(name: string): string {
  // A hand-rolled template that omitted the <NAME> child element (only had
  // the NAME attribute) reproducibly hung Tally's gateway on delete
  // (confirmed live, twice, against a real existing item — required manually
  // reopening Tally both times). delete_master's template always includes
  // the child tag and is proven safe, so reuse it instead of a divergent one.
  return deleteMasterXml("STOCKITEM", [name]);
}

function updateVoucherXml(args: {
  voucherType: string;
  voucherNumber: string;
  date: string;
  narration?: string;
  debitLedger?: string;
  creditLedger?: string;
  amount?: number;
  debitCostCentre?: string;
  creditCostCentre?: string;
  costCategory?: string;
  entries?: VoucherEntryInput[];
}): string {
  const entries = buildVoucherEntries(args);
  return render("update-voucher.xml.njk", {
    voucherType: args.voucherType,
    voucherNumber: args.voucherNumber,
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    entries,
  });
}

function deleteVoucherXml(voucherType: string, voucherNumber: string, date: string): string {
  return render("delete-voucher.xml.njk", {
    voucherType,
    voucherNumber,
    tallyDate: date.split("-").reverse().join(""),
  });
}

function createStockItemXml(args: {
  name: string;
  group: string;
  unit: string;
  openingBalance: number;
  openingRate: number;
  description?: string;
  rateOfVat?: number;
  ignoreNegativeStock?: boolean;
  extraFields?: Record<string, string>;
}): string {
  const { name, group, unit, openingBalance, openingRate, description, rateOfVat, ignoreNegativeStock, extraFields } =
    args;
  return render("create-stock-item.xml.njk", {
    name,
    group: normalizeParent(group),
    unit,
    openingBalance,
    openingRate,
    openingValue: openingBalance * openingRate,
    description,
    rateOfVat,
    ignoreNegativeStock,
    extraFields,
  });
}

function ledgerVouchersXml(ledgerName: string, from: string, to: string): string {
  return render("ledger-vouchers.xml.njk", {
    ledgerName,
    fromDate: toTallyActionDate(from),
    toDate: toTallyActionDate(to),
  });
}

function vouchersByDateXml(date: string): string {
  const tallyDate = toTallyActionDate(date);
  return render("vouchers-by-date.xml.njk", { fromDate: tallyDate, toDate: tallyDate });
}

// Tally's Alter/Delete lookup (TAGNAME="Voucher Number"/TAGVALUE) matches by
// date+number ONLY — it does not scope by the VCHTYPE attribute (confirmed
// live: altering "Purchase" #4 instead hit an unrelated pre-existing "Sales"
// #4 on the same date, converting it to Purchase and corrupting it). Since
// each voucher type numbers independently, the same (date, number) commonly
// exists under more than one type. Refuse the operation whenever that's the
// case rather than risk Tally silently picking the wrong voucher.
async function assertVoucherUnambiguous(voucherType: string, voucherNumber: string, date: string): Promise<void> {
  const xml = vouchersByDateXml(date);
  const result = await tallyRequest(xml);
  const rows = extractRecords(result) as { VOUCHER_TYPE?: string; VOUCHER_NUMBER?: string | number }[];
  const matches = rows.filter((r) => String(r.VOUCHER_NUMBER ?? "").trim() === String(voucherNumber).trim());

  if (matches.length === 0) {
    throw new Error(
      `No voucher numbered "${voucherNumber}" found on ${date} (any type) — check the number and date with ` +
        `get_vouchers or get_ledger_vouchers first.`
    );
  }

  const distinctTypes = [...new Set(matches.map((m) => m.VOUCHER_TYPE))];
  if (distinctTypes.length > 1) {
    throw new Error(
      `Refusing to Alter/Delete: voucher number "${voucherNumber}" on ${date} exists under more than one voucher ` +
        `type (${distinctTypes.join(", ")}). Tally's XML gateway does not scope this lookup by voucher type, so it ` +
        `can silently hit the wrong one and corrupt it (confirmed live). Resolve the collision manually in Tally ` +
        `(renumber one of them) before retrying, or edit/delete this voucher directly in Tally's UI instead.`
    );
  }

  if (distinctTypes[0] !== voucherType) {
    throw new Error(
      `Voucher number "${voucherNumber}" on ${date} exists only as type "${distinctTypes[0]}", not "${voucherType}" ` +
        `as requested — check the voucherType argument.`
    );
  }
}

function checkImportResult(result: unknown): string {
  const cleaned = cleanTallyResult(result) as any;
  const created = cleaned?.ENVELOPE?.HEADER?.CREATED ?? cleaned?.ENVELOPE?.BODY?.DATA?.CREATED;
  const errors = cleaned?.ENVELOPE?.HEADER?.ERRORS ?? cleaned?.ENVELOPE?.BODY?.DATA?.ERRORS;
  const exceptions = cleaned?.ENVELOPE?.HEADER?.EXCEPTIONS;

  if (errors && Number(errors) > 0) {
    return `Failed. Tally reported ${errors} error(s). Raw response: ${JSON.stringify(cleaned)}`;
  }
  if (exceptions && Number(exceptions) > 0) {
    return `Completed with ${exceptions} exception(s). Raw response: ${JSON.stringify(cleaned)}`;
  }
  return `Success. Created: ${created ?? "unknown"}. Raw response: ${JSON.stringify(cleaned, null, 2)}`;
}

export async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "get_ledgers": {
      const xml = buildCollectionXml("Ledger", [
        { name: "NAME" },
        {
          name: "PARENT",
          expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "Reserves & Surplus" else $Parent',
        },
        { name: "CLOSINGBALANCE", datatype: "amount" },
      ]);
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_stock_items": {
      const xml = buildCollectionXml("Stock Item", [
        { name: "NAME" },
        { name: "PARENT" },
        { name: "CLOSINGBALANCE", datatype: "quantity" },
      ]);
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_vouchers": {
      // Was built on Tally's canned "Day Book" REPORTNAME — confirmed live
      // that it silently ignores SVFROMDATE/SVTODATE entirely, always
      // returning the same fixed set regardless of the requested range (even
      // a date a year before the company's books start returned the same
      // count as the full financial year). Rebuilt on the same style of
      // Voucher collection query sync_vouchers_to_sql already uses and
      // trusts, which does respect the date range (confirmed live) — same
      // field set (date, voucher_type, voucher_number, party_ledger,
      // amount, narration), a flat row list instead of Tally's raw nested
      // voucher XML dump. Uses its own template, not sync-vouchers.xml.njk
      // directly: that one has a FilterExcludeOrderVch filter (deliberate,
      // for the SQL cache's accounting-reconciliation use case) that would
      // silently hide Sales/Purchase Order vouchers from a general-purpose
      // Day Book replacement — this tool's job is to show every voucher in
      // range, so Order-class vouchers stay included here.
      const { from, to } = args as { from: string; to: string };
      const xml = render("vouchers-in-range.xml.njk", {
        fromDate: toTallyActionDate(from),
        toDate: toTallyActionDate(to),
      });
      const result = await tallyRequest(xml);
      const rows = extractRecords(result) as Record<string, unknown>[];
      return JSON.stringify({ rows }, null, 2);
    }

    case "get_company_info": {
      // "Company" is a UI form in Tally's TDL, not an exportable report —
      // requesting it via REPORTNAME throws "Error in TDL. 'Form:Company'
      // No 'PARTS'!". The company object is fetched as a COLLECTION instead.
      // Filtered to the current company only — confirmed live that with more
      // than one Tally company open simultaneously, an unfiltered Company
      // collection query returns ALL open companies as an array, not just
      // the active one, which silently broke this tool's single-object shape.
      const xml = buildCollectionXml(
        "Company",
        [
          { name: "NAME" },
          { name: "ADDRESS", expression: 'if $$IsEmpty:$Address then "" else $$FullList:Address:$Address' },
          { name: "STATENAME" },
          { name: "COUNTRYNAME" },
          { name: "PINCODE" },
          { name: "PHONENUMBER" },
          { name: "EMAIL" },
          { name: "BOOKSFROM", datatype: "date" },
        ],
        [{ name: "OnlyCurrent", expression: "$$IsEqual:$Name:##SVCurrentCompany" }]
      );
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_profit_and_loss": {
      // TallyPrime does not expose a canned "Profit and Loss A/c" REPORTNAME
      // over the XML gateway (confirmed live: "Unknown Request, cannot be
      // processed") — the statement is built from the Ledger collection
      // (filtered to revenue/expense ledgers via $IsRevenue) plus the
      // Stock-in-Hand group's opening/closing value, mirroring how Tally's
      // own P&L UI report is composed internally.
      const { from, to } = args as { from: string; to: string };
      const dateRange = { fromDate: toTallyActionDate(from), toDate: toTallyActionDate(to) };

      const ledgerXml = buildCollectionXml(
        "Ledger",
        [
          { name: "NAME" },
          { name: "PARENT" },
          { name: "CLOSINGBALANCE", datatype: "amount" },
        ],
        [{ name: "PLGroup", expression: "$IsRevenue" }],
        dateRange
      );
      const ledgerRows = extractRecords(await tallyRequest(ledgerXml)) as {
        NAME: string;
        PARENT: string;
        CLOSINGBALANCE: number;
      }[];

      const stockXml = buildCollectionXml(
        "Group",
        [
          { name: "NAME" },
          { name: "OPENINGBALANCE", datatype: "amount" },
          { name: "CLOSINGBALANCE", datatype: "amount" },
        ],
        [{ name: "StockGroup", expression: '$$IsEqual:$Name:"Stock-in-Hand"' }],
        dateRange
      );
      const stockRows = extractRecords(await tallyRequest(stockXml)) as {
        NAME: string;
        OPENINGBALANCE: number;
        CLOSINGBALANCE: number;
      }[];

      const rows = ledgerRows.map((r) => ({
        ledgerName: r.NAME,
        groupName: r.PARENT,
        closingBalance: r.CLOSINGBALANCE,
      }));
      if (stockRows.length > 0) {
        rows.push(
          { ledgerName: "Opening Stock", groupName: "Stock-in-Hand", closingBalance: stockRows[0].OPENINGBALANCE },
          { ledgerName: "Closing Stock", groupName: "Stock-in-Hand", closingBalance: -stockRows[0].CLOSINGBALANCE }
        );
      }
      try {
        await cacheProfitAndLoss(rows, from, to);
      } catch {
        // Caching is a convenience layer for later SQL queries — never let it
        // block returning the actual P&L result.
      }
      return JSON.stringify({ rows }, null, 2);
    }

    case "get_balance_sheet": {
      const { asOf } = args as { asOf: string };
      const xml = reportXml("Balance Sheet", { SVFROMDATE: asOf, SVTODATE: asOf });
      const result = await tallyRequest(xml);
      const cleaned = cleanTallyResult(result) as any;
      try {
        // Tally's Balance Sheet export shape: two parallel top-level arrays
        // matched only by index position, not key-value pairs (confirmed
        // live) — never zip them if lengths disagree, since that would
        // silently pair the wrong name with the wrong amount.
        const names = cleaned?.ENVELOPE?.BSNAME;
        const amounts = cleaned?.ENVELOPE?.BSAMT;
        if (Array.isArray(names) && Array.isArray(amounts) && names.length === amounts.length) {
          const rows = names.map((n: any, i: number) => ({
            groupName: n?.DSPACCNAME?.DSPDISPNAME ?? null,
            amount: amounts[i]?.BSMAINAMT ?? amounts[i]?.BSSUBAMT ?? null,
          }));
          await cacheBalanceSheet(rows, asOf);
        }
      } catch {
        // Caching is a convenience layer — never let it block returning the actual Balance Sheet result.
      }
      return JSON.stringify(cleaned, null, 2);
    }

    case "get_trial_balance": {
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Trial Balance", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      const cleaned = cleanTallyResult(result) as any;
      try {
        // Trial Balance's export shape is different again from Balance
        // Sheet's (DSPACCNAME/DSPACCINFO, not BSNAME/BSAMT) — same
        // length-mismatch guard applies.
        const names = cleaned?.ENVELOPE?.DSPACCNAME;
        const info = cleaned?.ENVELOPE?.DSPACCINFO;
        if (Array.isArray(names) && Array.isArray(info) && names.length === info.length) {
          const rows = names.map((n: any, i: number) => ({
            name: n?.DSPDISPNAME ?? null,
            debitAmount: info[i]?.DSPCLDRAMT?.DSPCLDRAMTA ?? null,
            creditAmount: info[i]?.DSPCLCRAMT?.DSPCLCRAMTA ?? null,
          }));
          await cacheTrialBalance(rows, from, to);
        }
      } catch {
        // Caching is a convenience layer — never let it block returning the actual Trial Balance result.
      }
      return JSON.stringify(cleaned, null, 2);
    }

    case "get_groups": {
      const xml = buildCollectionXml("Group", [
        { name: "NAME" },
        { name: "PARENT", expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent' },
      ]);
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_voucher_types": {
      const xml = buildCollectionXml("Voucher Type", [{ name: "NAME" }, { name: "PARENT" }]);
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_cost_centres": {
      const xml = buildCollectionXml("Cost Centre", [{ name: "NAME" }, { name: "PARENT" }]);
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_stock_summary": {
      // Same issue as get_profit_and_loss: "Stock Summary" is not a valid
      // REPORTNAME over the gateway (confirmed live: "Unknown Request").
      // Built from the StockItem collection instead, following the same
      // as-of convention already used by get_balance_sheet/get_bills_payable
      // (SVFROMDATE == SVTODATE == the given date).
      const { asOf } = args as { asOf: string };
      const dateRange = { fromDate: toTallyActionDate(asOf), toDate: toTallyActionDate(asOf) };
      const xml = buildCollectionXml(
        "Stock Item",
        [
          { name: "NAME" },
          { name: "PARENT", expression: 'if $$IsEqual:$Parent:$$SysName:Primary then "" else $Parent' },
          { name: "OPENINGBALANCE", datatype: "quantity" },
          { name: "CLOSINGBALANCE", datatype: "quantity" },
          { name: "OPENINGVALUE", datatype: "amount" },
          { name: "CLOSINGVALUE", datatype: "amount" },
        ],
        [],
        dateRange
      );
      const rows = extractRecords(await tallyRequest(xml)) as Record<string, unknown>[];
      try {
        await cacheStockSummary(rows, asOf);
      } catch {
        // Caching is a convenience layer for later SQL queries — never let it
        // block returning the actual Stock Summary result.
      }
      return JSON.stringify({ rows }, null, 2);
    }

    case "get_bills_receivable": {
      const { asOf } = args as { asOf: string };
      const xml = reportXml("Bills Receivable", { SVFROMDATE: asOf, SVTODATE: asOf });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_bills_payable": {
      const { asOf } = args as { asOf: string };
      const xml = reportXml("Bills Payable", { SVFROMDATE: asOf, SVTODATE: asOf });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_cash_flow": {
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Cash Flow", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_funds_flow": {
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Funds Flow", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_ratio_analysis": {
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Ratio Analysis", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_sales_register": {
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Sales Register", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_purchase_register": {
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Purchase Register", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_journal_register": {
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Journal Register", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_payment_register": {
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Payment Register", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_receipts_and_payments": {
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Receipts and Payments", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_reorder_status": {
      // Tally returns every stock item here, not just reorder-configured
      // ones — confirmed live on a 10,770-item company with zero reorder
      // levels set up: the raw response was a ~1.4MB dump of all-null rows.
      // Tally itself doesn't filter server-side, so this does it client-side
      // to only the rows that actually have a reorder level configured
      // (ROSORDLVL non-null) — that's the only subset this report can
      // usefully answer anything about.
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Reorder Status", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      const cleaned = cleanTallyResult(result) as any;
      const e = cleaned?.ENVELOPE;
      if (e && Array.isArray(e.ROSNAME) && Array.isArray(e.ROSORDLVL)) {
        const rows = e.ROSNAME.map((name: string, i: number) => ({
          stockItem: name,
          closingStock: e.ROSCLSTOCK?.[i] ?? null,
          onPurchaseOrder: e.ROSONPURCORDER?.[i] ?? null,
          onSaleOrder: e.ROSONSALEORDER?.[i] ?? null,
          reorderLevel: e.ROSORDLVL?.[i] ?? null,
          shortfall: e.ROSSHORTFALL?.[i] ?? null,
          minimumQty: e.ROSMINQTY?.[i] ?? null,
          requiredQty: e.ROSREQDQTY?.[i] ?? null,
        })).filter((r: any) => r.reorderLevel !== null);
        return JSON.stringify(
          {
            rows,
            note:
              rows.length === 0
                ? "No stock items have a reorder level configured in Tally for this company — this is a " +
                  "genuinely empty result, not an error. Set a reorder level on a stock item in Tally " +
                  "(Alter Stock Item → Reorder Level) for it to appear here."
                : undefined,
          },
          null,
          2
        );
      }
      return JSON.stringify(cleaned, null, 2);
    }

    case "get_vat_liability_summary": {
      // Input/Output can appear before or after the tax name (confirmed
      // live: "Input VAT 5%" and, on another real company, "VAT INPUT"
      // style naming) — match either ordering, not just a prefix.
      const namePatterns = [
        /\binput\b.*vat|vat.*\binput\b/i,
        /\boutput\b.*vat|vat.*\boutput\b/i,
        /vat\s*payable/i,
        /vat\s*receivable/i,
      ];
      const result = await buildTaxLiabilitySummary(args as { from: string; to: string }, "VAT", namePatterns);
      if (result.rows.length === 0) {
        return JSON.stringify(
          {
            rows: [],
            netTotal: null,
            note:
              "No ledgers found tagged Tally's own Type-of-duty/tax as VAT, and none matching Input/Output/" +
              "Payable/Receivable VAT naming. This likely means this company isn't VAT-registered in Tally, or " +
              "uses a genuinely unrecognizable naming convention — it does not mean the VAT liability is zero. " +
              "Check get_groups/get_ledgers for this company's actual tax ledger setup.",
          },
          null,
          2
        );
      }
      try {
        await cacheVatSummary(result.rows, result.from, result.to);
      } catch {
        // Caching is a convenience layer — never let it block returning the actual result.
      }
      return JSON.stringify({ rows: result.rows, netTotal: result.netTotal }, null, 2);
    }

    case "get_gst_liability_summary": {
      // Same either-ordering reasoning as VAT — confirmed live on a real
      // company that uses "CGST INPUT"/"CGST OUTPUT" (suffix style) rather
      // than "Input CGST" (prefix style).
      const namePatterns = [
        /\binput\b.*[cis]gst|[cis]gst.*\binput\b/i,
        /\boutput\b.*[cis]gst|[cis]gst.*\boutput\b/i,
        /gst\s*payable/i,
        /gst\s*receivable/i,
        /gst\s*on\s*rcm/i,
      ];
      const result = await buildTaxLiabilitySummary(args as { from: string; to: string }, "GST", namePatterns);
      if (result.rows.length === 0) {
        return JSON.stringify(
          {
            rows: [],
            netTotal: null,
            note:
              "No ledgers found tagged Tally's own Type-of-duty/tax as GST, and none matching Input/Output " +
              "CGST/SGST/IGST or GST Payable/Receivable naming. This likely means this company isn't " +
              "GST-registered in Tally, or uses a genuinely unrecognizable naming convention — it does not mean " +
              "the GST liability is zero. Check get_groups/get_ledgers for this company's actual tax ledger " +
              "setup. Note: generic expense ledgers that merely mention GST in their name (e.g. a freight " +
              "ledger like 'Transport GST 18%', or 'GST Expenses'/'GST Ineligible' write-off ledgers) are " +
              "deliberately excluded — check those manually if this company has real GST activity elsewhere.",
          },
          null,
          2
        );
      }
      try {
        await cacheGstSummary(result.rows, result.from, result.to);
      } catch {
        // Caching is a convenience layer — never let it block returning the actual result.
      }
      return JSON.stringify({ rows: result.rows, netTotal: result.netTotal }, null, 2);
    }

    case "get_ledger_vouchers": {
      const { ledgerName, from, to } = args as { ledgerName: string; from: string; to: string };
      const xml = ledgerVouchersXml(ledgerName, from, to);
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "create_ledger": {
      const {
        name: ledgerName,
        oldName,
        parent,
        openingBalance,
        maintainBillWise,
        trn,
        email,
        website,
        phone,
        mobile,
        billCreditPeriod,
        creditLimit,
        address,
        state,
        country,
        pincode,
        mailingName,
        addressApplicableFrom,
        extraFields,
      } = args as {
        name: string;
        oldName?: string;
        parent: string;
        openingBalance?: number;
        maintainBillWise?: boolean;
        trn?: string;
        email?: string;
        website?: string;
        phone?: string;
        mobile?: string;
        billCreditPeriod?: number;
        creditLimit?: number;
        address?: string[];
        state?: string;
        country?: string;
        pincode?: string;
        mailingName?: string;
        addressApplicableFrom?: string;
        extraFields?: Record<string, string>;
      };
      const xml = createLedgerXml({
        name: ledgerName,
        parent,
        openingBalance: openingBalance ?? 0,
        oldName,
        maintainBillWise,
        trn,
        email,
        website,
        phone,
        mobile,
        billCreditPeriod,
        creditLimit,
        address,
        state,
        country,
        pincode,
        mailingName,
        addressApplicableFrom,
        extraFields,
      });
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "delete_master": {
      const { collection, names } = args as { collection: string; names: string[] };
      const xml = deleteMasterXml(collection.toUpperCase(), names);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "set_company": {
      const { companyName } = args as { companyName: string };
      const xml = invokeActionXml("ChangeCurrentCompany", [{ name: "SVCurrentCompany", value: companyName }]);
      await tallyRequest(xml);

      // ChangeCurrentCompany silently no-ops if companyName isn't already open in
      // Tally — it does not throw or return any error shape, it just leaves the
      // previous company active. Confirmed live: without this check, this tool
      // would report "OK" while Tally stayed on the old company, and every
      // subsequent read/write in the session would silently target the wrong
      // company's books with nothing to catch it.
      // Filtered to the current company — see get_company_info for why an
      // unfiltered query breaks with more than one Tally company open.
      const checkXml = buildCollectionXml(
        "Company",
        [{ name: "NAME" }],
        [{ name: "OnlyCurrent", expression: "$$IsEqual:$Name:##SVCurrentCompany" }]
      );
      const checkResult = await tallyRequest(checkXml);
      const cleaned = cleanTallyResult(checkResult) as any;
      const activeCompany = cleaned?.DATA?.ROW?.NAME;
      if (activeCompany !== companyName) {
        throw new Error(
          `Tally did not switch to "${companyName}" — it's still on ` +
            `"${activeCompany ?? "(unknown)"}". This usually means "${companyName}" isn't ` +
            `currently open in Tally (only companies already loaded in Tally can be switched to).`
        );
      }
      return JSON.stringify("OK");
    }

    case "set_period": {
      const { from, to } = args as { from: string; to: string };
      const xml = invokeActionXml("Change Period", [
        { name: "SVFromDate", value: toTallyActionDate(from) },
        { name: "SVToDate", value: toTallyActionDate(to) },
      ]);
      await tallyRequest(xml);
      return JSON.stringify("OK");
    }

    case "create_voucher": {
      const voucherArgs = args as {
        voucherType: string;
        date: string;
        narration?: string;
        debitLedger?: string;
        creditLedger?: string;
        amount?: number;
        debitBillName?: string;
        debitBillType?: string;
        creditBillName?: string;
        creditBillType?: string;
        debitCostCentre?: string;
        creditCostCentre?: string;
        costCategory?: string;
        entries?: VoucherEntryInput[];
      };
      const xml = createVoucherXml(voucherArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_sales_invoice": {
      const invoiceArgs = args as Parameters<typeof createSalesInvoiceXml>[0];
      const xml = createSalesInvoiceXml(invoiceArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_sales_invoice": {
      const invoiceArgs = args as Parameters<typeof updateSalesInvoiceXml>[0];
      await assertVoucherUnambiguous("Sales", invoiceArgs.voucherNumber, invoiceArgs.date);
      const xml = updateSalesInvoiceXml(invoiceArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_purchase_invoice": {
      const invoiceArgs = args as Parameters<typeof createPurchaseInvoiceXml>[0];
      const xml = createPurchaseInvoiceXml(invoiceArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_purchase_invoice": {
      const invoiceArgs = args as Parameters<typeof updatePurchaseInvoiceXml>[0];
      await assertVoucherUnambiguous("Purchase", invoiceArgs.voucherNumber, invoiceArgs.date);
      const xml = updatePurchaseInvoiceXml(invoiceArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_credit_note": {
      const noteArgs = args as Parameters<typeof createCreditNoteXml>[0];
      const xml = createCreditNoteXml(noteArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_credit_note": {
      const noteArgs = args as Parameters<typeof updateCreditNoteXml>[0];
      await assertVoucherUnambiguous("Credit Note", noteArgs.voucherNumber, noteArgs.date);
      const xml = updateCreditNoteXml(noteArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_debit_note": {
      const noteArgs = args as Parameters<typeof createDebitNoteXml>[0];
      const xml = createDebitNoteXml(noteArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_debit_note": {
      const noteArgs = args as Parameters<typeof updateDebitNoteXml>[0];
      await assertVoucherUnambiguous("Debit Note", noteArgs.voucherNumber, noteArgs.date);
      const xml = updateDebitNoteXml(noteArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_delivery_note": {
      const noteArgs = args as Parameters<typeof createDeliveryNoteXml>[0];
      const xml = createDeliveryNoteXml(noteArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_delivery_note": {
      const noteArgs = args as Parameters<typeof updateDeliveryNoteXml>[0];
      await assertVoucherUnambiguous("Delivery Note", noteArgs.voucherNumber, noteArgs.date);
      const xml = updateDeliveryNoteXml(noteArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_receipt_note": {
      const noteArgs = args as Parameters<typeof createReceiptNoteXml>[0];
      const xml = createReceiptNoteXml(noteArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_receipt_note": {
      const noteArgs = args as Parameters<typeof updateReceiptNoteXml>[0];
      await assertVoucherUnambiguous("Receipt Note", noteArgs.voucherNumber, noteArgs.date);
      const xml = updateReceiptNoteXml(noteArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_sales_order": {
      const orderArgs = args as Parameters<typeof createSalesOrderXml>[0];
      const xml = createSalesOrderXml(orderArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_sales_order": {
      const orderArgs = args as Parameters<typeof updateSalesOrderXml>[0];
      await assertVoucherUnambiguous("Sales Order", orderArgs.voucherNumber, orderArgs.date);
      const xml = updateSalesOrderXml(orderArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_purchase_order": {
      const orderArgs = args as Parameters<typeof createPurchaseOrderXml>[0];
      const xml = createPurchaseOrderXml(orderArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_purchase_order": {
      const orderArgs = args as Parameters<typeof updatePurchaseOrderXml>[0];
      await assertVoucherUnambiguous("Purchase Order", orderArgs.voucherNumber, orderArgs.date);
      const xml = updatePurchaseOrderXml(orderArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_job_work_in_order": {
      const jwArgs = args as Parameters<typeof createJobWorkInOrderXml>[0];
      const xml = createJobWorkInOrderXml(jwArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_job_work_in_order": {
      const jwArgs = args as Parameters<typeof updateJobWorkInOrderXml>[0];
      await assertVoucherUnambiguous("Job Work In Order", jwArgs.voucherNumber, jwArgs.date);
      const xml = updateJobWorkInOrderXml(jwArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_job_work_out_order": {
      const jwArgs = args as Parameters<typeof createJobWorkOutOrderXml>[0];
      const xml = createJobWorkOutOrderXml(jwArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_job_work_out_order": {
      const jwArgs = args as Parameters<typeof updateJobWorkOutOrderXml>[0];
      await assertVoucherUnambiguous("Job Work Out Order", jwArgs.voucherNumber, jwArgs.date);
      const xml = updateJobWorkOutOrderXml(jwArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_sales_quotation": {
      const quoteArgs = args as Parameters<typeof createSalesQuotationXml>[0];
      const xml = createSalesQuotationXml(quoteArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_sales_quotation": {
      const quoteArgs = args as Parameters<typeof updateSalesQuotationXml>[0];
      await assertVoucherUnambiguous("Sales Quotation", quoteArgs.voucherNumber, quoteArgs.date);
      const xml = updateSalesQuotationXml(quoteArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_stock_journal": {
      const stockJournalArgs = args as Parameters<typeof createStockJournalXml>[0];
      const xml = createStockJournalXml(stockJournalArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_stock_journal": {
      const stockJournalArgs = args as Parameters<typeof updateStockJournalXml>[0];
      await assertVoucherUnambiguous(
        stockJournalArgs.voucherType ?? "Stock Journal",
        stockJournalArgs.voucherNumber,
        stockJournalArgs.date
      );
      const xml = updateStockJournalXml(stockJournalArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_material_in": {
      const materialArgs = args as Parameters<typeof createMaterialInXml>[0];
      const xml = createMaterialInXml(materialArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_material_in": {
      const materialArgs = args as Parameters<typeof updateMaterialInXml>[0];
      await assertVoucherUnambiguous("Material In", materialArgs.voucherNumber, materialArgs.date);
      const xml = updateMaterialInXml(materialArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_material_out": {
      const materialArgs = args as Parameters<typeof createMaterialOutXml>[0];
      const xml = createMaterialOutXml(materialArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_material_out": {
      const materialArgs = args as Parameters<typeof updateMaterialOutXml>[0];
      await assertVoucherUnambiguous("Material Out", materialArgs.voucherNumber, materialArgs.date);
      const xml = updateMaterialOutXml(materialArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_rejections_in": {
      const rejArgs = args as Parameters<typeof createRejectionsInXml>[0];
      const xml = createRejectionsInXml(rejArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_rejections_in": {
      const rejArgs = args as Parameters<typeof updateRejectionsInXml>[0];
      await assertVoucherUnambiguous("Rejections In", rejArgs.voucherNumber, rejArgs.date);
      const xml = updateRejectionsInXml(rejArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_rejections_out": {
      const rejArgs = args as Parameters<typeof createRejectionsOutXml>[0];
      const xml = createRejectionsOutXml(rejArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_rejections_out": {
      const rejArgs = args as Parameters<typeof updateRejectionsOutXml>[0];
      await assertVoucherUnambiguous("Rejections Out", rejArgs.voucherNumber, rejArgs.date);
      const xml = updateRejectionsOutXml(rejArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_physical_stock": {
      const physicalStockArgs = args as Parameters<typeof createPhysicalStockXml>[0];
      const xml = createPhysicalStockXml(physicalStockArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_physical_stock": {
      const physicalStockArgs = args as Parameters<typeof updatePhysicalStockXml>[0];
      await assertVoucherUnambiguous("Physical Stock", physicalStockArgs.voucherNumber, physicalStockArgs.date);
      const xml = updatePhysicalStockXml(physicalStockArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_group": {
      const { name: groupName, oldName, parent } = args as { name: string; oldName?: string; parent: string };
      const xml = createGroupXml(groupName, parent, oldName);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_stock_group": {
      const { name: stockGroupName, parent } = args as { name: string; parent: string };
      const xml = createStockGroupXml(stockGroupName, parent);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_unit": {
      const unitArgs = args as Parameters<typeof createUnitXml>[0];
      const xml = createUnitXml(unitArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_godown": {
      const { name: godownName, parent } = args as { name: string; parent?: string };
      const xml = createGodownXml(godownName, parent);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_cost_category": {
      const costCategoryArgs = args as Parameters<typeof createCostCategoryXml>[0];
      const xml = createCostCategoryXml(costCategoryArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_cost_centre": {
      const costCentreArgs = args as Parameters<typeof createCostCentreXml>[0];
      const xml = createCostCentreXml(costCentreArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_voucher_type": {
      const voucherTypeArgs = args as Parameters<typeof createVoucherTypeXml>[0];
      const xml = createVoucherTypeXml(voucherTypeArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_stock_item": {
      const {
        name: itemName,
        group,
        unit,
        openingBalance,
        openingRate,
        description,
        rateOfVat,
        ignoreNegativeStock,
        extraFields,
      } = args as {
        name: string;
        group: string;
        unit: string;
        openingBalance?: number;
        openingRate?: number;
        description?: string;
        rateOfVat?: number;
        ignoreNegativeStock?: boolean;
        extraFields?: Record<string, string>;
      };
      const xml = createStockItemXml({
        name: itemName,
        group,
        unit,
        openingBalance: openingBalance ?? 0,
        openingRate: openingRate ?? 0,
        description,
        rateOfVat,
        ignoreNegativeStock,
        extraFields,
      });
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_stock_item": {
      const updateItemArgs = args as {
        name: string;
        group?: string;
        unit?: string;
        description?: string;
        rateOfVat?: number;
        ignoreNegativeStock?: boolean;
        extraFields?: Record<string, string>;
      };
      const xml = updateStockItemXml(updateItemArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "delete_stock_item": {
      const { name: itemName } = args as { name: string };
      const xml = deleteStockItemXml(itemName);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "set_bill_of_materials": {
      const bomArgs = args as Parameters<typeof setBillOfMaterialsXml>[0];
      const xml = setBillOfMaterialsXml(bomArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "update_voucher": {
      const voucherArgs = args as {
        voucherType: string;
        voucherNumber: string;
        date: string;
        narration?: string;
        debitLedger?: string;
        creditLedger?: string;
        amount?: number;
        debitCostCentre?: string;
        creditCostCentre?: string;
        costCategory?: string;
        entries?: VoucherEntryInput[];
      };
      await assertVoucherUnambiguous(voucherArgs.voucherType, voucherArgs.voucherNumber, voucherArgs.date);
      const xml = updateVoucherXml(voucherArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "delete_voucher": {
      const { voucherType, voucherNumber, date } = args as {
        voucherType: string;
        voucherNumber: string;
        date: string;
      };
      await assertVoucherUnambiguous(voucherType, voucherNumber, date);
      const xml = deleteVoucherXml(voucherType, voucherNumber, date);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "sync_to_sql": {
      return await syncAll();
    }

    case "sync_vouchers_to_sql": {
      const { from, to } = args as { from: string; to: string };
      return await syncVouchers(from, to);
    }

    case "sync_voucher_items_to_sql": {
      const { from, to } = args as { from: string; to: string };
      return await syncVoucherItems(from, to);
    }

    case "query_sql": {
      const { sql } = args as { sql: string };
      return await runSql(sql);
    }

    case "get_audit_log": {
      const { limit, toolFilter, writesOnly, fromDate, toDate, company, format } = args as {
        limit?: number;
        toolFilter?: string;
        writesOnly?: boolean;
        fromDate?: string;
        toDate?: string;
        company?: string;
        format?: "json" | "summary";
      };
      const entries = readAuditLog({ limit, toolFilter, writesOnly, fromDate, toDate, company });
      return format === "summary" ? summarizeAuditLog(entries) : JSON.stringify(entries, null, 2);
    }

    case "get_health_check": {
      const permissionStatus = getPermissionStatus();
      let gatewayReachable = false;
      let companyOpen: string | null = null;
      let connectionError: string | null = null;
      try {
        // Filtered to the current company — see get_company_info for why an
        // unfiltered query breaks with more than one Tally company open.
        const xml = buildCollectionXml(
          "Company",
          [{ name: "NAME" }],
          [{ name: "OnlyCurrent", expression: "$$IsEqual:$Name:##SVCurrentCompany" }]
        );
        const result = await tallyRequest(xml);
        const cleaned = cleanTallyResult(result) as any;
        // Confirmed live: something else can be listening on the configured port and
        // still answer with HTTP 200 — e.g. Tally's own license server (port 9999 by
        // default) responds with an HTML status page, not XML. That parses to an
        // "html" wrapper key here instead of the Company collection's expected shape,
        // so treat it as "wrong service at this address", not a reachable gateway.
        if (cleaned && typeof cleaned === "object" && "html" in cleaned) {
          connectionError =
            `Something responded at ${TALLY_URL}, but it isn't TallyPrime's XML gateway (got an HTML page ` +
            `instead — this can happen if the port belongs to a different service, e.g. Tally's license server).`;
        } else {
          gatewayReachable = true;
          const name = cleaned?.DATA?.ROW?.NAME;
          companyOpen = typeof name === "string" && name.length > 0 ? name : null;
        }
      } catch (err) {
        connectionError = err instanceof TallyConnectionError ? err.message : String(err);
      }
      return JSON.stringify(
        {
          tallyUrl: TALLY_URL,
          gatewayReachable,
          companyOpen,
          connectionError,
          readOnlyMode: permissionStatus.readOnly,
          disabledTools: permissionStatus.disabledTools,
          auditLogPath: auditLogPath(),
        },
        null,
        2
      );
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
