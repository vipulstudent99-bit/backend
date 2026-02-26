import { Router } from "express";
import { prisma } from "../../../prisma/client";
import { getTrialBalance } from "../../reports/trialBalance";
import { getProfitAndLoss } from "../../reports/profitAndLoss";

const router = Router();

// ─────────────────────────────────────────
// HELPER: Generic account book (Cash or Bank)
// Builds a running-balance ledger for a single
// account identified by its AccountRole.
// ─────────────────────────────────────────
async function getAccountBook(
  companyId: string,
  role: "CASH" | "BANK",
  fromDate?: Date,
  toDate?: Date
) {
  // 1. Find the account
  const account = await prisma.account.findFirst({
    where: { companyId, role },
  });
  if (!account) throw new Error(`No ${role} account found. Run seed.`);

  // 2. Opening balance = sum of all POSTED entries on this account BEFORE fromDate
  //    DR entries increase balance, CR entries decrease it
  let openingSignedBalance = 0;

  if (fromDate) {
    const prevEntries = await prisma.entry.findMany({
      where: {
        accountId: account.id,
        voucher: {
          companyId,
          status: "POSTED",
          voucherDate: { lt: fromDate },
        },
      },
      select: { side: true, amount: true },
    });
    openingSignedBalance = prevEntries.reduce((sum, e) =>
      e.side === "DEBIT"
        ? sum + Number(e.amount)
        : sum - Number(e.amount)
    , 0);
  }

  // 3. Load entries in date range (ordered by date)
  const dateFilter: any = {};
  if (fromDate) dateFilter.gte = fromDate;
  if (toDate) {
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    dateFilter.lte = end;
  }

  const entries = await prisma.entry.findMany({
    where: {
      accountId: account.id,
      voucher: {
        companyId,
        status: "POSTED",
        ...(Object.keys(dateFilter).length > 0 && { voucherDate: dateFilter }),
      },
    },
    orderBy: [
      { voucher: { voucherDate: "asc" } },
      { voucher: { createdAt: "asc" } },
    ],
    include: {
      voucher: {
        include: {
          voucherType: { select: { code: true } },
          party:       { select: { name: true } },
        },
      },
    },
  });

  // 4. Build rows with running balance
  let runningSignedBalance = openingSignedBalance;

  const transactions = entries.map((e) => {
    const debit  = e.side === "DEBIT"  ? Number(e.amount) : 0;
    const credit = e.side === "CREDIT" ? Number(e.amount) : 0;
    runningSignedBalance += debit - credit;

    return {
      date:          e.voucher.voucherDate.toISOString(),
      voucherId:     e.voucher.id,
      voucherNumber: e.voucher.voucherNumber ?? undefined,
      voucherType:   e.voucher.voucherType.code,
      subType:       e.voucher.subType ?? undefined,
      narration:     e.voucher.narration ?? undefined,
      partyName:     e.voucher.party?.name ?? undefined,
      debit,
      credit,
      balance:     Math.abs(runningSignedBalance),
      balanceSide: runningSignedBalance >= 0 ? "DR" : "CR",
    };
  });

  const openingAbs  = Math.abs(openingSignedBalance);
  const closingAbs  = Math.abs(runningSignedBalance);

  // Summary totals
  const totalDebit  = transactions.reduce((s, r) => s + r.debit,  0);
  const totalCredit = transactions.reduce((s, r) => s + r.credit, 0);

  return {
    accountId:           account.id,
    accountCode:         account.code,
    accountName:         account.name,
    openingBalance:      openingAbs,
    openingBalanceSide:  openingSignedBalance >= 0 ? "DR" : "CR",
    transactions,
    totalDebit,
    totalCredit,
    closingBalance:      closingAbs,
    closingBalanceSide:  runningSignedBalance >= 0 ? "DR" : "CR",
  };
}

