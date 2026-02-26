import { prisma } from "../../../prisma/client.js";

/**
 * Resolve ledger accounts ONLY when posting a voucher.
 * Drafts must NEVER call this.
 */
export async function resolveAccountsForVoucher(voucher: {
    voucherType: string;
    paymentMode?: "CASH" | "BANK";
}) {
    if (!voucher?.voucherType) {
        throw new Error("voucherType is required to post voucher");
    }

    // Helper
    async function getAccountByRole(role: string) {
        const account = await prisma.account.findFirst({
            where: { role },
        });

        if (!account) {
            throw new Error(`Account with role '${role}' not found`);
        }

        return account.id;
    }

    switch (voucher.voucherType) {
        case "SALE": {
            if (!voucher.paymentMode) {
                throw new Error("paymentMode required for SALE");
            }

            return {
                debitAccountId:
                    voucher.paymentMode === "CASH"
                        ? await getAccountByRole("CASH")
                        : await getAccountByRole("BANK"),
                creditAccountId: await getAccountByRole("SALES"),
            };
        }

        case "PURCHASE": {
            return {
                debitAccountId: await getAccountByRole("PURCHASE"),
                creditAccountId: await getAccountByRole("CASH"),
            };
        }

        case "RECEIPT": {
            return {
                debitAccountId: await getAccountByRole("CASH"),
                creditAccountId: await getAccountByRole("AR"),
            };
        }

        case "PAYMENT": {
            return {
                debitAccountId: await getAccountByRole("AP"),
                creditAccountId: await getAccountByRole("CASH"),
            };
        }

        default:
            throw new Error(`Unsupported voucherType: ${voucher.voucherType}`);
    }
}
