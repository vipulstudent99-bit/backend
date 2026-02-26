import { prisma } from "../../prisma/client.js";

/**
 * Profit & Loss Report
 *
 * Rules:
 * - Derived ONLY from POSTED entries
 * - Uses AccountType = INCOME / EXPENSE
 * - No balances stored
 * - Deterministic and auditable
 */
export async function getProfitAndLoss(params: {
    companyId: string;
    fromDate?: Date;
    toDate?: Date;
}) {
    const { companyId, fromDate, toDate } = params;

    // Date filter (same pattern as Trial Balance)
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
     * Load INCOME and EXPENSE accounts
     */
    const accounts = await prisma.account.findMany({
        where: {
            companyId,
            accountType: {
                code: { in: ["INCOME", "EXPENSE"] },
            },
        },
        include: { accountType: true },
    });

    /**
     * Aggregate entries
     */
    const raw = await prisma.entry.groupBy({
        by: ["accountId", "side"],
        where: {
            account: {
                companyId,
                accountType: {
                    code: { in: ["INCOME", "EXPENSE"] },
                },
            },
            ...dateFilter,
        },
        _sum: {
            amount: true,
        },
    });

    /**
     * Build line items
     */
    const income: any[] = [];
    const expenses: any[] = [];

    for (const account of accounts) {
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

        // Accounting convention
        const balance =
            account.accountType.code === "INCOME"
                ? credit - debit
                : debit - credit;

        const row = {
            accountId: account.id,
            accountCode: account.code,
            accountName: account.name,
            amount: Number(balance),
        };

        if (account.accountType.code === "INCOME") {
            income.push(row);
        } else {
            expenses.push(row);
        }
    }

    /**
     * Totals
     */
    const totalIncome = income.reduce((s, r) => s + r.amount, 0);
    const totalExpense = expenses.reduce((s, r) => s + r.amount, 0);
    const profitOrLoss = totalIncome - totalExpense;

    return {
        income,
        expenses,
        totalIncome,
        totalExpense,
        profitOrLoss,
    };
}
