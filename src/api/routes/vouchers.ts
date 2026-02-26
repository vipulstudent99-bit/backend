import { Router } from "express";
import { prisma } from "../../../prisma/client";
import { createDraftVoucher } from "../../accounting/createDraftVoucher";
import { updateDraftVoucher } from "../../accounting/updateDraftVoucher";
import { deleteDraftVoucher } from "../../accounting/deleteDraftVoucher";
import { postVoucher } from "../../accounting/postVoucher";

const router = Router();

/**
 * Shared resolver — bridges frontend payload to DB IDs
 * Frontend sends: { voucherType: "SALE", subType: "CASH_SALE", totalAmount, paymentMode: "CASH", ... }
 * Backend needs:  { companyId, voucherTypeId, accounts: {...}, paymentAccountId, ... }
 */
async function resolveVoucherIds(body: any) {
  const { voucherType, subType, totalAmount, paymentMode, narration, voucherDate } = body;

  // 1. Get company (single-company setup)
  const company = await prisma.company.findFirst();
  if (!company) throw new Error("No company found. Run: npx ts-node prisma/seed.ts");

  // 2. Resolve voucherTypeId from code string
  const voucherTypeRecord = await prisma.voucherType.findFirst({
    where: { code: voucherType },
  });
  if (!voucherTypeRecord) throw new Error(`VoucherType not found: ${voucherType}`);

  // 3. Load all accounts for this company
  const accounts = await prisma.account.findMany({
    where: { companyId: company.id },
  });

  // 4. Helper to find account UUID by role
  const findByRole = (role: string): string => {
    const acc = accounts.find((a) => a.role === role);
    if (!acc) throw new Error(`Account with role "${role}" not found. Run seed.`);
    return acc.id;
  };

  // 5. Resolve paymentAccountId from paymentMode
  let paymentAccountId: string | undefined;
  if (paymentMode === "CASH") paymentAccountId = findByRole("CASH");
  if (paymentMode === "BANK") paymentAccountId = findByRole("BANK");

  return {
    companyId: company.id,
    voucherTypeId: voucherTypeRecord.id,
    voucherType: voucherType as "SALE" | "PURCHASE" | "RECEIPT" | "PAYMENT",
    subType,
    totalAmount: Number(totalAmount),
    paymentAccountId,
    narration: narration ?? null,
    voucherDate: new Date(voucherDate),
    accounts: {
      salesAccountId: findByRole("SALES"),
      purchaseExpenseAccountId: findByRole("PURCHASE"),
      accountsReceivableId: findByRole("AR"),
      accountsPayableId: findByRole("AP"),
      ownerCapitalId: findByRole("OWNER"),
    },
  };
}

/**
 * GET /api/vouchers/drafts
 * Return all DRAFT vouchers
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
          select: { code: true, name: true },
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
 * Create a new draft voucher
 */
router.post("/draft", async (req, res, next) => {
  try {
    const resolved = await resolveVoucherIds(req.body);
    const voucher = await createDraftVoucher(resolved);
    res.status(201).json(voucher);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/vouchers/draft/:id
 * Update an existing draft voucher
 */
router.put("/draft/:id", async (req, res, next) => {
  try {
    const existing = await prisma.voucher.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new Error("Voucher not found");
    if (existing.status !== "DRAFT") throw new Error("Only DRAFT vouchers can be edited");

    const resolved = await resolveVoucherIds(req.body);
    const voucher = await updateDraftVoucher(req.params.id, resolved);
    res.json(voucher);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/vouchers/draft/:id
 * Delete a draft voucher
 */
router.delete("/draft/:id", async (req, res, next) => {
  try {
    const existing = await prisma.voucher.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new Error("Voucher not found");
    if (existing.status !== "DRAFT") throw new Error("Only DRAFT vouchers can be deleted");

    await deleteDraftVoucher(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/vouchers/:id/post
 * Post (finalize) a draft voucher
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
