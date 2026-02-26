import { prisma } from "../../prisma/client";  // FIX: use shared client, not new PrismaClient()
import {
    generateEntriesFromTemplate,
    VoucherTemplateInput,
} from "./templates/voucherTemplateEngine";

type UpdateDraftVoucherInput = VoucherTemplateInput & {
    voucherDate: Date;
    narration?: string | null;
    partyId?: string | null;
    subType?: string | null;
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

        // 2. Update voucher header — now includes partyId and subType
        await tx.voucher.update({
            where: { id: voucherId },
            data: {
                voucherDate: input.voucherDate,
                narration:   input.narration ?? null,
                partyId:     input.partyId   ?? null,  // FIX: persist party
                subType:     input.subType   ?? null,  // FIX: persist subType
            },
        });

        // 3. Re-generate entries from template
        const generatedEntries = generateEntriesFromTemplate({
            voucherType:      input.voucherType,
            subType:          input.subType ?? "",
            totalAmount:      input.totalAmount,
            paymentAccountId: input.paymentAccountId,
            expenseAccountId: input.expenseAccountId,
            journalEntries:   input.journalEntries,
            accounts:         input.accounts,
        });

        // 4. Persist re-generated entries — use accountId (UUID), NOT accountCode
        for (const entry of generatedEntries) {
            await tx.entry.create({
                data: {
                    voucherId,
                    accountId: entry.accountId,  // FIX: was entry.accountCode (wrong field)
                    side:      entry.side,
                    amount:    entry.amount,
                },
            });
        }

        return {
            voucherId,
            status: "DRAFT",
        };
    });
}
