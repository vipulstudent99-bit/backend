import { Router } from "express";
import { prisma } from "../../../prisma/client";
import { createDraftVoucher } from "../../accounting/createDraftVoucher";
import { updateDraftVoucher } from "../../accounting/updateDraftVoucher";
import { deleteDraftVoucher } from "../../accounting/deleteDraftVoucher";
import { postVoucher } from "../../accounting/postVoucher";

const router = Router();

/**
 * Maps frontend payment category keys to expense account codes in the DB.
 * These codes must match what's in prisma/seed.ts.
 * Frontend sends paymentCategory (e.g. 'RENT'); backend resolves to account code.
 */
const EXPENSE_CATEGORY_TO_ACCOUNT_CODE: Record<string, string> = {
  SALARY:   "EXP-SAL",
  RENT:     "EXP-RENT",
  FREIGHT:  "EXP-FREIGHT",
  UTILITY:  "EXP-UTIL",
  OTHER:    "EXP-OTHER",
};

/**
 * Shared resolver — bridges frontend payload to DB IDs.
 * Frontend speaks business language; this converts to UUIDs.
 */
async function resolveVoucherIds(body: any) {
  const {
    voucherType, subType, totalAmount, paymentMode,
    narration, voucherDate, partyId,
    expenseAccountCode,   // explicit override (optional)
    paymentCategory,      // NEW: SALARY | RENT | FREIGHT | UTILITY | OTHER
    journalEntries,
  } = body;

  const company = await prisma.company.findFirst();
  if (!company) throw new Error("No company found. Run seed.");

  const voucherTypeRecord = await prisma.voucherType.findFirst({
    where: { code: voucherType },
  });
  if (!voucherTypeRecord) throw new Error(`VoucherType not found: ${voucherType}. Run seed.`);

  const accounts = await prisma.account.findMany({ where: { companyId: company.id } });

  const findByRole = (role: string): string => {
    const acc = accounts.find((a) => a.role === role);
    if (!acc) throw new Error(`Account with role "${role}" not found. Run seed.`);
    return acc.id;
  };

  const findByCode = (code: string): string => {
    const acc = accounts.find((a) => a.code === code);
    if (!acc) throw new Error(`No account with code "${code}" found. Check seed data.`);
    return acc.id;
  };

  let paymentAccountId: string | undefined;
  if (paymentMode === "CASH") paymentAccountId = findByRole("CASH");
  if (paymentMode === "BANK") paymentAccountId = findByRole("BANK");

  let expenseAccountId: string | undefined;
  if (voucherType === "PAYMENT" && subType === "EXPENSE_PAYMENT") {
    // Resolve in priority order:
    // 1. Explicit expenseAccountCode from frontend (legacy / advanced)
    // 2. paymentCategory → auto-mapped to account code
    const resolvedCode =
      expenseAccountCode ||
      (paymentCategory && EXPENSE_CATEGORY_TO_ACCOUNT_CODE[String(paymentCategory).toUpperCase()]);

    if (!resolvedCode) {
      throw new Error(
        `Cannot determine expense account. ` +
        `Send either 'expenseAccountCode' or 'paymentCategory' ` +
        `(SALARY | RENT | FREIGHT | UTILITY | OTHER).`
      );
    }
    expenseAccountId = findByCode(resolvedCode);
  }

  if (partyId) {
    const party = await prisma.party.findUnique({ where: { id: partyId } });
    if (!party) throw new Error(`Party not found: ${partyId}`);
  }

  return {
    companyId:      company.id,
    voucherTypeId:  voucherTypeRecord.id,
    voucherType:    voucherType as any,
    subType:        subType ?? null,
    totalAmount:    Number(totalAmount),
    paymentAccountId,
    expenseAccountId,
    journalEntries: journalEntries ?? undefined,
    narration:      narration ?? null,
    voucherDate:    new Date(voucherDate),
    partyId:        partyId ?? null,
    accounts: {
      salesAccountId:           findByRole("SALES"),
      purchaseExpenseAccountId: findByRole("PURCHASE"),
      accountsReceivableId:     findByRole("AR"),
      accountsPayableId:        findByRole("AP"),
      ownerCapitalId:           findByRole("OWNER"),
      cashAccountId:            findByRole("CASH"),
      bankAccountId:            findByRole("BANK"),
    },
  };
}

/**
 * GET /api/vouchers/drafts
 */
