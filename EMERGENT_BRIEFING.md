# FinanceSaathi — Emergent Session Briefing

> ⚠️ READ THIS FIRST before making ANY changes.
> This document is the single source of truth for what the backend expects.
> Do NOT modify backend API calls, request shapes, or field names without checking here.

---

## 🏗️ Architecture Overview

- **Frontend:** React + Vite + TypeScript + Tailwind (`frontend/` folder)
- **Backend:** Node.js + Express + TypeScript + Prisma v6 (separate repo — https://github.com/zacky-ctrl/backend)
- **Database:** PostgreSQL
- **Frontend talks to backend via:** Vite proxy `/api` → `http://localhost:3001`
- **All accounting logic lives in the backend. The frontend NEVER calculates balances or generates entries.**

---

## ✅ What Is Working Right Now — DO NOT BREAK

1. Record Sale (Cash Sale + Credit Sale)
2. Record Purchase / Supplier Bill (Cash + Credit)
3. Expense Payments (Salary, Rent, Freight, Utility, Other Expense)
4. Customers & Suppliers (list, add, edit, delete)
5. Who Owes You — Receivables list + drill into party ledger
6. Who You Owe — Payables list + drill into party ledger
7. Trial Balance
8. Profit & Loss
9. Cash Book
10. Bank Book

---

## 🔌 Backend API Reference

### Base URL
```
Dev:  http://localhost:3001  (proxied via /api in Vite config)
```

---

### VOUCHERS

#### POST /api/vouchers/draft

**Cash Sale:**
```json
{ "voucherType": "SALE", "subType": "CASH_SALE", "paymentMode": "CASH", "totalAmount": 5000, "voucherDate": "2026-02-27" }
```

**Credit Sale:**
```json
{ "voucherType": "SALE", "subType": "CREDIT_SALE", "totalAmount": 5000, "partyId": "<uuid>", "voucherDate": "2026-02-27" }
```

**Cash Purchase:**
```json
{ "voucherType": "PURCHASE", "subType": "CASH_PURCHASE", "paymentMode": "CASH", "totalAmount": 3000, "voucherDate": "2026-02-27" }
```

**Supplier Bill (Credit Purchase):**
```json
{ "voucherType": "PURCHASE", "subType": "CREDIT_PURCHASE", "totalAmount": 3000, "partyId": "<uuid>", "voucherDate": "2026-02-27" }
```

**Expense Payment:**
```json
{
  "voucherType": "PAYMENT",
  "subType": "EXPENSE_PAYMENT",
  "paymentCategory": "SALARY",
  "paymentMode": "CASH",
  "totalAmount": 15000,
  "voucherDate": "2026-02-27"
}
```
⚠️ paymentCategory must be: SALARY | RENT | FREIGHT | UTILITY | OTHER
⚠️ Do NOT use expenseAccountCode — always use paymentCategory

**Vendor Payment:**
```json
{ "voucherType": "PAYMENT", "subType": "VENDOR_PAYMENT", "paymentMode": "CASH", "totalAmount": 5000, "partyId": "<uuid>", "voucherDate": "2026-02-27" }
```

**Receipt (Customer pays you):**
```json
{ "voucherType": "RECEIPT", "subType": "RECEIPT", "paymentMode": "CASH", "totalAmount": 5000, "partyId": "<uuid>", "voucherDate": "2026-02-27" }
```

**Owner Withdrawal:**
```json
{ "voucherType": "PAYMENT", "subType": "OWNER_WITHDRAWAL", "paymentMode": "CASH", "totalAmount": 2000, "voucherDate": "2026-02-27" }
```

#### GET /api/vouchers/drafts
Returns DRAFT vouchers.
```json
[{ "voucherId": "", "voucherType": "SALE", "subType": "CASH_SALE", "voucherDate": "", "totalAmount": 5000, "status": "DRAFT", "narration": null, "partyId": null, "partyName": null, "voucherNumber": null, "createdAt": "" }]
```

#### GET /api/vouchers/all
Same shape — returns ALL vouchers (DRAFT + POSTED + CANCELLED).

#### POST /api/vouchers/:id/post
Post (finalize) a draft. No body needed.

#### PATCH /api/vouchers/draft/:id
```json
{ "totalAmount": 6000, "narration": "updated", "voucherDate": "2026-02-28", "partyId": "<uuid or null>" }
```

#### DELETE /api/vouchers/draft/:id
Deletes a DRAFT voucher.

---

### PARTIES

#### POST /api/parties
```json
{ "name": "Rupali Traders", "type": "CUSTOMER", "phone": "9876543210", "email": "rupali@example.com", "address": "Mumbai", "openingBalance": 5000, "openingBalanceSide": "DR" }
```
type: CUSTOMER | SUPPLIER | BOTH
openingBalanceSide: DR | CR

#### GET /api/parties?type=CUSTOMER
```json
[{ "id": "", "code": "", "name": "", "type": "CUSTOMER", "phone": null, "email": null, "openingBalance": 0, "openingBalanceSide": "DR", "createdAt": "" }]
```

#### PATCH /api/parties/:id
Update any field (all optional).

#### DELETE /api/parties/:id
Returns `{ deleted: true }`

---

### REPORTS

#### GET /api/reports/receivables
```json
[{ "partyId": "", "code": "", "name": "", "balance": 5000, "balanceSide": "DR" }]
```

#### GET /api/reports/payables
Same shape, balanceSide: "CR"

#### GET /api/reports/party-ledger?partyId=xxx&from=YYYY-MM-DD&to=YYYY-MM-DD
```json
{
  "party": { "id": "", "name": "", "type": "CUSTOMER" },
  "openingBalance": 5000, "openingBalanceSide": "DR",
  "transactions": [{ "date": "", "voucherId": "", "narration": "", "debit": 5000, "credit": 0, "balance": 5000, "balanceSide": "DR" }],
  "closingBalance": 5000, "closingBalanceSide": "DR"
}
```

#### GET /api/reports/cash-book?from=YYYY-MM-DD&to=YYYY-MM-DD
#### GET /api/reports/bank-book?from=YYYY-MM-DD&to=YYYY-MM-DD
```json
{
  "accountName": "Cash",
  "openingBalance": 10000, "openingBalanceSide": "DR",
  "transactions": [{ "date": "", "voucherType": "SALE", "narration": "", "debit": 5000, "credit": 0, "balance": 15000, "balanceSide": "DR" }],
  "totalDebit": 5000, "totalCredit": 2000,
  "closingBalance": 13000, "closingBalanceSide": "DR"
}
```

#### GET /api/reports/trial-balance
```json
{ "rows": [{ "accountName": "Cash", "debit": 15000, "credit": 0 }], "totalDebit": 15000, "totalCredit": 15000, "isBalanced": true }
```

#### GET /api/reports/profit-loss?from=YYYY-MM-DD&to=YYYY-MM-DD
```json
{ "income": 50000, "expenses": 30000, "netProfit": 20000 }
```

---

## 🚫 Hard Rules — Never Violate

1. Never calculate balances in the frontend — all numbers come from the API
2. Never add accounting logic in any React component or utility file
3. Never send `expenseAccountCode` — use `paymentCategory` only
4. Always use `partyId` (UUID) for party-linked vouchers — never send party name
5. Never auto-post a voucher — always require a human confirmation button click
6. Never touch the real backend repo (https://github.com/zacky-ctrl/backend)
7. The `backend/` folder inside the Emergent repo is an internal copy — ignore it

---

## 📁 Frontend Files Emergent May Edit

```
frontend/src/
  components/     ← UI components (safe to edit)
  pages/          ← Page-level screens (safe to edit)
  hooks/          ← Custom hooks (safe to edit)
  services/       ← API call functions (edit carefully — must match shapes above)
  types/          ← TypeScript types (keep in sync with API shapes)
  App.tsx         ← Routing (safe to edit)
  main.tsx        ← Entry point (DO NOT TOUCH)
```

---

## 🎯 Today's Task for Emergent

> Replace the section below with what you want changed today.

**[PASTE YOUR UI CHANGE REQUEST HERE]**
