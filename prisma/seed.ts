import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Seeding Phase 1.5: Company + Accounts + Voucher Types");

    // --------------------------------------------------
    // 1. COMPANY
    // --------------------------------------------------
    const company = await prisma.company.upsert({
        where:  { code: "DEFAULT_COMPANY" },
        update: {},
        create: {
            code:                 "DEFAULT_COMPANY",
            name:                 "Default Company",
            baseCurrency:         "INR",
            fiscalYearStartMonth: 4,
        },
    });

    // --------------------------------------------------
    // 2. ACCOUNT TYPES
    // --------------------------------------------------
    const accountTypes = [
        { code: "ASSET",     name: "Asset" },
        { code: "LIABILITY", name: "Liability" },
        { code: "EQUITY",    name: "Equity" },
        { code: "INCOME",    name: "Income" },
        { code: "EXPENSE",   name: "Expense" },
    ];

    for (const at of accountTypes) {
        await prisma.accountType.upsert({
            where:  { code: at.code },
            update: {},
            create: { code: at.code, name: at.name, companyId: company.id },
        });
    }

    const assetType     = await prisma.accountType.findUnique({ where: { code: "ASSET" } });
    const liabilityType = await prisma.accountType.findUnique({ where: { code: "LIABILITY" } });
    const equityType    = await prisma.accountType.findUnique({ where: { code: "EQUITY" } });
    const incomeType    = await prisma.accountType.findUnique({ where: { code: "INCOME" } });
    const expenseType   = await prisma.accountType.findUnique({ where: { code: "EXPENSE" } });

    if (!assetType || !liabilityType || !equityType || !incomeType || !expenseType) {
        throw new Error("AccountTypes missing");
    }

    // --------------------------------------------------
    // 3. ACCOUNTS
    // Note: AccountRole enum values are:
    //   CASH | BANK | SALES | PURCHASE | AR | AP | OWNER
    // There is no EXPENSE role in the enum.
    // Operational expense accounts (Salary, Rent, etc.) use
    // role: PURCHASE — this is valid and the template engine
    // uses expenseAccountId directly so the role is not checked.
    // --------------------------------------------------
    const accounts = [
        // ASSETS
        { code: "CASH",               name: "Cash",                role: "CASH",     typeId: assetType.id },
        { code: "BANK",               name: "Bank",                role: "BANK",     typeId: assetType.id },
        { code: "ACCOUNTS_RECEIVABLE",name: "Accounts Receivable", role: "AR",       typeId: assetType.id },

        // LIABILITIES
        { code: "ACCOUNTS_PAYABLE",   name: "Accounts Payable",   role: "AP",       typeId: liabilityType.id },

        // EQUITY
        { code: "OWNER_CAPITAL",      name: "Owner Capital",       role: "OWNER",    typeId: equityType.id },

        // INCOME
        { code: "SALES",              name: "Sales",               role: "SALES",    typeId: incomeType.id },

        // EXPENSE — core (Purchase / COGS)
        { code: "PURCHASE_EXPENSE",   name: "Purchase / COGS",     role: "PURCHASE", typeId: expenseType.id },

        // EXPENSE — operational
        // All use role: PURCHASE because EXPENSE is not a valid AccountRole enum value.
        // The resolver looks these up by code, not role, so this is correct.
        { code: "SALARY_EXPENSE",     name: "Salary & Wages",              role: "PURCHASE", typeId: expenseType.id },
        { code: "RENT_EXPENSE",       name: "Rent",                        role: "PURCHASE", typeId: expenseType.id },
        { code: "FREIGHT_EXPENSE",    name: "Freight & Transport",          role: "PURCHASE", typeId: expenseType.id },
        { code: "UTILITY_EXPENSE",    name: "Electricity & Utilities",      role: "PURCHASE", typeId: expenseType.id },
        { code: "MISC_EXPENSE",       name: "Miscellaneous Expense",        role: "PURCHASE", typeId: expenseType.id },
    ];

    for (const acc of accounts) {
        await prisma.account.upsert({
            where:  { code: acc.code },
            update: {},
            create: {
                code:          acc.code,
                name:          acc.name,
                role:          acc.role as any,
                companyId:     company.id,
                accountTypeId: acc.typeId,
            },
        });
    }

    // --------------------------------------------------
    // 4. VOUCHER TYPES
    // --------------------------------------------------
    const voucherTypes = [
        { code: "SALE",     name: "Sale" },
        { code: "PURCHASE", name: "Purchase" },
        { code: "RECEIPT",  name: "Receipt" },
        { code: "PAYMENT",  name: "Payment" },
        { code: "CONTRA",   name: "Contra / Transfer" },
        { code: "JOURNAL",  name: "Journal / Adjustment" },
    ];

    for (const vt of voucherTypes) {
        await prisma.voucherType.upsert({
            where:  { code: vt.code },
            update: {},
            create: { code: vt.code, name: vt.name, companyId: company.id },
        });
    }

    console.log("✅ Seed completed:");
    console.log("   Accounts: CASH, BANK, AR, AP, OWNER, SALES, PURCHASE_EXPENSE");
    console.log("             SALARY_EXPENSE, RENT_EXPENSE, FREIGHT_EXPENSE,");
    console.log("             UTILITY_EXPENSE, MISC_EXPENSE");
    console.log("   Voucher types: SALE, PURCHASE, RECEIPT, PAYMENT, CONTRA, JOURNAL");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
