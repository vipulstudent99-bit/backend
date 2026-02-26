import { prisma } from "../../prisma/client.js";

/**
 * Trial Balance Report
 *
 * - Calculated fresh every time
 * - Derived ONLY from Entry table
 * - Grouped strictly by Account
 * - Debit = Credit guaranteed if accounting is correct
 */
export async function getTrialBalance(params: {
    companyId: string;
    fromDate?: Date;
    toDate?: Date;
}) {
    const { companyId, fromDate, toDate } = params;

    // Build date filter if provided
    const dateFilter =
        fromDate || toDate
            ? {
                voucher: {
                    voucherDate: {
                        ...(fromDate ? { gte: fromDate } : {}),
                        ...(toDate ? { lte: toDate } : {}),
                    },
                    status: "POSTED",
                },
            }
            : {
                voucher: {
                    status: "POSTED",
                },
            };

    /**
     * Aggregate debit and credit per account
     */
    const raw = await prisma.entry.groupBy({
        by: ["accountId", "side"],
        where: {
            account: {
                companyId,
            },
            ...dateFilter,
        },
        _sum: {
            amount: true,
        },
    });

    /**
     * Load account metadata
     */
    const accounts = await prisma.account.findMany({
        where: { companyId },
        include: { accountType: true },
    });

    /**
     * Normalize into Trial Balance rows
     */
    const rows = accounts.map((account) => {
        const debit =
            raw.find(
                (r) =>
                    r.accountId === account.id && r.side === "DEBIT"
            )?._sum.amount ?? 0;

        const credit =
            raw.find(
                (r) =>
                    r.accountId === account.id && r.side === "CREDIT"
            )?._sum.amount ?? 0;

        const balance = debit - credit;

        return {
            accountId: account.id,
            accountCode: account.code,
            accountName: account.name,
            accountType: account.accountType.code,
            debit: Number(debit),
            credit: Number(credit),
            balance: Number(balance),
        };
    });

    /**
     * Optional: sanity check (should always pass)
     */
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

    if (totalDebit !== totalCredit) {
        throw new Error(
            `Trial Balance mismatch: Debit ${totalDebit} ≠ Credit ${totalCredit}`
        );
    }

    return rows;
}