router.get("/drafts", async (_req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) { res.json([]); return; }

    const drafts = await prisma.voucher.findMany({
      where: { status: "DRAFT", companyId: company.id },
      orderBy: { createdAt: "desc" },
      include: {
        voucherType: { select: { code: true, name: true } },
        party:       { select: { id: true, name: true } },
        entries:     { select: { side: true, amount: true } },
      },
    });

    const shaped = drafts.map((v) => ({
      voucherId:     v.id,
      voucherType:   v.voucherType.code,
      subType:       v.subType ?? "N/A",
      voucherDate:   v.voucherDate,
      totalAmount:   v.entries.filter((e) => e.side === "DEBIT").reduce((s, e) => s + Number(e.amount), 0),
      status:        v.status,
      narration:     v.narration,
      partyId:       v.party?.id   ?? null,
      partyName:     v.party?.name ?? null,
      voucherNumber: v.voucherNumber,
      createdAt:     v.createdAt,
    }));

    res.json(shaped);
  } catch (err) { next(err); }
});

/**
 * GET /api/vouchers/all
 */
router.get("/all", async (_req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) { res.json([]); return; }

    const all = await prisma.voucher.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      include: {
        voucherType: { select: { code: true } },
        party:       { select: { id: true, name: true } },
        entries:     { select: { side: true, amount: true } },
      },
    });

    const shaped = all.map((v) => ({
      voucherId:     v.id,
      voucherType:   v.voucherType.code,
      subType:       v.subType ?? "N/A",
      voucherDate:   v.voucherDate,
      totalAmount:   v.entries.filter((e) => e.side === "DEBIT").reduce((s, e) => s + Number(e.amount), 0),
      status:        v.status,
      narration:     v.narration,
      partyId:       v.party?.id   ?? null,
      partyName:     v.party?.name ?? null,
      voucherNumber: v.voucherNumber,
      createdAt:     v.createdAt,
    }));

    res.json(shaped);
  } catch (err) { next(err); }
});

/**
 * POST /api/vouchers/draft
 */
router.post("/draft", async (req, res, next) => {
  try {
    const resolved = await resolveVoucherIds(req.body);
    const voucher  = await createDraftVoucher(resolved);
    res.status(201).json(voucher);
  } catch (err) { next(err); }
});

/**
 * PATCH /api/vouchers/draft/:id
 * Simple edit — amount, narration, date, partyId only.
 * Does NOT regenerate entries from scratch — scales proportionally.
 */
router.patch("/draft/:id", async (req, res, next) => {
  try {
    const { totalAmount, narration, voucherDate, partyId } = req.body;

    const existing = await prisma.voucher.findUnique({
      where: { id: req.params.id },
      include: { entries: true },
    });
    if (!existing)                   throw new Error("Voucher not found");
    if (existing.status !== "DRAFT") throw new Error("Only DRAFT vouchers can be edited");

    const newAmount = totalAmount !== undefined ? Number(totalAmount) : null;

    await prisma.$transaction(async (tx) => {
      await tx.voucher.update({
        where: { id: req.params.id },
        data: {
          ...(voucherDate !== undefined && { voucherDate: new Date(voucherDate) }),
          ...(narration  !== undefined && { narration }),
          ...(partyId    !== undefined && { partyId: partyId || null }),
        },
      });

      if (newAmount !== null) {
        const oldDebitTotal = existing.entries
          .filter((e) => e.side === "DEBIT")
          .reduce((s, e) => s + Number(e.amount), 0);

        if (oldDebitTotal > 0) {
          const ratio = newAmount / oldDebitTotal;
          for (const entry of existing.entries) {
            await tx.entry.update({
              where: { id: entry.id },
              data:  { amount: Number(entry.amount) * ratio },
            });
          }
        }
      }
    });

    res.json({ voucherId: req.params.id, status: "DRAFT", updated: true });
  } catch (err) { next(err); }
});

/**
 * PUT /api/vouchers/draft/:id
 * Full replacement — requires complete payload.
 */
router.put("/draft/:id", async (req, res, next) => {
  try {
    const existing = await prisma.voucher.findUnique({ where: { id: req.params.id } });
    if (!existing)                   throw new Error("Voucher not found");
    if (existing.status !== "DRAFT") throw new Error("Only DRAFT vouchers can be edited");

    const resolved = await resolveVoucherIds(req.body);
    const voucher  = await updateDraftVoucher(req.params.id, resolved);
    res.json(voucher);
  } catch (err) { next(err); }
});

/**
 * DELETE /api/vouchers/draft/:id
 */
router.delete("/draft/:id", async (req, res, next) => {
  try {
    const existing = await prisma.voucher.findUnique({ where: { id: req.params.id } });
    if (!existing)                   throw new Error("Voucher not found");
    if (existing.status !== "DRAFT") throw new Error("Only DRAFT vouchers can be deleted");

    await deleteDraftVoucher(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

/**
 * POST /api/vouchers/:id/post
 */
router.post("/:id/post", async (req, res, next) => {
  try {
    const result = await postVoucher(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
