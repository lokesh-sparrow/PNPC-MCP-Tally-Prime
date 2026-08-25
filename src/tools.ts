import { tallyRequest, buildCollectionXml } from "./tally.js";
import { cleanTallyResult, extractRecords } from "./clean.js";
import { render } from "./templates.js";
import { syncAll, syncVouchers, runSql } from "./db.js";
import { readAuditLog, summarizeAuditLog } from "./audit.js";

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
    description: "Get vouchers (Day Book) from TallyPrime filtered by date range",
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
    name: "create_physical_stock",
    description:
      "Create a Physical Stock voucher in TallyPrime — records the actual counted quantity of one or more stock " +
      "items from a physical verification, so Tally can show the shortage/excess variance against book stock in " +
      "stock reports. Inventory-only, zero value/amount — it does not post any accounting adjustment for the " +
      "variance (do that separately with create_voucher/create_stock_journal if you need to write off the " +
      "difference). EXTRAPOLATED from Tally's documented Physical Stock XML schema, not reverse-engineered from a " +
      "real manually-created example — verify carefully after use.",
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
      "sign pattern (a Credit Note is structurally a reverse Sales entry). UNLIKE create_sales_invoice/" +
      "create_purchase_invoice, this was extrapolated from that proven convention, not reverse-engineered from a " +
      "real manually-created example — verify carefully after use. Same godown and dual-role deletion caveats apply.",
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
      "matching Sales's sign pattern (a Debit Note is structurally a reverse Purchase entry). UNLIKE " +
      "create_sales_invoice/create_purchase_invoice, this was extrapolated from that proven convention, not " +
      "reverse-engineered from a real manually-created example — verify carefully after use. Same godown and " +
      "dual-role deletion caveats apply.",
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
      "Create a new simple Unit of Measure in TallyPrime (e.g. 'Kg', 'Box', 'Ltr'). Required before creating or " +
      "invoicing a stock item in a unit that doesn't exist yet — stock item/invoice tools fail with 'Unit does not " +
      "exist!' otherwise. Only covers simple units, not compound units (e.g. 'Box of 12 Nos').",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "The unit symbol as referenced elsewhere, e.g. 'Kg', 'Box', 'Nos'" },
        formalName: { type: "string", description: "Full name, e.g. 'Kilograms'. Optional." },
        decimalPlaces: { type: "number", description: "Decimal precision for quantities in this unit. Defaults to 0 (whole numbers only, e.g. 'Nos')." },
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
    name: "query_sql",
    description:
      "Run a read-only SQL SELECT query against this session's in-memory cache populated by sync_to_sql/" +
      "sync_vouchers_to_sql (gone when the session ends). Tables: ledgers(name, parent, closing_balance), " +
      "groups(name, parent), stock_items(name, parent, closing_balance), vouchers(guid, date, voucher_type, " +
      "voucher_number, party_ledger, amount, narration) — vouchers is only populated for date ranges you've " +
      "explicitly synced via sync_vouchers_to_sql, for whichever company was open at sync time.",
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
      "timestamp, arguments, and outcome (success/error/denied). The log file itself is never rewritten or " +
      "truncated by this tool, only appended to as calls happen, so this always reflects the true history. Use " +
      "this to review what an agent actually did against this Tally company, e.g. before trusting a session's " +
      "claimed results, or to hand a reviewer a plain record of every write made in a given period.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max number of most-recent matching entries to return. Defaults to 50." },
        toolFilter: { type: "string", description: "Only return entries for this exact tool name." },
        writesOnly: { type: "boolean", description: "Only return write calls (skip reads) — for reviewing what actually changed." },
        fromDate: { type: "string", description: "Inclusive start date, DD-MM-YYYY. Filters by when the call happened." },
        toDate: { type: "string", description: "Inclusive end date, DD-MM-YYYY." },
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
];

function reportXml(reportName: string, staticVariables: Record<string, string>): string {
  return render("report.xml.njk", { reportName, staticVariables: Object.entries(staticVariables) });
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

function createUnitXml(args: { symbol: string; formalName?: string; decimalPlaces?: number }): string {
  return render("create-unit.xml.njk", {
    symbol: args.symbol,
    formalName: args.formalName,
    decimalPlaces: args.decimalPlaces ?? 0,
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
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Day Book", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_company_info": {
      // "Company" is a UI form in Tally's TDL, not an exportable report —
      // requesting it via REPORTNAME throws "Error in TDL. 'Form:Company'
      // No 'PARTS'!". The company object is fetched as a COLLECTION instead.
      const xml = buildCollectionXml("Company", [
        { name: "NAME" },
        { name: "ADDRESS", expression: 'if $$IsEmpty:$Address then "" else $$FullList:Address:$Address' },
        { name: "STATENAME" },
        { name: "COUNTRYNAME" },
        { name: "PINCODE" },
        { name: "PHONENUMBER" },
        { name: "EMAIL" },
        { name: "BOOKSFROM", datatype: "date" },
      ]);
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
      return JSON.stringify({ rows }, null, 2);
    }

    case "get_balance_sheet": {
      const { asOf } = args as { asOf: string };
      const xml = reportXml("Balance Sheet", { SVFROMDATE: asOf, SVTODATE: asOf });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
    }

    case "get_trial_balance": {
      const { from, to } = args as { from: string; to: string };
      const xml = reportXml("Trial Balance", { SVFROMDATE: from, SVTODATE: to });
      const result = await tallyRequest(xml);
      return JSON.stringify(cleanTallyResult(result), null, 2);
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
      const rows = extractRecords(await tallyRequest(xml));
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

    case "query_sql": {
      const { sql } = args as { sql: string };
      return await runSql(sql);
    }

    case "get_audit_log": {
      const { limit, toolFilter, writesOnly, fromDate, toDate, format } = args as {
        limit?: number;
        toolFilter?: string;
        writesOnly?: boolean;
        fromDate?: string;
        toDate?: string;
        format?: "json" | "summary";
      };
      const entries = readAuditLog({ limit, toolFilter, writesOnly, fromDate, toDate });
      return format === "summary" ? summarizeAuditLog(entries) : JSON.stringify(entries, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
