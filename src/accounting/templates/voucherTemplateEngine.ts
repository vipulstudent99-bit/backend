// =====================================
// Voucher Template Engine
// SINGLE SOURCE OF ACCOUNTING TRUTH
// =====================================
// Supported voucher types:
//   SALE        → CASH_SALE, CREDIT_SALE
//   PURCHASE    → CASH_PURCHASE, CREDIT_PURCHASE
//   RECEIPT     → (receives payment from customer)
//   PAYMENT     → VENDOR_PAYMENT, EXPENSE_PAYMENT, OWNER_WITHDRAWAL
//   CONTRA      → CASH_TO_BANK, BANK_TO_CASH
//   JOURNAL     → MANUAL_JOURNAL (freeform DR/CR)
// =====================================

export type VoucherType =
    | "SALE"
    | "PURCHASE"
    | "RECEIPT"
    | "PAYMENT"
    | "CONTRA"
    | "JOURNAL";

export type EntrySide = "DEBIT" | "CREDIT";

export type VoucherTemplateInput = {
    voucherType: VoucherType;
    subType: string;
    totalAmount: number;

    // Cash or Bank account ID — required for most types
    paymentAccountId?: string;

    // For EXPENSE_PAYMENT — which expense account to debit
    expenseAccountId?: string;

    // For JOURNAL — freeform entries provided directly
    // If voucherType = JOURNAL, entries are passed as-is (already built by caller)
    journalEntries?: Array<{ accountId: string; side: EntrySide; amount: number }>;

    // Control accounts — resolved before calling template
    accounts: {
        salesAccountId: string;
        purchaseExpenseAccountId: string;
        accountsReceivableId: string;
        accountsPayableId: string;
        ownerCapitalId: string;
        cashAccountId: string;   // needed for CONTRA
        bankAccountId: string;   // needed for CONTRA
    };
};

export type GeneratedEntry = {
    accountId: string;
    side: EntrySide;
    amount: number;
};

// -------------------------------------
// Public API
// -------------------------------------

export function generateEntriesFromTemplate(
    input: VoucherTemplateInput
): GeneratedEntry[] {
    switch (input.voucherType) {
        case "SALE":
            return saleTemplate(input);
        case "PURCHASE":
            return purchaseTemplate(input);
        case "RECEIPT":
            return receiptTemplate(input);
        case "PAYMENT":
            return paymentTemplate(input);
        case "CONTRA":
            return contraTemplate(input);
        case "JOURNAL":
            return journalTemplate(input);
        default:
            throw new Error(`Unsupported voucher type: ${(input as any).voucherType}`);
    }
}

// -------------------------------------
// SALE
// CASH_SALE    → Cash/Bank DR   / Sales CR
// CREDIT_SALE  → AR DR          / Sales CR
// -------------------------------------
function saleTemplate(input: VoucherTemplateInput): GeneratedEntry[] {
    switch (input.subType) {
        case "CASH_SALE":
            if (!input.paymentAccountId)
                throw new Error("paymentAccountId required for CASH_SALE");
            return [
                { accountId: input.paymentAccountId, side: "DEBIT",  amount: input.totalAmount },
                { accountId: input.accounts.salesAccountId, side: "CREDIT", amount: input.totalAmount },
            ];

        case "CREDIT_SALE":
            return [
                { accountId: input.accounts.accountsReceivableId, side: "DEBIT",  amount: input.totalAmount },
                { accountId: input.accounts.salesAccountId,       side: "CREDIT", amount: input.totalAmount },
            ];

        default:
            throw new Error(`Unsupported SALE subType: ${input.subType}`);
    }
}

// -------------------------------------
// PURCHASE
// CASH_PURCHASE   → Purchase DR / Cash/Bank CR
// CREDIT_PURCHASE → Purchase DR / AP CR
// -------------------------------------
function purchaseTemplate(input: VoucherTemplateInput): GeneratedEntry[] {
    switch (input.subType) {
        case "CASH_PURCHASE":
            if (!input.paymentAccountId)
                throw new Error("paymentAccountId required for CASH_PURCHASE");
            return [
                { accountId: input.accounts.purchaseExpenseAccountId, side: "DEBIT",  amount: input.totalAmount },
                { accountId: input.paymentAccountId,                  side: "CREDIT", amount: input.totalAmount },
            ];

        case "CREDIT_PURCHASE":
            return [
                { accountId: input.accounts.purchaseExpenseAccountId, side: "DEBIT",  amount: input.totalAmount },
                { accountId: input.accounts.accountsPayableId,        side: "CREDIT", amount: input.totalAmount },
            ];

        default:
            throw new Error(`Unsupported PURCHASE subType: ${input.subType}`);
    }
}

