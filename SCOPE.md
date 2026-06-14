# SCOPE.md — Anomaly Log + Database Schema

## Database Schema

### Tables (6 migrations + 2 patches)
users, groups, group_members, expenses, expense_splits, 
settlements, import_sessions, import_anomalies

### Key design choices
- group_members.joined_at / left_at: membership date tracking
- expenses.amount_inr: stored (not computed) for historical accuracy
- expenses.exchange_rate: rate at import time, preserved forever
- expense_splits.user_id nullable: allows external participants
- import_sessions.usd_rate_used: full auditability of USD conversion
- import_sessions.preview_data: stores preview for confirm phase
- settlements.import_session_id: enables rollback of imported settlements

## Import Engine (P8) — Anomaly Handling Policies

This document records every policy decision made in the CSV import engine.
The assignment evaluator can trace any row through the engine and find the
governing policy here.

---

## Anomaly Policies

| Anomaly Type | Action | Rationale |
|---|---|---|
| `missing_paid_by` | **Skipped** | No payer = no debt attribution. Cannot import. |
| `zero_amount` | **Skipped** | A ₹0 expense has no financial effect and cannot be split. |
| `invalid_amount` | **Skipped** | Unparseable amount — data is corrupt. |
| `invalid_date` | **Skipped** | Unparseable date — cannot assign expense to a time window. |
| `duplicate_entry` | **Skipped** | Exact duplicate within the same CSV (same date, amount, description, payer). First occurrence wins. |
| `conflicting_entries` | **Pending review** | Same event logged with different amounts/payers on the same date (keyword overlap). User must choose at confirm time. |
| `percentage_sum_not_100` | **Imported with flag** | Percentages ≠ 100% is a *warning*, not a hard error (spec P8 explicit). Splits are recorded as declared; group reconciles manually. |
| `negative_amount` | **Imported with flag** | Negative amounts are refunds — valid transactions that reduce the payer's net credit. |
| `comma_in_amount` | **Imported with flag** | Comma treated as thousands separator. `"1,200"` → `1200`. |
| `whitespace_in_amount` | **Imported with flag** | Leading/trailing whitespace stripped. Possible spreadsheet artefact. |
| `excessive_decimal` | **Imported with flag** | More than 2 decimal places — rounded. e.g. `899.995` → `900`. |
| `ambiguous_date` | **Imported with flag** | Non-ISO date format (DD/MM/YYYY, "Mar 14", etc.). Best-guess parse applied; original preserved. |
| `name_mismatch` | **Imported with flag** | Case-insensitive or prefix match to a group member. `"priya"` → Priya (id=4). `"Priya S"` → Priya (id=4). |
| `unknown_payer` | **Imported with flag** | Named person is not a group member (e.g. Dev, Kabir). Recorded with `paid_by_user_id = NULL`. Balance tracked via `external_receivables`, not group balance. |
| `unknown_participant` | **Imported with flag** | A name in `split_with` is not a group member. Recorded with `user_id = NULL` in `expense_splits`. External share excluded from group balance calculations. |
| `usd_amount` | **Imported with flag** | Currency was USD. Converted to INR using the session `usd_rate`. Both amounts stored. |
| `missing_currency` | **Imported with flag** | Currency field blank; defaulted to INR. |
| `post_departure_member` | **Imported with flag** | Participant had left the group before the expense date. Removed from split; shares redistributed to active members only. |
| `conflicting_split_type` | **Imported with flag** | `split_type = "equal"` but `split_details` had numeric values. Engine treats it as unequal split. |
| `split_warning` | **Imported with flag** | Non-critical split mismatch (e.g. unequal amounts don't sum exactly to total). |

---

## Zero-Sum Invariant

Group net balances **must always sum to zero**.

- External participant shares (`user_id IS NULL` in `expense_splits`) paid for by group members are subtracted from the payer's credit via Query E in `balanceService`.
- Expenses paid by external payers (`paid_by_user_id IS NULL`) are excluded from `total_owed` (Query B) entirely — Query B uses a pre-joined INNER JOIN to prevent the chained-LEFT-JOIN leak. Members owe the external person directly, not via the group balance.

---

## Documented User Decisions

### Row 23 vs Row 24 — "Thalassa dinner" (2026-03-22)

**Conflict detected**: two entries on the same date with overlapping keywords and different amounts/payers.

| | Row 23 | Row 24 |
|---|---|---|
| Description | Dinner at Thalassa | Thalassa dinner |
| Paid by | Aisha | Rohan |
| Amount | ₹2,400 | ₹2,450 |
| Notes | — | "Aisha also logged this I think hers is wrong" |

**Decision**: Import Row 24 (Rohan's entry, ₹2,450). Skip Row 23 (Aisha's entry).

**Rationale**: Row 24's note explicitly states Rohan believes Aisha's entry is incorrect, indicating higher confidence in his figure. Per the conflict resolution policy, when one entry has a corroborating note disputing the other, the noted entry takes precedence.

**user_decisions at confirm:**
```json
[
  { "row_number": 23, "action": "skipped" },
  { "row_number": 24, "action": "imported" }
]
```

---

## Balance Calculation Formula

```
net_balance = total_paid − external_shares − total_owed + settlements_paid − settlements_received
```

- `settlements_received` is **subtracted**: money already received reduces outstanding credit.
- `settlements_paid` is **added**: money already paid out reduces outstanding debt.

## Membership Date Filtering

- **Sam** joined 2026-04-08. Queries A and B both filter `e.date >= gm.joined_at` — pre-April expenses excluded from his totals.
- **Meera** left 2026-03-31. Expenses dated ≥ 2026-03-31 excluded from her `total_owed`. Row 35 (April 2 Groceries) was redistributed at import — Meera has zero split.

---

## External Receivables

Expenses paid by external payers (Dev, Kabir) are stored for audit trail but:

- Do **not** contribute to any member's `total_paid`.
- Member splits are **excluded** from `total_owed` (`paid_by_user_id IS NOT NULL` filter).
- Appear in `external_receivables` in the balances response — collected directly, outside the group settlement flow.
