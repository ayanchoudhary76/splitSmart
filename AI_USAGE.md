# AI Usage Log

## Tools Used
- **Claude (Anthropic)** — technical architect: wrote all Antigravity 
  prompts, designed database schema, balance calculation logic, 
  import anomaly policies. Every architectural decision was reviewed 
  and understood before implementation.
- **Antigravity (Claude Sonnet backend)** — primary code generation 
  for all server-side files.
- **Antigravity (Gemini frontend)** — UI page generation and styling.

## How AI Was Used
Claude was used as a senior engineer collaborator, not a code generator.
Each prompt was bounded to one feature, included explicit constraints,
and required verification steps before proceeding. Sahil reviewed every
file before committing and ran all tests manually on a real Neon database
via Postman.

## Three Cases Where AI Produced Something Wrong

### Case 1 — Mock DB tests instead of real DB tests (P3)
Antigravity generated a 22-test mock-DB test suite for authentication
instead of testing against the real Neon database.
Problem: Mock tests exercise Express routing and JWT logic but cannot
catch SQL errors, constraint violations, or schema mismatches.
Caught by: Noticing that all test infrastructure was in-memory.
Fix: Connected to real Neon database, ran all auth flows via Postman,
caught a LOWER() email comparison issue that only appeared with real SQL.
Lesson: Mock tests are for unit logic only. Integration paths need a real DB.

### Case 2 — pg DATE timezone bug not anticipated (P4)
After building the groups feature, Postman responses showed:
  joined_at: "2026-01-31T18:30:00.000Z" instead of "2026-02-01"
Antigravity had not accounted for the pg driver returning DATE columns
as JS Date objects, which JSON.stringify serializes in UTC.
Problem: A one-day error in membership dates would silently corrupt
Sam's and Meera's balance calculations.
Caught by: Inspecting the actual Postman response and noticing the
date was one day earlier than expected.
Fix: Added pg.types.setTypeParser(1082, val => val) to db.js.
This was caught before any balance logic was built — if missed, it
would have been extremely hard to debug later.

### Case 3 — External participant balance leak (P6)
After building the balance calculator, the sum of all net_balances
was ₹300 instead of ₹0.
Antigravity's balance queries correctly handled group members but
did not account for external participants (Kabir). The payer (Aisha)
received full credit for the expense, but Kabir's share never
appeared as anyone's debt — creating a phantom ₹300.
Caught by: Manually summing all net_balance values and finding
the result was non-zero.
Fix: Added Query E to getRawBalances() — subtracts external
participant shares from the payer's credit. Added external_receivables
to the response so users know to collect directly from external people.
Lesson: Mathematical invariants (sum = 0) must be verified explicitly.
AI does not automatically think about conservation laws.