// ─────────────────────────────────────────
// GET /api/reports/cash-book
// ─────────────────────────────────────────
router.get("/cash-book", async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error("No company found. Run seed.");

    const { from, to } = req.query;
    const result = await getAccountBook(
      company.id,
      "CASH",
      from ? new Date(String(from)) : undefined,
      to   ? new Date(String(to))   : undefined
    );
    res.json(result);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// GET /api/reports/bank-book
// ─────────────────────────────────────────
router.get("/bank-book", async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error("No company found. Run seed.");

    const { from, to } = req.query;
    const result = await getAccountBook(
      company.id,
      "BANK",
      from ? new Date(String(from)) : undefined,
      to   ? new Date(String(to))   : undefined
    );
    res.json(result);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// GET /api/reports/trial-balance
// ─────────────────────────────────────────
router.get("/trial-balance", async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error("No company found. Run seed.");
    const { from, to } = req.query;
    const rows = await getTrialBalance({
      companyId: company.id,
      fromDate: from ? new Date(String(from)) : undefined,
      toDate:   to   ? new Date(String(to))   : undefined,
    });
    const totalDebit  = rows.reduce((s: number, r: any) => s + r.debit,  0);
    const totalCredit = rows.reduce((s: number, r: any) => s + r.credit, 0);
    res.json({ rows, totalDebit, totalCredit, isBalanced: totalDebit === totalCredit });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// GET /api/reports/profit-loss
// ─────────────────────────────────────────
router.get("/profit-loss", async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error("No company found. Run seed.");
    const { from, to } = req.query;
    if (!from || !to) { res.status(400).json({ message: "from and to query params are required" }); return; }
    const result = await getProfitAndLoss({
      companyId: company.id,
      fromDate:  new Date(String(from)),
      toDate:    new Date(String(to)),
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// GET /api/reports/party-ledger
// ─────────────────────────────────────────
router.get("/party-ledger", async (req, res, next) => {
  try {
    const { partyId, from, to } = req.query;
    if (!partyId || typeof partyId !== "string") { res.status(400).json({ message: "partyId is required" }); return; }

    const company = await prisma.company.findFirst();
    if (!company) { res.status(404).json({ message: "No company found" }); return; }

    const party = await prisma.party.findUnique({ where: { id: partyId } });
    if (!party) { res.status(404).json({ message: "Party not found" }); return; }

    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(String(from));
    if (to) { const d = new Date(String(to)); d.setHours(23,59,59,999); dateFilter.lte = d; }

    const vouchers = await prisma.voucher.findMany({
      where: {
        companyId,
        partyId,
        status: "POSTED",
        ...(Object.keys(dateFilter).length > 0 && { voucherDate: dateFilter }),
      },
      orderBy: { voucherDate: "asc" },
      include: {
        entries: { include: { account: { select: { role: true } } } },
      },
    });

    const relevantRoles =
      party.type === "CUSTOMER" ? ["AR"] :
      party.type === "SUPPLIER" ? ["AP"] :
      ["AR", "AP"];

    let signedBalance =
      party.openingBalanceSide === "DR"
        ? Number(party.openingBalance)
        : -Number(party.openingBalance);

    const toSigned = (a: number, s: "DR" | "CR") => s === "DR" ? a : -a;
    const fromSigned = (n: number) => ({ amount: Math.abs(n), side: (n >= 0 ? "DR" : "CR") as "DR" | "CR" });

    const transactions = vouchers.map((v) => {
      let debit = 0; let credit = 0;
      for (const entry of v.entries) {
        if (relevantRoles.includes(entry.account.role)) {
          if (entry.side === "DEBIT")  debit  += Number(entry.amount);
          if (entry.side === "CREDIT") credit += Number(entry.amount);
        }
      }
      signedBalance += debit - credit;
      const { amount: bal, side: balSide } = fromSigned(signedBalance);
      return {
        date:          v.voucherDate.toISOString(),
        voucherId:     v.id,
        voucherNumber: v.voucherNumber ?? undefined,
        narration:     v.narration ?? undefined,
        debit, credit,
        balance:     bal,
        balanceSide: balSide,
      };
    });

    const closing = fromSigned(signedBalance);
    res.json({
      party: {
        id: party.id, code: party.code, name: party.name, type: party.type,
        phone: party.phone ?? undefined, email: party.email ?? undefined,
        address: party.address ?? undefined,
        openingBalance: Number(party.openingBalance),
        openingBalanceSide: party.openingBalanceSide,
        createdAt: party.createdAt.toISOString(),
      },
      openingBalance:     Number(party.openingBalance),
      openingBalanceSide: party.openingBalanceSide,
      transactions,
      closingBalance:     closing.amount,
      closingBalanceSide: closing.side,
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// GET /api/reports/receivables
// ─────────────────────────────────────────
router.get("/receivables", async (_req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) { res.json([]); return; }
    const arAccount = await prisma.account.findFirst({ where: { companyId: company.id, role: "AR" } });
    if (!arAccount) { res.json([]); return; }
    const parties = await prisma.party.findMany({ where: { companyId: company.id, type: { in: ["CUSTOMER", "BOTH"] } } });
    const result = await Promise.all(parties.map(async (party) => {
      const entries = await prisma.entry.findMany({
        where: { accountId: arAccount.id, voucher: { partyId: party.id, status: "POSTED" } },
        select: { side: true, amount: true },
      });
      const openingDR = party.openingBalanceSide === "DR" ? Number(party.openingBalance) : -Number(party.openingBalance);
      const net = openingDR + entries.reduce((s, e) => e.side === "DEBIT" ? s + Number(e.amount) : s - Number(e.amount), 0);
      return { partyId: party.id, code: party.code, name: party.name, balance: Math.abs(net), balanceSide: net >= 0 ? "DR" : "CR" };
    }));
    res.json(result.filter((r) => r.balance > 0 && r.balanceSide === "DR"));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// GET /api/reports/payables
// ─────────────────────────────────────────
router.get("/payables", async (_req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) { res.json([]); return; }
    const apAccount = await prisma.account.findFirst({ where: { companyId: company.id, role: "AP" } });
    if (!apAccount) { res.json([]); return; }
    const parties = await prisma.party.findMany({ where: { companyId: company.id, type: { in: ["SUPPLIER", "BOTH"] } } });
    const result = await Promise.all(parties.map(async (party) => {
      const entries = await prisma.entry.findMany({
        where: { accountId: apAccount.id, voucher: { partyId: party.id, status: "POSTED" } },
        select: { side: true, amount: true },
      });
      const openingCR = party.openingBalanceSide === "CR" ? Number(party.openingBalance) : -Number(party.openingBalance);
      const net = openingCR + entries.reduce((s, e) => e.side === "CREDIT" ? s + Number(e.amount) : s - Number(e.amount), 0);
      return { partyId: party.id, code: party.code, name: party.name, balance: Math.abs(net), balanceSide: net >= 0 ? "CR" : "DR" };
    }));
    res.json(result.filter((r) => r.balance > 0 && r.balanceSide === "CR"));
  } catch (err) { next(err); }
});

export default router;
