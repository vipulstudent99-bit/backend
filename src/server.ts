import express from "express";
import vouchersRouter from "./api/routes/vouchers";
import reportsRouter from "./api/routes/reports";
import partiesRouter from "./api/routes/parties";

const app = express();

/**
 * Middleware
 */
app.use(express.json());

// Dev auth stub — sets req.user so requireRole() works
app.use((req: any, _res, next) => {
  req.user = { id: "demo-user-id", role: "Admin" };
  next();
});

/**
 * Health check
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Routes
 */
app.use("/api/vouchers", vouchersRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/parties", partiesRouter);

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
 */
const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});

export { app };
