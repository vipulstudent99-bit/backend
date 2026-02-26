import { prisma } from "../../prisma/client.js";
import {
    generateEntriesFromTemplate,
    VoucherTemplateInput,
} from "./templates/voucherTemplateEngine.js";

type UpdateDraftVoucherInput = VoucherTemplateInput & {
    voucherDate: Date;
    narration?: string;
};

export async function updateDraftVoucher(
    voucherId: string,
    input: UpdateDraftVoucherInput
) {
    return await prisma.$transaction(async (tx) => {
        const voucher = await tx.voucher.findUnique({
            where: { id: voucherId },
        });

        if (!voucher) {
            throw new Error("Voucher not found");
        }

        if (voucher.status !== "DRAFT") {
            throw new Error("Only DRAFT vouchers can be updated");
        }

        // 1. Delete old entries (REGEN RULE)
        await tx.entry.deleteMany({
            where: { voucherId },
        });

        // 2. Update voucher header
        await tx.voucher.update({
            where: { id: voucherId },
            data: {
                voucherDate: input.voucherDate,
                narration: input.narration ?? null,
            },
        });

        // 3. Re-generate entries from template
        const generatedEntries = generateEntriesFromTemplate(input);

        // 4. Enforce Debit = Credit (HARD RULE)
        const totalDebit = generatedEntries
            .filter((e) => e.side === "DEBIT")
            .reduce((sum, e) => sum + e.amount, 0);

        const totalCredit = generatedEntries
            .filter((e) => e.side === "CREDIT")
            .reduce((sum, e) => sum + e.amount, 0);

        if (totalDebit !== totalCredit) {
            throw new Error("Debit and Credit totals do not match");
        }

        // 5. Persist regenerated entries
        for (const entry of generatedEntries) {
            await tx.entry.create({
                data: {
                    voucherId,
                    accountId: entry.accountId,
                    side: entry.side,
                    amount: entry.amount,
                },
            });
        }

        return {
            voucherId,
            status: "DRAFT",
        };
    });
}
