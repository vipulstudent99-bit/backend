import { Router } from "express";
import { prisma } from "../../../prisma/client";
import { createDraftVoucher } from "../../accounting/createDraftVoucher";
import { updateDraftVoucher } from "../../accounting/updateDraftVoucher";
import { deleteDraftVoucher } from "../../accounting/deleteDraftVoucher";
import { postVoucher } from "../../accounting/postVoucher";

const router = Router();

/**
 * Shared resolver — bridges frontend payload to DB IDs
 *
 * Frontend sends business language:
 *   { voucherType, subType, totalAmount, paymentMode, voucherDate, narration, partyId,
 *     expenseAccountCode, journalEntries }
 *
 * Resolver returns DB-ready object for accounting functions.
 */
async function resolveVoucherIds(body: any) {
  const {
    voucherType,
    subType,
    totalAmount,
    paymentMode,
    narration,
    voucherDate,
    partyId,
    expenseAccountCode, // for EXPENSE_PAYMENT: e.g. "SALARY_EXPENSE"
    journalEntries,     // for JOURNAL: [{ accountId, side, amount }]
  } = body;

  // 1. Load company
  const company = await prisma.company.findFirst();
  if (!company) throw new Error("No company found. Run seed.");

  // 2. Load voucher type
  const voucherTypeRecord = await prisma.voucherType.findFirst({
    where: { code: voucherType },
  });
  if (!voucherTypeRecord) throw new Error(`VoucherType not found: ${voucherType}. Run seed.`);

  // 3. Load all accounts for this company
  const accounts = await prisma.account.findMany({
    where: { companyId: company.id },
  });

  const findByRole = (role: string): string => {
    const acc = accounts.find((a) => a.role === role);
    if (!acc) throw new Error(`Account with role "${role}" not found. Run seed.`);
    return acc.id;
  };

  const findByCode = (code: string): string => {
    const acc = accounts.find((a) => a.code === code);
    if (!acc) throw new Error(`Account with code "${code}" not found. Run seed.`);
    return acc.id;
  };

  // 4. Resolve payment account (Cash or Bank)
  let paymentAccountId: string | undefined;
  if (paymentMode === "CASH") paymentAccountId = findByRole("CASH");
  if (paymentMode === "BANK") paymentAccountId = findByRole("BANK");

  // 5. Resolve expense account for EXPENSE_PAYMENT
  let expenseAccountId: string | undefined;
  if (voucherType === "PAYMENT" && subType === "EXPENSE_PAYMENT") {
    if (!expenseAccountCode)
      throw new Error("expenseAccountCode required for EXPENSE_PAYMENT (e.g. SALARY_EXPENSE)");
    expenseAccountId = findByCode(expenseAccountCode);
  }

  // 6. Validate party if provided
  if (partyId) {
    const party = await prisma.party.findUnique({ where: { id: partyId } });
    if (!party) throw new Error(`Party not found: ${partyId}`);
  }

  return {
    companyId: company.id,
    voucherTypeId: voucherTypeRecord.id,
    voucherType: voucherType as any,
    subType: subType ?? null,
    totalAmount: Number(totalAmount),
    paymentAccountId,
    expenseAccountId,
    journalEntries: journalEntries ?? undefined,
    narration: narration ?? null,
    voucherDate: new Date(voucherDate),
    partyId: partyId ?? null,
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
    const drafts = await prisma.voucher.findMany({
      where: { status: "DRAFT" },
      orderBy: { createdAt: "desc" },
      include: {
        voucherType: { select: { code: true, name: true } },
        party: { select: { id: true, name: true } },
        entries: { select: { side: true, amount: true } },
      },
    });

    const shaped = drafts.map((v) => {
      const totalAmount = v.entries
        .filter((e) => e.side === "DEBIT")
        .reduce((sum, e) => sum + Number(e.amount), 0);

      return {
        voucherId:     v.id,
        voucherType:   v.voucherType.code,
        subType:       v.subType ?? "N/A",
        voucherDate:   v.voucherDate,
        totalAmount,
        status:        v.status,
        narration:     v.narration,
        partyId:       v.party?.id ?? null,
        partyName:     v.party?.name ?? null,
        voucherNumber: v.voucherNumber,
        createdAt:     v.createdAt,
      };
    });

    res.json(shaped);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/vouchers/all
 * Returns all vouchers (DRAFT + POSTED + CANCELLED)
 */
router.get("/all", async (_req, res, next) => {
  try {
    const all = await prisma.voucher.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        voucherType: { select: { code: true } },
        party: { select: { id: true, name: true } },
        entries: { select: { side: true, amount: true } },
      },
    });

    const shaped = all.map((v) => {
      const totalAmount = v.entries
        .filter((e) => e.side === "DEBIT")
        .reduce((sum, e) => sum + Number(e.amount), 0);

      return {
        voucherId:     v.id,
        voucherType:   v.voucherType.code,
        subType:       v.subType ?? "N/A",
        voucherDate:   v.voucherDate,
        totalAmount,
        status:        v.status,
        narration:     v.narration,
        partyId:       v.party?.id ?? null,
        partyName:     v.party?.name ?? null,
        voucherNumber: v.voucherNumber,
        createdAt:     v.createdAt,
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
    const voucher  = await createDraftVoucher(resolved);
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
    if (!existing)                   throw new Error("Voucher not found");
    if (existing.status !== "DRAFT") throw new Error("Only DRAFT vouchers can be edited");

    const resolved = await resolveVoucherIds(req.body);
    const voucher  = await updateDraftVoucher(req.params.id, resolved);
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
    if (!existing)                   throw new Error("Voucher not found");
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
