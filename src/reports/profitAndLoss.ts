import { prisma } from "../../prisma/client";

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

    const accounts = await prisma.account.findMany({
        where: {
            companyId,
            accountType: {
                code: { in: ["INCOME", "EXPENSE"] },
            },
        },
        include: { accountType: true },
    });

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
        _sum: { amount: true },
    });

    const income: any[] = [];
    const expenses: any[] = [];

    for (const account of accounts) {
        const debit =
            raw.find((r) => r.accountId === account.id && r.side === "DEBIT")
                ?._sum.amount ?? 0;

        const credit =
            raw.find((r) => r.accountId === account.id && r.side === "CREDIT")
                ?._sum.amount ?? 0;

        const balance =
            account.accountType.code === "INCOME"
                ? Number(credit) - Number(debit)
                : Number(debit) - Number(credit);

        const row = {
            accountId: account.id,
            accountCode: account.code,
            accountName: account.name,
            amount: balance,
        };

        if (account.accountType.code === "INCOME") {
            income.push(row);
        } else {
            expenses.push(row);
        }
    }

    const totalIncome = income.reduce((s, r) => s + r.amount, 0);
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);
    const netProfit = totalIncome - totalExpenses;

    return {
        income,
        expenses,
        totalIncome,
        totalExpenses,   // matches frontend: report.totalExpenses
        netProfit,       // matches frontend: report.netProfit
    };
}
