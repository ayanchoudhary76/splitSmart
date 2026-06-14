# Decision Log

## D1 — Knex over Prisma
Options considered: Prisma, Knex, raw pg driver.
Chosen: Knex.
Why: Knex migrations are plain JS files. Queries read like SQL.
The live evaluation asks "why does this line exist?" for any 
line in the repo — Knex is fully explainable. Prisma's generated
queries and schema abstraction are harder to trace under pressure.

## D2 — Store amount_inr as a column, not computed
Options: compute on read (always multiply amount × exchange_rate),
         store as a column.
Chosen: store.
Why: Historical accuracy. If the USD/INR rate changes tomorrow,
old expenses must reflect the rate at the time they were recorded.
The rate used per import session is also stored in
import_sessions.usd_rate_used for full auditability.

## D3 — created_by vs admin_user_id on groups (two separate columns)
Options: single "admin" column, separate columns.
Chosen: separate columns.
Why: created_by is immutable history — who originally made the group.
admin_user_id is current governance — who holds admin rights now.
These are different concepts. A group's origin and its current
admin can diverge (admin transferred).

## D4 — Admin must transfer rights before leaving
Options: any member can leave anytime, admin must transfer first.
Chosen: admin must transfer or delete the group.
Why: A leaderless group cannot manage members or resolve conflicts.
If the admin is the last member, they can leave freely (group empties).

## D5 — Soft delete for group membership
Options: hard delete membership row, soft delete with left_at date.
Chosen: soft delete (left_at = NULL means active, date means departed).
Why: Balance history depends on knowing Meera was active in Feb-Mar
and Sam was not active until mid-April. Hard deletes would make
membership-date-filtered balance queries impossible.

## D6 — pg DATE type fix (types.setTypeParser)
Problem: PostgreSQL DATE columns return as JS Date objects.
JSON.stringify converts 2026-02-01 00:00:00 IST to 2026-01-31T18:30:00Z
(off by one day due to IST timezone offset).
Fix: pg.types.setTypeParser(1082, val => val) — returns dates as
YYYY-MM-DD strings, not Date objects.
Why matters: Sam's join-date and Meera's departure date are used in
balance SQL filters. A one-day error would silently include/exclude
the wrong expenses.

## D7 — Split calculator as a separate service
Options: inline in expenseController, separate service file.
Chosen: separate service (splitCalculator.js).
Why: The import engine and manual expense creation must use
identical calculation logic. A separate pure function (no DB,
no Express) is reusable by both. Tests run without any mocking.

## D8 — Warnings don't block imports, errors do
Options: block on any anomaly, warn and continue.
Chosen: warn and continue (surfaced to user, never silent).
Why: A percentage sum of 110% (Pizza Friday) is a data quality
issue but the data is still usable. Blocking would mean no way
to import the expense at all. The assignment explicitly states
"a crashed import and a silent guess are both failing answers."

## D9 — Zero-sum invariant for group balances
Rule: sum of all member net_balances must always equal zero.
Implementation: external participant shares are subtracted from
the payer's credit via a separate SQL query (Query E).
Why: Without this, external participants (Kabir) create a money
leak — the payer gets full credit but no one owes the external share.

## D10 — Two-phase import (preview then confirm)
Options: single-step import, two-phase preview/confirm.
Chosen: two-phase.
Why: Meera's requirement — "I want to approve anything the app
deletes or changes." The preview phase shows every anomaly and
proposed action before a single row is written to the database.
User decisions on conflicting rows are recorded before commit.

## D11 — Thalassa dinner conflict resolution
Two entries on 2026-03-22: Row 23 (Aisha, ₹2400) vs Row 24 (Rohan, ₹2450).
Policy: Row 24's note says "Aisha also logged this I think hers is wrong."
Decision: import Row 24, skip Row 23.
Why: An explicit note disputing the other entry is the strongest
available signal. When one entry has a corroborating note, it wins.
