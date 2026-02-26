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

  const company = await prisma.company.findFirst();
  if (!company) throw new Error("No company found. Run: npx ts-node prisma/seed.ts");

  const voucherTypeRecord = await prisma.voucherType.findFirst({
    where: { code: voucherType },
  });
  if (!voucherTypeRecord) throw new Error(`VoucherType not found: ${voucherType}`);

  const accounts = await prisma.account.findMany({
    where: { companyId: company.id },
  });

  const findByRole = (role: string): string => {
    const acc = accounts.find((a) => a.role === role);
    if (!acc) throw new Error(`Account with role "${role}" not found. Run seed.`);
    return acc.id;
  };

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
 * Returns fields matching frontend Voucher type exactly:
 * { voucherId, voucherType, subType, voucherDate, totalAmount, status, narration, createdAt }
 */
router.get("/drafts", async (_req, res, next) => {
  try {
    const drafts = await prisma.voucher.findMany({
      where: { status: "DRAFT" },
      orderBy: { createdAt: "desc" },
      include: {
        voucherType: { select: { code: true, name: true } },
        entries: { select: { side: true, amount: true } },
      },
    });

    // Shape response to match frontend Voucher type
    const shaped = drafts.map((v) => {
      const totalAmount = v.entries
        .filter((e) => e.side === "DEBIT")
        .reduce((sum, e) => sum + Number(e.amount), 0);

      return {
        voucherId: v.id,
        voucherType: v.voucherType.code,
        subType: "N/A",           // subType not stored on Voucher model — placeholder
        voucherDate: v.voucherDate,
        totalAmount,
        status: v.status,
        narration: v.narration,
        createdAt: v.createdAt,
      };
    });

    res.json(shaped);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/vouchers/draft
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
