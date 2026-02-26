import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";

/**
 * Converts a DRAFT voucher into a POSTED voucher.
 * ATOMIC, CONCURRENCY-SAFE, SERIALIZABLE transaction.
 *
 * Rules:
 * - Only DRAFT → POSTED allowed
 * - Debit must equal Credit (re-validated at post time)
 * - voucherNumber assigned on post (per company + voucherType)
 * - Immutable after post
 */
export async function postVoucher(voucherId: string) {
    return await prisma.$transaction(
        async (tx) => {
            // 1. Load voucher + entries inside transaction
            const voucher = await tx.voucher.findUnique({
                where: { id: voucherId },
                include: { entries: true },
            });

            if (!voucher) {
                throw new Error("Voucher not found");
            }

            // 2. Must be DRAFT
            if (voucher.status !== "DRAFT") {
                throw new Error("Only DRAFT vouchers can be posted");
            }

            // 3. Must have at least two entries
            if (voucher.entries.length < 2) {
                throw new Error("Voucher must have at least two entries");
            }

            // 4. Validate Debit = Credit
            let debitTotal = 0;
            let creditTotal = 0;

            for (const entry of voucher.entries) {
                if (Number(entry.amount) <= 0) {
                    throw new Error("Entry amount must be positive");
                }
                if (entry.side === "DEBIT") {
                    debitTotal += Number(entry.amount);
                } else {
                    creditTotal += Number(entry.amount);
                }
            }

            if (debitTotal !== creditTotal) {
                throw new Error(
                    `Debit (${debitTotal}) does not match Credit (${creditTotal})`
                );
            }

            // 5. Get next voucher number (per company + voucherType)
            const lastPosted = await tx.voucher.findFirst({
                where: {
                    companyId: voucher.companyId,
                    voucherTypeId: voucher.voucherTypeId,
                    status: "POSTED",
                },
                orderBy: { voucherNumber: "desc" },
                select: { voucherNumber: true },
            });

            const nextVoucherNumber = (lastPosted?.voucherNumber ?? 0) + 1;

            // 6. Mark as POSTED + assign voucher number (atomic)
            await tx.voucher.update({
                where: { id: voucherId },
                data: {
                    status: "POSTED",
                    voucherNumber: nextVoucherNumber,
                },
            });

            return {
                voucherId,
                voucherNumber: nextVoucherNumber,
                status: "POSTED",
            };
        },
        {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
    );
}