// -------------------------------------
// RECEIPT
// Cash/Bank DR / AR CR
// (Customer pays their outstanding bill)
// -------------------------------------
function receiptTemplate(input: VoucherTemplateInput): GeneratedEntry[] {
    if (!input.paymentAccountId)
        throw new Error("paymentAccountId required for RECEIPT");
    return [
        { accountId: input.paymentAccountId,              side: "DEBIT",  amount: input.totalAmount },
        { accountId: input.accounts.accountsReceivableId, side: "CREDIT", amount: input.totalAmount },
    ];
}

// -------------------------------------
// PAYMENT
// VENDOR_PAYMENT   → AP DR          / Cash/Bank CR
// EXPENSE_PAYMENT  → Expense DR     / Cash/Bank CR
// OWNER_WITHDRAWAL → OwnerCapital DR / Cash/Bank CR
// -------------------------------------
function paymentTemplate(input: VoucherTemplateInput): GeneratedEntry[] {
    if (!input.paymentAccountId)
        throw new Error("paymentAccountId required for PAYMENT");

    switch (input.subType) {
        case "VENDOR_PAYMENT":
            return [
                { accountId: input.accounts.accountsPayableId, side: "DEBIT",  amount: input.totalAmount },
                { accountId: input.paymentAccountId,           side: "CREDIT", amount: input.totalAmount },
            ];

        case "EXPENSE_PAYMENT":
            // expenseAccountId must be provided — caller picks which expense account
            if (!input.expenseAccountId)
                throw new Error("expenseAccountId required for EXPENSE_PAYMENT");
            return [
                { accountId: input.expenseAccountId, side: "DEBIT",  amount: input.totalAmount },
                { accountId: input.paymentAccountId, side: "CREDIT", amount: input.totalAmount },
            ];

        case "OWNER_WITHDRAWAL":
            return [
                { accountId: input.accounts.ownerCapitalId, side: "DEBIT",  amount: input.totalAmount },
                { accountId: input.paymentAccountId,        side: "CREDIT", amount: input.totalAmount },
            ];

        default:
            throw new Error(`Unsupported PAYMENT subType: ${input.subType}`);
    }
}

// -------------------------------------
// CONTRA
// CASH_TO_BANK → Bank DR / Cash CR
// BANK_TO_CASH → Cash DR / Bank CR
// (Internal transfer — no external party)
// -------------------------------------
function contraTemplate(input: VoucherTemplateInput): GeneratedEntry[] {
    const { cashAccountId, bankAccountId } = input.accounts;

    switch (input.subType) {
        case "CASH_TO_BANK":
            return [
                { accountId: bankAccountId, side: "DEBIT",  amount: input.totalAmount },
                { accountId: cashAccountId, side: "CREDIT", amount: input.totalAmount },
            ];

        case "BANK_TO_CASH":
            return [
                { accountId: cashAccountId, side: "DEBIT",  amount: input.totalAmount },
                { accountId: bankAccountId, side: "CREDIT", amount: input.totalAmount },
            ];

        default:
            throw new Error(`Unsupported CONTRA subType: ${input.subType}`);
    }
}

// -------------------------------------
// JOURNAL
// Freeform double-entry — caller provides entries directly
// Used for: depreciation, corrections, opening entries, adjustments
// Validation: DR total must equal CR total (enforced in postVoucher)
// -------------------------------------
function journalTemplate(input: VoucherTemplateInput): GeneratedEntry[] {
    if (!input.journalEntries || input.journalEntries.length < 2)
        throw new Error("JOURNAL requires at least 2 entries in journalEntries");

    const debitTotal  = input.journalEntries.filter(e => e.side === "DEBIT" ).reduce((s, e) => s + e.amount, 0);
    const creditTotal = input.journalEntries.filter(e => e.side === "CREDIT").reduce((s, e) => s + e.amount, 0);

    if (Math.abs(debitTotal - creditTotal) > 0.001)
        throw new Error(`JOURNAL entries do not balance. DR: ${debitTotal}, CR: ${creditTotal}`);

    return input.journalEntries;
}
