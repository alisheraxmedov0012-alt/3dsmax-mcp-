# AI budget limits — enforcement boundary

Stage 3.5 added a client-side usage and budget layer (`src/ai/budget/`). It is
accurate for the provider that ships today — the offline rule-based parser, which
uses no tokens and costs nothing — but it is **not** an authoritative paid-budget
control. Read this before enabling a metered provider.

## What the current layer does

- Records one usage entry per AI request (create or edit), with `usageType`
  `actual`, `estimated` or `none`; the offline parser is always `none`, 0 tokens, 0 cost.
- Enforces daily/monthly token limits, a per-request token limit and daily/monthly
  cost limits **before** a metered provider is called, reserving the per-request
  allowance so two overlapping requests cannot both slip under a limit.
- Persists settings, daily/monthly aggregates and the last 500 requests in
  `localStorage`, and reports unreadable or unwritable storage instead of showing
  real zeros.

## Limits of that enforcement

1. **Not authoritative.** `BudgetGate` runs in the browser. A user can clear
   storage, call the provider path directly or use another client; nothing in the
   frontend can prevent that.
2. **Not a central budget.** `localStorage` is per browser profile. Tabs
   last-write-wins and devices do not share counters, so the same allowance can be
   spent more than once across tabs/devices.
3. **Cost can overshoot once.** The pre-flight reservation is measured in tokens,
   because a call's cost is unknown before it runs. A single metered request may
   therefore cross the daily cost limit by its own cost; the next request is
   blocked.
4. **Server-side enforcement is mandatory before a paid provider is enabled.**
5. **The server must check per-request, daily and monthly token and cost limits**
   for every request, and reject before calling the provider.
6. **Provider usage metadata and the real cost must be recorded server-side**
   (per user and per request), not only in the browser.
7. **No unverified model prices.** `MODEL_PRICES` currently contains only the
   offline parser at 0. Add a model only with a verified price and a matching
   server-side cost check; the frontend must never infer a price for unknown model.

## If a metered provider is added

- Keep the API key on the server; the browser sends only the prompt.
- Reuse the intent contract and validation; the server additionally returns usage
  metadata and enforces the budget transactionally (reserve → call → settle).
- Keep the frontend layer as a UX preview of the budget, never as the source of
  truth. A rejected server call must still be shown to the user with the limit
  that was hit.
