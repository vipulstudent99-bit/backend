import { Router } from "express";
import { prisma } from "../../../prisma/client";

const router = Router();

/**
 * GET /api/parties
 * List all parties for the company
 * Optional query: ?type=CUSTOMER | SUPPLIER | BOTH
 */
router.get("/", async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) { res.json([]); return; }

    const { type } = req.query;

    const parties = await prisma.party.findMany({
      where: {
        companyId: company.id,
        ...(type ? { type: String(type) as any } : {}),
      },
      orderBy: { name: "asc" },
    });

    res.json(parties);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/parties/:id
 * Get a single party by ID
 */
router.get("/:id", async (req, res, next) => {
  try {
    const party = await prisma.party.findUnique({
      where: { id: req.params.id },
    });
    if (!party) { res.status(404).json({ message: "Party not found" }); return; }
    res.json(party);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/parties
 * Create a new party
 */
router.post("/", async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error("No company found. Run seed.");

    const { name, type, phone, email, address, openingBalance, openingBalanceSide } = req.body;

    if (!name || !type) {
      res.status(400).json({ message: "name and type are required" });
      return;
    }

    // Auto-generate a unique code
    const count = await prisma.party.count({ where: { companyId: company.id } });
    const prefix = type === "CUSTOMER" ? "CUST" : type === "SUPPLIER" ? "SUPP" : "PARTY";
    const code = `${prefix}-${String(count + 1).padStart(4, "0")}`;

    const party = await prisma.party.create({
      data: {
        companyId: company.id,
        code,
        name,
        type,
        phone: phone || null,
        email: email || null,
        address: address || null,
        openingBalance: openingBalance ? parseFloat(openingBalance) : 0,
        openingBalanceSide: openingBalanceSide || "DR",
      },
    });

    res.status(201).json(party);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/parties/:id
 * Update an existing party
 */
router.put("/:id", async (req, res, next) => {
  try {
    const { name, type, phone, email, address, openingBalance, openingBalanceSide } = req.body;

    const party = await prisma.party.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(address !== undefined && { address }),
        ...(openingBalance !== undefined && { openingBalance: parseFloat(openingBalance) }),
        ...(openingBalanceSide !== undefined && { openingBalanceSide }),
      },
    });

    res.json(party);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/parties/:id
 * Delete a party
 */
router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.party.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
