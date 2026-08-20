import { tallyRequest, buildCollectionXml } from "./tally.js";
import { cleanTallyResult, extractRecords } from "./clean.js";
import { render } from "./templates.js";
import { syncAll, runSql } from "./db.js";

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
      "Create a Stock Journal voucher in TallyPrime, moving inventory from one stock item to another (e.g. transfer, or a simple manufacturing-style conversion). Inventory-only — no ledger entries.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Voucher date in DD-MM-YYYY format" },
        narration: { type: "string", description: "Narration / description for the voucher" },
        sourceItem: { type: "string", description: "Exact name of the stock item being consumed/issued" },
        sourceQty: { type: "number", description: "Quantity of sourceItem consumed" },
        sourceRate: { type: "number", description: "Rate per unit of sourceItem" },
        destItem: { type: "string", description: "Exact name of the stock item being produced/received" },
        destQty: { type: "number", description: "Quantity of destItem produced" },
        destRate: { type: "number", description: "Rate per unit of destItem" },
        unit: { type: "string", description: "Unit of measure shared by both items, e.g. 'Nos'" },
        godown: {
          type: "string",
          description:
            "Godown for both legs (optional — only needed if the items have godown/location tracking enabled).",
        },
      },
      required: ["date", "sourceItem", "sourceQty", "sourceRate", "destItem", "destQty", "destRate", "unit"],
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
            },
            required: ["stockItem", "qty", "rate", "unit", "salesLedger"],
          },
        },
        vatLedger: { type: "string", description: "VAT/tax ledger to apply against the invoice total (optional — omit for a non-taxable invoice)." },
        vatRatePercent: { type: "number", description: "VAT rate as a percentage, e.g. 5. Required if vatLedger is set." },
        billName: {
          type: "string",
          description: "Bill reference name for bill-wise tracking (requires the party ledger's maintainBillWise to be on). Omit if not using bill-wise tracking.",
        },
        billType: { type: "string", description: "Defaults to 'New Ref'." },
      },
      required: ["date", "partyLedger", "items"],
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
            },
            required: ["stockItem", "qty", "rate", "unit", "purchaseLedger"],
          },
        },
        vatLedger: { type: "string", description: "Input VAT/tax ledger to apply against the invoice total (optional — omit for a non-taxable invoice)." },
        vatRatePercent: { type: "number", description: "VAT rate as a percentage, e.g. 5. Required if vatLedger is set." },
        billName: {
          type: "string",
          description: "Bill reference name for bill-wise tracking (requires the party ledger's maintainBillWise to be on). Omit if not using bill-wise tracking.",
        },
        billType: { type: "string", description: "Defaults to 'New Ref'." },
      },
      required: ["date", "partyLedger", "items"],
    },
  },
  {
    name: "create_group",
    description: "Create a new account group in TallyPrime, nested under a parent group",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the new group" },
        parent: {
          type: "string",
          description: "Parent group, e.g. 'Primary', 'Current Assets'",
        },
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
    description: "Update the group and/or unit of an existing stock item in TallyPrime",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact name of the existing stock item" },
        group: { type: "string", description: "New stock group" },
        unit: { type: "string", description: "New unit of measure" },
      },
      required: ["name", "group", "unit"],
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
      "and must exactly match an existing voucher (use get_ledger_vouchers or get_vouchers first to confirm it).",
    inputSchema: {
      type: "object",
      properties: {
        voucherType: { type: "string", description: "Voucher type, e.g. 'Payment', 'Receipt', 'Journal'" },
        voucherNumber: { type: "string", description: "Exact voucher number of the voucher to update" },
        date: { type: "string", description: "Existing voucher's date in DD-MM-YYYY format" },
        narration: { type: "string", description: "New narration / description for the voucher" },
        debitLedger: { type: "string", description: "Ledger name to debit" },
        creditLedger: { type: "string", description: "Ledger name to credit" },
        amount: { type: "number", description: "New amount of the transaction" },
        debitCostCentre: { type: "string", description: "Cost centre to allocate the debit leg to (optional)." },
        creditCostCentre: { type: "string", description: "Cost centre to allocate the credit leg to (optional)." },
        costCategory: {
          type: "string",
          description: "Cost category the cost centre belongs to. Defaults to 'Primary Cost Category'.",
        },
      },
      required: ["voucherType", "voucherNumber", "date", "debitLedger", "creditLedger", "amount"],
    },
  },
  {
    name: "delete_voucher",
    description:
      "Permanently delete an existing voucher from TallyPrime — removes it entirely with no trace " +
      "(distinct from cancelling, which keeps it visible but marked Cancelled). The voucher is matched " +
      "by type + date + voucher number, so that combination must be unique and must exactly match an " +
      "existing voucher (use get_ledger_vouchers or get_vouchers first to confirm it). This has no undo.",
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
      "Pull ledgers, groups, stock items, and vouchers (last 365 days) from TallyPrime into a local " +
      "in-memory SQL cache, so query_sql can run fast arbitrary queries without hitting Tally each time",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "query_sql",
    description:
      "Run a read-only SQL SELECT query against the local cache populated by sync_to_sql. " +
      "Tables: ledgers(name, parent, closing_balance), groups(name, parent), " +
      "stock_items(name, parent, closing_balance), vouchers(date, voucher_type, ledger, amount, narration)",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT statement" },
      },
      required: ["sql"],
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

