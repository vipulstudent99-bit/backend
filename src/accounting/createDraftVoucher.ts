import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma/client";
import {
    generateEntriesFromTemplate,
    VoucherTemplateInput,
} from "./templates/voucherTemplateEngine";

/**
 * Input for creating a draft voucher.
 * Business intent only — no debit/credit exposed.
 */
export type CreateDraftVoucherInput = VoucherTemplateInput & {
    companyId: string;
    voucherTypeId: string;
    voucherDate: Date;
    narration?: string | null;
    partyId?: string | null;   // FIX: was missing — needed for receivables/payables
    subType?: string | null;   // FIX: was missing — needed for draft list display
};

/**
 * Create a DRAFT voucher with system-generated accounting entries.
 * Deterministic, atomic, and schema-aligned.
 */
export async function createDraftVoucher(
    input: CreateDraftVoucherInput
) {
    return await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
            // 1. Create voucher header (DRAFT only)
            const voucher = await tx.voucher.create({
                data: {
                    companyId:     input.companyId,
                    voucherTypeId: input.voucherTypeId,
                    status:        "DRAFT",
                    voucherDate:   input.voucherDate,
                    narration:     input.narration ?? null,
                    partyId:       input.partyId   ?? null,  // FIX: now saved
                    subType:       input.subType   ?? null,  // FIX: now saved
                },
            });

            // 2. Generate entries from template engine
            const entries = generateEntriesFromTemplate({
                voucherType:      input.voucherType,
                subType:          input.subType ?? "",
                totalAmount:      input.totalAmount,
                paymentAccountId: input.paymentAccountId,
                expenseAccountId: input.expenseAccountId,
                journalEntries:   input.journalEntries,
                accounts:         input.accounts,
            });

            // 3. Enforce Debit = Credit (HARD RULE)
            const totalDebit = entries
                .filter((e) => e.side === "DEBIT")
                .reduce((sum, e) => sum + e.amount, 0);

            const totalCredit = entries
                .filter((e) => e.side === "CREDIT")
                .reduce((sum, e) => sum + e.amount, 0);

            if (Math.abs(totalDebit - totalCredit) > 0.001) {
                throw new Error(
                    `Debit (${totalDebit}) and Credit (${totalCredit}) totals do not match`
                );
            }

            // 4. Persist entries — template engine returns accountId (UUID)
            for (const entry of entries) {
                await tx.entry.create({
                    data: {
                        voucherId: voucher.id,
                        accountId: entry.accountId,  // correct field name per schema
                        side:      entry.side,
                        amount:    entry.amount,
                    },
                });
            }

            return voucher;
        }
    );
}
