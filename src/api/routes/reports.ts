import { Router } from "express";
import { prisma } from "../../../prisma/client";
import { getTrialBalance } from "../../reports/trialBalance";
import { getProfitAndLoss } from "../../reports/profitAndLoss";

const router = Router();

/**
 * GET /api/reports/trial-balance
 * Query: from, to (optional ISO date strings)
 */
router.get("/trial-balance", async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error("No company found. Run seed.");

    const { from, to } = req.query;

    const rows = await getTrialBalance({
      companyId: company.id,
      fromDate: from ? new Date(String(from)) : undefined,
      toDate: to ? new Date(String(to)) : undefined,
    });

    const totalDebit = rows.reduce((s: number, r: any) => s + r.debit, 0);
    const totalCredit = rows.reduce((s: number, r: any) => s + r.credit, 0);

    res.json({
      rows,
      totalDebit,
      totalCredit,
      isBalanced: totalDebit === totalCredit,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/profit-loss
 * Query: from, to (required ISO date strings)
 */
router.get("/profit-loss", async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error("No company found. Run seed.");

    const { from, to } = req.query;
    if (!from || !to) {
      res.status(400).json({ message: "from and to query params are required" });
      return;
    }

    const result = await getProfitAndLoss({
      companyId: company.id,
      fromDate: new Date(String(from)),
      toDate: new Date(String(to)),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/receivables
 * Returns all parties with outstanding AR balance (who owes us)
 */
router.get("/receivables", async (_req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error("No company found. Run seed.");

    const arAccount = await prisma.account.findFirst({
      where: { companyId: company.id, role: "AR" },
    });
    if (!arAccount) { res.json([]); return; }

    const parties = await prisma.party.findMany({
      where: { companyId: company.id, type: { in: ["CUSTOMER", "BOTH"] } },
    });

    const result = await Promise.all(
      parties.map(async (party) => {
        const entries = await prisma.entry.findMany({
          where: {
            accountId: arAccount.id,
            partyId: party.id,
            voucher: { status: "POSTED" },
          },
          select: { side: true, amount: true },
        });

        const balance = entries.reduce((sum, e) => {
          return e.side === "DEBIT" ? sum + Number(e.amount) : sum - Number(e.amount);
        }, 0);

        return {
          partyId: party.id,
          code: party.code,
          name: party.name,
          balance,
          balanceSide: balance >= 0 ? "DR" : "CR",
        };
      })
    );

    res.json(result.filter((r) => r.balance > 0));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/payables
 * Returns all parties with outstanding AP balance (who we owe)
 */
router.get("/payables", async (_req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error("No company found. Run seed.");

    const apAccount = await prisma.account.findFirst({
      where: { companyId: company.id, role: "AP" },
    });
    if (!apAccount) { res.json([]); return; }

    const parties = await prisma.party.findMany({
      where: { companyId: company.id, type: { in: ["SUPPLIER", "BOTH"] } },
    });

    const result = await Promise.all(
      parties.map(async (party) => {
        const entries = await prisma.entry.findMany({
          where: {
            accountId: apAccount.id,
            partyId: party.id,
            voucher: { status: "POSTED" },
          },
          select: { side: true, amount: true },
        });

        const balance = entries.reduce((sum, e) => {
          return e.side === "CREDIT" ? sum + Number(e.amount) : sum - Number(e.amount);
        }, 0);

        return {
          partyId: party.id,
          code: party.code,
          name: party.name,
          balance,
          balanceSide: balance >= 0 ? "CR" : "DR",
        };
      })
    );

    res.json(result.filter((r) => r.balance > 0));
  } catch (err) {
    next(err);
  }
});

export default router;
