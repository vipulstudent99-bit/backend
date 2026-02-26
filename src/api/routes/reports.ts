import { Router } from "express";
import { prisma } from "../../../prisma/client";
import { getTrialBalance } from "../../reports/trialBalance";
import { getProfitAndLoss } from "../../reports/profitAndLoss";

const router = Router();

/**
 * GET /api/reports/trial-balance
 */
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

/**
 * GET /api/reports/profit-loss
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
      fromDate:  new Date(String(from)),
      toDate:    new Date(String(to)),
    });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/party-ledger?partyId=...&from=...&to=...
 *
 * Returns the full ledger for a party:
 *   - Opening balance (from party.openingBalance)
 *   - All POSTED vouchers linked to this party (filtered by date range)
 *   - Running balance after each transaction
 *   - Closing balance
 *
 * Balance logic (AR/AP accounts):
 *   - CUSTOMER: AR account. DR increases what they owe us, CR decreases it.
 *   - SUPPLIER: AP account. CR increases what we owe them, DR decreases it.
 *   - BOTH: we look at both AR and AP entries linked to this party's vouchers.
 *
 * Running balance uses a signed approach:
 *   - We track "net amount owed by party to us" as positive (DR normal for customers)
 *   - For suppliers we flip: net amount we owe them is positive (CR normal for suppliers)
 */
router.get("/party-ledger", async (req, res, next) => {
  try {
    const { partyId, from, to } = req.query;

    if (!partyId || typeof partyId !== "string") {
      res.status(400).json({ message: "partyId is required" });
      return;
    }

    const company = await prisma.company.findFirst();
    if (!company) { res.status(404).json({ message: "No company found" }); return; }

    // Load party
    const party = await prisma.party.findUnique({ where: { id: partyId } });
    if (!party) { res.status(404).json({ message: "Party not found" }); return; }

    // Build date filter
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(String(from));
    if (to) {
      const toDate = new Date(String(to));
      toDate.setHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    }

    // Load all POSTED vouchers for this party in date range
    const vouchers = await prisma.voucher.findMany({
      where: {
        companyId: company.id,
        partyId:   partyId,
        status:    "POSTED",
        ...(Object.keys(dateFilter).length > 0 && { voucherDate: dateFilter }),
      },
      orderBy: { voucherDate: "asc" },
      include: {
        entries: {
          include: { account: { select: { role: true } } },
        },
      },
    });

    // Determine which account role is "the party's account"
    // CUSTOMER → AR (debits = they owe more, credits = they paid / we gave discount)
    // SUPPLIER → AP (credits = we owe more, debits = we paid)
    // BOTH → check both AR and AP entries
    const relevantRoles =
      party.type === "CUSTOMER" ? ["AR"] :
      party.type === "SUPPLIER" ? ["AP"] :
      ["AR", "AP"];

    // Opening balance from party model
    // openingBalanceSide: DR means party owes us (customer), CR means we owe them (supplier)
    let runningBalance = Number(party.openingBalance);
    let runningBalanceSide: "DR" | "CR" = party.openingBalanceSide as "DR" | "CR";

    // Helper: convert to signed number (positive = DR, negative = CR)
    const toSigned = (amount: number, side: "DR" | "CR") =>
      side === "DR" ? amount : -amount;

    const fromSigned = (signed: number): { amount: number; side: "DR" | "CR" } => ({
      amount: Math.abs(signed),
      side: signed >= 0 ? "DR" : "CR",
    });

    let signedBalance = toSigned(runningBalance, runningBalanceSide);

    // Build ledger rows
    const transactions = vouchers.map((v) => {
      // Sum up DR and CR on the relevant account(s) for this voucher
      let debit  = 0;
      let credit = 0;

      for (const entry of v.entries) {
        if (relevantRoles.includes(entry.account.role)) {
          if (entry.side === "DEBIT")  debit  += Number(entry.amount);
          if (entry.side === "CREDIT") credit += Number(entry.amount);
        }
      }

      // Update running balance
      signedBalance += debit - credit;
      const { amount: bal, side: balSide } = fromSigned(signedBalance);

      return {
        date:          v.voucherDate.toISOString(),
        voucherId:     v.id,
        voucherNumber: v.voucherNumber ?? undefined,
        narration:     v.narration ?? undefined,
        debit,
        credit,
        balance:       bal,
        balanceSide:   balSide,
      };
    });

    const closing = fromSigned(signedBalance);

    res.json({
      party: {
        id:                  party.id,
        code:                party.code,
        name:                party.name,
        type:                party.type,
        phone:               party.phone   ?? undefined,
        email:               party.email   ?? undefined,
        address:             party.address ?? undefined,
        openingBalance:      Number(party.openingBalance),
        openingBalanceSide:  party.openingBalanceSide,
        createdAt:           party.createdAt.toISOString(),
      },
      openingBalance:      Number(party.openingBalance),
      openingBalanceSide:  party.openingBalanceSide,
      transactions,
      closingBalance:      closing.amount,
      closingBalanceSide:  closing.side,
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/receivables
 * Returns customers with outstanding AR balance (who owes us)
 */
router.get("/receivables", async (_req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) { res.json([]); return; }

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
            voucher: { partyId: party.id, status: "POSTED" },
          },
          select: { side: true, amount: true },
        });

        // Opening balance contribution (DR = they owe us)
        const openingSignedDR =
          party.openingBalanceSide === "DR"
            ? Number(party.openingBalance)
            : -Number(party.openingBalance);

        const transactionNet = entries.reduce((sum, e) =>
          e.side === "DEBIT" ? sum + Number(e.amount) : sum - Number(e.amount)
        , 0);

        const net = openingSignedDR + transactionNet;

        return {
          partyId:      party.id,
          code:         party.code,
          name:         party.name,
          balance:      Math.abs(net),
          balanceSide:  net >= 0 ? "DR" : "CR",
        };
      })
    );

    // Only show parties that actually owe us (DR balance > 0)
    res.json(result.filter((r) => r.balance > 0 && r.balanceSide === "DR"));
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/payables
 * Returns suppliers with outstanding AP balance (we owe them)
 */
router.get("/payables", async (_req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) { res.json([]); return; }

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
            voucher: { partyId: party.id, status: "POSTED" },
          },
          select: { side: true, amount: true },
        });

        // Opening balance contribution (CR = we owe them)
        const openingSignedCR =
          party.openingBalanceSide === "CR"
            ? Number(party.openingBalance)
            : -Number(party.openingBalance);

        const transactionNet = entries.reduce((sum, e) =>
          e.side === "CREDIT" ? sum + Number(e.amount) : sum - Number(e.amount)
        , 0);

        const net = openingSignedCR + transactionNet;

        return {
          partyId:     party.id,
          code:        party.code,
          name:        party.name,
          balance:     Math.abs(net),
          balanceSide: net >= 0 ? "CR" : "DR",
        };
      })
    );

    // Only show parties we actually owe (CR balance > 0)
    res.json(result.filter((r) => r.balance > 0 && r.balanceSide === "CR"));
  } catch (err) { next(err); }
});

export default router;
