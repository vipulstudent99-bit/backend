import { Router } from "express";
import { requireRole } from "../middleware/requireRole.js";
import { getTrialBalance } from "../../reports/trialBalance.js";
import { getProfitAndLoss } from "../../reports/profitAndLoss.js";

const router = Router();

/**
 * GET /api/reports/trial-balance
 */
router.get(
    "/trial-balance",
    requireRole(["Accountant", "Admin"]),
    async (req, res, next) => {
        try {
            const { companyId, fromDate, toDate } = req.query;

            const result = await getTrialBalance({
                companyId: String(companyId),
                fromDate: fromDate ? new Date(String(fromDate)) : undefined,
                toDate: toDate ? new Date(String(toDate)) : undefined,
            });

            res.json(result);
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /api/reports/profit-loss
 */
router.get(
    "/profit-loss",
    requireRole(["Accountant", "Admin"]),
    async (req, res, next) => {
        try {
            const { companyId, fromDate, toDate } = req.query;

            const result = await getProfitAndLoss({
                companyId: String(companyId),
                fromDate: fromDate ? new Date(String(fromDate)) : undefined,
                toDate: toDate ? new Date(String(toDate)) : undefined,
            });

            res.json(result);
        } catch (err) {
            next(err);
        }
    }
);

export default router;
