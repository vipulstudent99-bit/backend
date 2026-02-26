import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client.js";

/**
 * Converts a DRAFT voucher into a POSTED voucher.
 * This operation is ATOMIC and CONCURRENCY-SAFE.
 *
 * Brick references:
 * - Brick 3: Posting rules
 * - Brick 4: Atomicity & concurrency safety
 * - Brick 5: Authority handled outside (caller responsibility)
 */
export async function postVoucher(voucherId: string) {
    return await prisma.$transaction(
        async (tx) => {
            // 1. Load voucher + entries INSIDE transaction
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

            // 4. Validate debit / credit
            let debitTotal = 0;
            let creditTotal = 0;

            for (const entry of voucher.entries) {
                if (entry.amount <= 0) {
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

            // 5. Find last POSTED voucher number (per company + voucher type)
            const lastPostedVoucher = await tx.voucher.findFirst({
                where: {
                    companyId: voucher.companyId,
                    voucherTypeId: voucher.voucherTypeId,
                    status: "POSTED",
                },
                orderBy: {
                    voucherNumber: "desc",
                },
                select: {
                    voucherNumber: true,
                },
            });

            const nextVoucherNumber =
                (lastPostedVoucher?.voucherNumber ?? 0) + 1;

            // 6. Update voucher: assign number + mark POSTED
            //    This happens INSIDE the same transaction
            await tx.voucher.update({
                where: { id: voucherId },
                data: {
                    voucherNumber: nextVoucherNumber,
                    status: "POSTED",
                },
            });

            // 7. Return something useful (optional)
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
