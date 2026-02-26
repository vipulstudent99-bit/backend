import express from "express";
import vouchersRouter from "./api/routes/vouchers";
import { requireAuth } from "./api/middleware/requireAuth";

const app = express();

/**
 * Middleware
 */
app.use(express.json());
// Temporary dev auth — sets req.user for all routes
app.use((req: any, _res, next) => {
  req.user = { id: "demo-user-id", role: "Admin" };
  next();
});


/**
 * Routes
 */
app.use("/api/vouchers", vouchersRouter);

/**
 * Global error handler
 */
app.use((err: any, _req: any, res: any, _next: any) => {
    console.error(err);
    res.status(400).json({
        error: err?.message ?? "Unknown error",
    });
});

/**
 * Server
 * IMPORTANT: Hardcoded port to avoid env collision with frontend
 */
const PORT = 3001;

app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
});