function createStockJournalXml(args: {
  date: string;
  narration?: string;
  sourceItem: string;
  sourceQty: number;
  sourceRate: number;
  destItem: string;
  destQty: number;
  destRate: number;
  unit: string;
  godown?: string;
}): string {
  const { date, narration, sourceItem, sourceQty, sourceRate, destItem, destQty, destRate, unit, godown } = args;
  return render("create-stock-journal.xml.njk", {
    tallyDate: date.split("-").reverse().join(""),
    narration: narration ?? "",
    sourceItem,
    sourceQty,
    sourceRate,
    sourceAmount: sourceQty * sourceRate,
    destItem,
    destQty,
    destRate,
    destAmount: destQty * destRate,
    unit,
    godown,
  });
}

function createSalesInvoiceXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: { stockItem: string; qty: number; rate: number; unit: string; salesLedger: string; godown?: string }[];
  vatLedger?: string;
  vatRatePercent?: number;
  billName?: string;
  billType?: string;
}): string {
  if (args.vatLedger && args.vatRatePercent === undefined) {
    throw new Error("create_sales_invoice: vatRatePercent is required when vatLedger is set.");
  }
  const items = args.items.map((item) => ({
    ...item,
    amount: Math.round(item.qty * item.rate * 100) / 100,
  }));
  const netTotal = items.reduce((s, i) => s + i.amount, 0);
  const vatAmount = args.vatLedger ? Math.round(netTotal * (args.vatRatePercent! / 100) * 100) / 100 : 0;
  const partyAmount = Math.round((netTotal + vatAmount) * 100) / 100;

  return render("create-sales-invoice.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    vatLedger: args.vatLedger,
    vatRatePercent: args.vatRatePercent,
    vatAmount,
    billName: args.billName,
    billType: args.billType ?? "New Ref",
  });
}

function createPurchaseInvoiceXml(args: {
  date: string;
  narration?: string;
  partyLedger: string;
  items: { stockItem: string; qty: number; rate: number; unit: string; purchaseLedger: string; godown?: string }[];
  vatLedger?: string;
  vatRatePercent?: number;
  billName?: string;
  billType?: string;
}): string {
  if (args.vatLedger && args.vatRatePercent === undefined) {
    throw new Error("create_purchase_invoice: vatRatePercent is required when vatLedger is set.");
  }
  const items = args.items.map((item) => ({
    ...item,
    amount: Math.round(item.qty * item.rate * 100) / 100,
  }));
  const netTotal = items.reduce((s, i) => s + i.amount, 0);
  const vatAmount = args.vatLedger ? Math.round(netTotal * (args.vatRatePercent! / 100) * 100) / 100 : 0;
  const partyAmount = Math.round((netTotal + vatAmount) * 100) / 100;

  return render("create-purchase-invoice.xml.njk", {
    tallyDate: args.date.split("-").reverse().join(""),
    narration: args.narration ?? "",
    partyLedger: args.partyLedger,
    items,
    partyAmount,
    vatLedger: args.vatLedger,
    vatRatePercent: args.vatRatePercent,
    vatAmount,
    billName: args.billName,
    billType: args.billType ?? "New Ref",
  });
}

