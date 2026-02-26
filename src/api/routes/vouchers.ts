import { Router } from "express";
import { prisma } from "../../../prisma/client.js";
import { AccountRole } from "@prisma/client";
import { createDraftVoucher } from "../../accounting/createDraftVoucher.js";
import { updateDraftVoucher } from "../../accounting/updateDraftVoucher.js";
import { deleteDraftVoucher } from "../../accounting/deleteDraftVoucher.js";
import { postVoucher } from "../../accounting/postVoucher.js";
import type { VoucherTemplateInput } from "../../accounting/templates/voucherTemplateEngine.js";

const router = Router();

/**
 * Shared resolver: converts frontend payload into DB-resolved IDs.
 * Looks up voucherTypeId, account IDs by role, and paymentAccountId.
 */
async function resolveVoucherIds(params: {
    voucherType: string;
    paymentMode?: string;
}) {
    const { voucherType, paymentMode } = params;

    // Resolve voucherTypeId from code
    const voucherTypeRecord = await prisma.voucherType.findFirst({
        where: { code: voucherType },
    });
    if (!voucherTypeRecord) {
        throw new Error(`VoucherType '${voucherType}' not found`);
    }

    // Helper to get account ID by role
    async function getByRole(role: AccountRole): Promise<string> {
        const account = await prisma.account.findFirst({
            where: { role },
        });
        if (!account) {
            throw new Error(`Account with role '${role}' not found`);
        }
        return account.id;
    }

    const accounts: VoucherTemplateInput["accounts"] = {
        salesAccountId: await getByRole("SALES"),
        purchaseExpenseAccountId: await getByRole("PURCHASE"),
        accountsReceivableId: await getByRole("AR"),
        accountsPayableId: await getByRole("AP"),
        ownerCapitalId: await getByRole("OWNER"),
    };

    let paymentAccountId: string | undefined;
    if (paymentMode === "CASH") {
        paymentAccountId = await getByRole("CASH");
    } else if (paymentMode === "BANK") {
        paymentAccountId = await getByRole("BANK");
    }

    return { voucherTypeId: voucherTypeRecord.id, accounts, paymentAccountId };
}

/**
 * GET /api/vouchers/drafts
 * Return draft vouchers ONLY (no accounting joins)
 */
router.get("/drafts", async (_req, res, next) => {
    try {
        const drafts = await prisma.voucher.findMany({
            where: { status: "DRAFT" },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                voucherDate: true,
                status: true,
                narration: true,
                createdAt: true,
                voucherType: {
                    select: {
                        code: true,
                        name: true,
                    },
                },
            },
        });

        res.json(drafts);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/vouchers/draft
 */
router.post("/draft", async (req, res, next) => {
    try {
        const {
            voucherType,
            subType,
            totalAmount,
            paymentMode,
            narration,
            voucherDate,
        } = req.body;

        // Resolve company (single-company setup)
        const company = await prisma.company.findFirst();
        if (!company) {
            throw new Error("No company found");
        }

        const { voucherTypeId, accounts, paymentAccountId } =
            await resolveVoucherIds({ voucherType, paymentMode });

        const voucher = await createDraftVoucher({
            companyId: company.id,
            voucherTypeId,
            voucherType,
            subType,
            totalAmount,
            paymentAccountId,
            accounts,
            voucherDate: new Date(voucherDate),
            narration,
        });

        res.status(201).json(voucher);
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/vouchers/draft/:id
 */
router.put("/draft/:id", async (req, res, next) => {
    try {
        const {
            voucherType,
            subType,
            totalAmount,
            paymentMode,
            narration,
            voucherDate,
        } = req.body;

        const { accounts, paymentAccountId } = await resolveVoucherIds({
            voucherType,
            paymentMode,
        });

        const result = await updateDraftVoucher(req.params.id, {
            voucherType,
            subType,
            totalAmount,
            paymentAccountId,
            accounts,
            voucherDate: new Date(voucherDate),
            narration,
        });

        res.json(result);
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api/vouchers/draft/:id
 */
router.delete("/draft/:id", async (req, res, next) => {
    try {
        const result = await deleteDraftVoucher(req.params.id);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/vouchers/:id/post
 */
router.post("/:id/post", async (req, res, next) => {
    try {
        const result = await postVoucher(req.params.id);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

export default router;