// "Primary" is the conceptual root of Tally's group/stock-group hierarchy,
// not a real master record — passing it literally as PARENT throws
// "Group 'Primary' does not exist!" (confirmed live). An empty PARENT tag
// is what actually means "top level" to Tally's import.
function normalizeParent(parent: string): string {
  return parent.trim().toLowerCase() === "primary" ? "" : parent;
}

function createGroupXml(name: string, parent: string): string {
  return render("create-group.xml.njk", { name, parent: normalizeParent(parent) });
}

function updateStockItemXml(name: string, group?: string, unit?: string): string {
  return render("update-stock-item.xml.njk", {
    name,
    group: group ? normalizeParent(group) : undefined,
    unit,
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
  debitLedger: string;
  creditLedger: string;
  amount: number;
  debitCostCentre?: string;
  creditCostCentre?: string;
  costCategory?: string;
}): string {
  const {
    voucherType,
    voucherNumber,
    date,
    narration,
    debitLedger,
    creditLedger,
    amount,
    debitCostCentre,
    creditCostCentre,
    costCategory,
  } = args;
  return render("update-voucher.xml.njk", {
    voucherType,
    voucherNumber,
    tallyDate: date.split("-").reverse().join(""),
    narration: narration ?? "",
    debitLedger,
    creditLedger,
    amount,
    debitCostCentre,
    creditCostCentre,
    costCategory: costCategory ?? "Primary Cost Category",
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
      const invoiceArgs = args as {
        date: string;
        narration?: string;
        partyLedger: string;
        items: { stockItem: string; qty: number; rate: number; unit: string; salesLedger: string; godown?: string }[];
        vatLedger?: string;
        vatRatePercent?: number;
        billName?: string;
        billType?: string;
      };
      const xml = createSalesInvoiceXml(invoiceArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_purchase_invoice": {
      const invoiceArgs = args as {
        date: string;
        narration?: string;
        partyLedger: string;
        items: { stockItem: string; qty: number; rate: number; unit: string; purchaseLedger: string; godown?: string }[];
        vatLedger?: string;
        vatRatePercent?: number;
        billName?: string;
        billType?: string;
      };
      const xml = createPurchaseInvoiceXml(invoiceArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_stock_journal": {
      const stockJournalArgs = args as {
        date: string;
        narration?: string;
        sourceItem: string;
        sourceQty: number;
        sourceRate: number;
        destItem: string;
        destQty: number;
        destRate: number;
        unit: string;
        godown?: string;
      };
      const xml = createStockJournalXml(stockJournalArgs);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "create_group": {
      const { name: groupName, parent } = args as { name: string; parent: string };
      const xml = createGroupXml(groupName, parent);
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
      const { name: itemName, group, unit } = args as { name: string; group?: string; unit?: string };
      const xml = updateStockItemXml(itemName, group, unit);
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
        debitLedger: string;
        creditLedger: string;
        amount: number;
        debitCostCentre?: string;
        creditCostCentre?: string;
        costCategory?: string;
      };
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
      const xml = deleteVoucherXml(voucherType, voucherNumber, date);
      const result = await tallyRequest(xml);
      return checkImportResult(result);
    }

    case "sync_to_sql": {
      return await syncAll();
    }

    case "query_sql": {
      const { sql } = args as { sql: string };
      return await runSql(sql);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
