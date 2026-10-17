# MARKET_VALIDATION_V1_V6 — 3D Studio AI

> **Document status:** research report (Phase 1). No customers were interviewed, no
> surveys were run and no paid services were called for this document. Every
> external claim is cited with a source URL and an access date. Where a fact could
> not be verified it is marked **UNKNOWN** or listed as an evidence gap rather than
> estimated.
>
> **Repository state at time of writing:** branch `integration/w1-w12`,
> HEAD `4f909eecec65344f7db0bf873f8822d543637416`.
> **Research date:** 2026-10-17 (all URLs accessed on this date).
>
> Related documents: `MASTER_PRODUCT_SPEC.md`, `SYSTEM_ARCHITECTURE.md`,
> `IMPLEMENTATION_ROADMAP.md`, `AUTOMATED_QA_STRATEGY.md`,
> `PRODUCTION_READINESS.md`, `RISK_REGISTER.md`.

---

## 1. Executive summary

**What was done.** A desk-research validation of the proposed AI-assisted 3D
furniture/interior platform: target segments (V1), problem hypotheses (V2),
competitor and pricing scan (V3), monetisation options (V4), MVP scope (V5) and
validation experiments with decision gates (V6).

**What we found.**

1. **The category is crowded and already cheap at the low end.** Browser-based
   interior tools are priced at $0–$25/month entry points
   ([SketchUp Go $10.75/mo](https://www.sketchup.com/plans-and-pricing),
   [Planner 5D Premium $19.99/mo](https://planner5d.com/pricing),
   [Spline Hobby $12/mo](https://spline.design/pricing)). A new entrant cannot win
   on "browser 3D" or "AI render" alone.
2. **AI 3D generation is a commodity input, not a differentiator.** Vendors sell
   image→3D at roughly **$0.16–$0.30 per model** at subscription rates
   ([Tripo Pro: "$0.16 Per Model"](https://www.tripo3d.ai/pricing),
   [Tripo API: Image to 3D = 20–30 credits at $0.01/credit](https://developers.tripo3d.ai/en/pricing)).
   Our differentiation must live in *parametric, editable, manufacturing-ready*
   output — not in generating meshes.
3. **The Uzbekistan segment is real but unsized for this use case.** Official
   statistics report **6,094 furniture manufacturing enterprises** (Jan 2022) and
   **4.4 thousand** furniture-production enterprises in a 2026 industrial release
   ([stat.uz](https://stat.uz/uz/matbuot-markazi/qo-mita-yangiliklar/18145-o-zbekiston-respublikasida-mebel-ishlab-chiqarish-sanoati-3),
   [stat.uz industrial press release 2026](https://stat.uz/img/press-relizlar/press-reliz-sanoat-05-2026-zb-lotin_p97849.pdf)).
   Digital reach is high: **89.0% internet penetration, 33.1 million users**
   ([DataReportal Digital 2026: Uzbekistan](https://datareportal.com/reports/digital-2026-uzbekistan)).
   What is **not** known: how many of those workshops would pay for software, and
   at what price.
4. **Payment rails for recurring billing exist.** Payme Business documents both
   `Merchant API` and `Subscribe API` (recurring/auto-payments) over JSON-RPC 2.0,
   supporting Uzcard and HUMO cards, and requires a legal entity
   ([Payme Business developer docs](https://developer.help.paycom.uz/protokol-subscribe-api)).
5. **The single biggest uncertainty is willingness to pay in Uzbekistan**, not
   technology. It cannot be resolved by desk research.

**Recommendation.** Do **not** go straight to W13 feature work. Run a **4-week,
low-cost validation sprint** (V6 experiments E1–E4) focused on two questions:
(a) do workshops want *editable parametric + cut-list* output rather than pretty
renders; (b) will they pay a small monthly fee or per-project credit. Proceed to
implementation only if the GO criteria in §10 are met.

**Decision:** **CONDITIONAL GO** — conditional on E1–E4 evidence. Not a validated
market yet.

---

## 2. V1 — Target customers and segmentation

> All statements in the "Evidence" column are either cited facts or explicitly
> marked hypotheses. **No interviews have been conducted.**

| Segment | Main problem (hypothesis) | Current workflow (hypothesis) | Purchasing authority | Likely willingness to pay | Evidence status |
|---|---|---|---|---|---|
| **Furniture makers / small workshops** | Quoting and re-drawing each order; cut lists done manually | SketchUp/AutoCAD or paper + Excel; sometimes a hired designer | Owner (single decision-maker) | Medium; price-sensitive; pays per project or small monthly | **Unvalidated.** Segment size supported by stat.uz (6,094 enterprises, Jan 2022); willingness to pay unknown |
| **Interior designers / architects** | Client revisions; slow visualisation turnaround | SketchUp + render plugin, or Planner 5D/Foyr Neo | Designer (self-employed) or studio lead | Medium–high; already paying $20–$160/mo for tools | **Partially evidenced** by competitor price points; local adoption unknown |
| **Independent 3D artists / freelancers** | Repetitive modelling; low margins | 3ds Max/Blender + manual modelling | Self | Low–medium; very price-sensitive, high substitution to free tools | **Unvalidated.** Blender is free and commercially usable ([blender.org](https://www.blender.org/about/license)), a strong substitute |
| **Furniture retailers / e-commerce** | Product visuals and configurators; returns due to size mismatch | Photographer + studio renders; static photos | Marketing/head of e-commerce | High per seat, but long sales cycle | **Unvalidated.** No local evidence collected |
| **Students / education** | Learning CAD is slow; expensive licences | Free student licences (Autodesk Education), Blender | Institution / student | Very low direct; useful as funnel, not revenue | **Evidenced as low monetisation:** Autodesk gives students free one-year access ([autodesk.com](https://www.autodesk.com/products/3ds-max/overview)) |

### 2.1 Why the workshop segment should be the beachhead

- It is the only segment where the proposed product's *unique* capability —
  turning a prompt into **parametric, dimension-accurate, cut-list-ready** geometry
  — maps directly to money (fewer hours per order, fewer quoting errors).
- Decision-making is concentrated in one person (owner), so a pilot is fast.
- Official enterprise counts give a bounded, local addressable set to sample from
  (6,094 in Jan 2022; 4.4 thousand in the 2026 industrial release).

**Risk:** these counts include micro-workshops that may not buy software at all.
The count is *not* a revenue estimate and must not be used as one.

### 2.2 Segmentation gaps

- No data on **software spend per workshop** in Uzbekistan — **UNKNOWN**.
- No data on **language preference for professional tools** (Uzbek vs Russian) —
  **UNKNOWN**; this affects UI and prompt design.
- No data on **device mix** (desktop vs phone) among workshops — **UNKNOWN**.

---

## 3. V2 — Problem validation

### 3.1 Problem hypotheses ranked by expected cost

| Rank | Problem | Why it could be expensive | Evidence status |
|---|---|---|---|
| 1 | Re-modelling each custom order from scratch | Designer hours per order; delays quoting | **Hypothesis** — needs E1 interviews |
| 2 | Producing accurate **cut lists / BOM** | Errors cause material waste and rework | **Hypothesis** — needs E1/E4 |
| 3 | Client revision loops | Repeated renders, meeting time | **Hypothesis** — needs E1 |
| 4 | Visualising a piece inside the customer's room | Sales conversion, returns | **Hypothesis** — needs E1 |
| 5 | Learning complex CAD tools | Onboarding cost, dependence on one skilled person | **Hypothesis** — needs E1 |
| 6 | File interoperability (GLB/OBJ/STL/DXF) with downstream tools | Manual conversion work | **Hypothesis** — needs E1 |

### 3.2 What is actually verified

Only the *existence and scale of the industry* is verified:

- **6,094** furniture manufacturing enterprises operating in Uzbekistan in
  January 2022 — [stat.uz](https://stat.uz/uz/matbuot-markazi/qo-mita-yangiliklar/18145-o-zbekiston-respublikasida-mebel-ishlab-chiqarish-sanoati-3).
- **4.4 thousand** furniture-production enterprises (6.9% share of manufacturing
  enterprises) in the 2026 industrial press release —
  [stat.uz PDF](https://stat.uz/img/press-relizlar/press-reliz-sanoat-05-2026-zb-lotin_p97849.pdf).

### 3.3 What is explicitly NOT verified

- That workshops lose money on modelling or cut lists.
- That they would change their current workflow.
- That they would pay for a browser tool.
- Any statement of the form "X% of workshops struggle with Y".

**No interviews, surveys, or customer quotes are included in this report**, because
none were conducted. Any such statement would be fabricated.

---

## 4. V3 — Competitor analysis

### 4.1 Competitor comparison table

Prices are the **published official prices** on the vendor's own site on
**2026-10-17**. Where a page did not render a price, it is marked **UNKNOWN**.

| Product | Category | Target user | Entry paid price (official) | Top individual price | AI generation | Parametric / editable output | Manufacturing output | Export | Notes / limitations |
|---|---|---|---|---|---|---|---|---|---|
| **SketchUp** (Trimble) | Desktop + web 3D modeller | Pros, architects, hobbyists | Go **$10.75/mo** per user, billed annually | Studio **$71.58/mo** (annual) | Limited (AI features via ecosystem) | Yes — manual modelling, 1000+ extensions | Via extensions/LayOut | IFC, DWG, plus common 3D | Mature, extension-dependent; no prompt-to-model ([source](https://www.sketchup.com/plans-and-pricing)) |
| **Planner 5D** | Browser/mobile interior planner | Homeowners, designers | Premium **$19.99/mo** or **$59.99/yr** | Professional **$49.99/mo** or **$399.99/yr** | Yes — AI Designer, floor-plan recognition | Limited — catalogue objects, not manufacturing-parametric | No cut list; "Export to CAD" on Professional | 3D/OBJ/FBX/BLEND upload; CAD export on Pro | Consumer-first; catalogue-based ([source](https://planner5d.com/pricing)) |
| **Foyr Neo** | Browser interior design | Interior designers | Basic **$39/mo** (yearly **$33/mo**) | Premium **$159/mo** (yearly **$103/mo**) | AI search, renders | Limited — design objects | No manufacturing BOM | Floor plans, elevations, renders | 14-day trial; render-credit model ([source](https://foyr.com/pricing)) |
| **Spline** | Browser 3D design | Designers, web 3D | Hobby **$12/mo** billed yearly ($15 monthly) | Max **$60/mo** yearly ($70 monthly) | Yes — AI 3D generation, AI textures | Partial — scene objects, code export | No | Web, Apple/Android app export, code export | Product/web-3D oriented, not furniture manufacturing ([source](https://spline.design/pricing)) |
| **Floorplanner** | Browser floor plans | Homeowners, agents, retail | Credit packs from **$8.15 / 5 credits** | 100 credits **$163.00** | No AI 3D generation advertised | No | No | 3D exports SD/HD/4K/8K per project upgrade | One-time per-project credit model ([source](https://floorplanner.com/credits)) |
| **Meshy** | AI 3D generation | Creators, studios, devs | Free **$0** (100 credits) | Ultra **$100/mo**; Studio **$70/seat/mo** | Yes — text/image→3D | **No** — mesh output | No | Mesh formats — **not verified in this research** | Output is mesh, not parametric; "Starter $10/mo" exists in some developing countries ([pricing](https://www.meshy.ai/pricing), [help](https://help.meshy.ai/en/articles/12927561-what-is-the-starter-plan-available-in-some-developing-countries)) |
| **Tripo** | AI 3D generation | Creators, studios | Free **$0** (200 credits) | Team **$55/seat/mo** billed yearly | Yes — text/image→3D, 8K textures | **No** — mesh/asset output | No | Mesh formats — **not verified in this research** | API: 1 credit = $0.01; image→3D 20–30 credits ≈ $0.20–$0.30 ([pricing](https://www.tripo3d.ai/pricing), [API pricing](https://developers.tripo3d.ai/en/pricing)) |
| **Blender** | Desktop 3D suite | Artists, studios | **$0** (GPL) | $0 | Via add-ons | Manual modelling; Python scripting | Via add-ons | Many (GLB/FBX/OBJ/STL/DXF via add-ons) | Free, commercial use allowed ([license](https://www.blender.org/about/license)) — the price anchor for indie users |
| **Autodesk 3ds Max** | Desktop 3D/DCC | Professional artists, viz studios | **$2,010/year** (official store, promotional) | — | Some AI features | Yes (manual), scripting | No BOM/cut list | Many | High price; 30-day trial; free for students ([store](https://www.autodesk.com/products), [product page](https://www.autodesk.com/products/3ds-max/overview)) |
| **Autodesk AutoCAD** | 2D/3D drafting | Engineers, drafters | **UNKNOWN** — price not captured on the official store page during this research | — | No | Drafting | Yes (drawings) | DWG/DXF/PDF (per product documentation) | Industry standard for drawings; official store shows "SPECIAL OFFER" pricing that is region- and session-dependent ([store](https://www.autodesk.com/products)) |

### 4.2 Competitive positioning map (qualitative)

```
                    Manufacturing-ready output (cut list / BOM / DXF)
                                      ▲
                                      │
              (empty space)           │        Autodesk 3ds Max / AutoCAD
         prompt → parametric →        │        (manual, expensive)
         manufacturing                │
                                      │
  ────────────────────────────────────┼──────────────────────────────────▶
   Cheap / self-serve                 │                 Expensive / pro
                                      │
        Blender (free, manual)        │     SketchUp Pro ($33/mo)
        Planner 5D ($20/mo)           │     Foyr Neo ($39–159/mo)
        Spline ($12/mo)               │
        Meshy / Tripo (mesh only)     │
                                      ▼
                        Mesh / visual output only
```

**The gap we are aiming at:** prompt-driven output that is **parametric and
manufacturing-ready** at a self-serve price. No surveyed competitor occupies that
cell: AI generators (Meshy, Tripo) produce meshes; CAD tools (AutoCAD, 3ds Max)
produce manufacturable geometry but require manual modelling and cost $560–$2,010/yr.

**Caveat:** "no competitor occupies the cell" is a **desk-research conclusion**, not
a validated market opportunity. A competitor could be under-served by our search or
could enter quickly.

### 4.3 What competitors prove about demand

- People **do pay** for browser-based interior tools ($20–$160/mo range is
  actively sold by Planner 5D and Foyr Neo).
- People **do pay** for AI 3D generation (Meshy/Tripo credit packs, with a $10
  developing-country tier at Meshy).
- People **do not** currently pay specifically for prompt→parametric→cut-list —
  because no mainstream product sells it. **Absence of a product is not proof of
  demand.** This is the central hypothesis to test.

### 4.4 Uzbekistan-specific competitor picture

- Local competitors were **not** identified in this desk research. That is an
  evidence gap, not a claim that none exist. Local CAD/3D resellers and studios
  must be mapped in E1.
- Pricing in USD is a barrier: local wages are typically lower, so a $20/mo tool
  may be a larger share of income than for a US user. **No verified local
  price-sensitivity data was found.**

---

## 5. V4 — Willingness to pay and monetisation

> **No revenue forecast or conversion rate is produced here.** Any number of that
> kind would be invented.

### 5.1 Options assessed

| Option | How it works | Strengths | Weaknesses | What evidence would support it | What evidence would reject it |
|---|---|---|---|---|---|
| **1. Free tier + paid credits** | Free limited usage; buy credits for AI/render/cut-list | Caps expensive AI/render cost; low entry barrier; matches how Tripo/Meshy/Floorplanner already sell | Users dislike unpredictability; credit accounting complexity | Interviewees prefer "pay when I need it"; usage is bursty per order | Interviewees say they want predictable monthly cost; low credit purchase rates in pilot |
| **2. Monthly subscription** | Free / Pro / Studio tiers | Predictable revenue; standard in the category (SketchUp, Planner 5D, Foyr) | AI/render cost can exceed revenue on heavy users; churn after project ends | Willingness to commit monthly during pilot; usage spread across the month | "I only need it 2 months a year"; heavy usage concentration |
| **3. Pay-per-export / pay-per-render** | Charge per GLB/STL/DXF export or per render | Aligns cost with value; easy to understand | Discourages the exact behaviour we want (exports); hard to police | Interviewees describe exports as the "deliverable" they sell to clients | Interviewees see exports as trivial and expect them free |
| **4. Business / workshop plans** | Multi-seat, brand templates, priority | Higher ARPU; matches workshop with 3–10 staff | Longer sales cycle; requires invoicing and support | Workshops ask for multiple seats and invoicing | Workshops are single-person and never ask for seats |

### 5.2 Recommended model to test (not final)

**Free tier + monthly credit allowance, with an optional credit top-up.** Concretely:

- Free: limited projects, a small monthly AI/render allowance, watermark-free GLB
  export (export is the "aha" moment and should not be blocked at the very start).
- Paid (single tier for the pilot): monthly price, larger allowance, cut list/BOM,
  higher-resolution render.
- Top-up credits for heavy AI/render months.

**Why this one first:** it bounds the two variable costs (LLM tokens, render GPU)
that `RISK_REGISTER.md` R-16 flags as the highest risk, while matching an existing
market norm that customers already understand. It is also implementable on top of
the existing `plans` / `usage_counters` / `usage_records` model.

**Price point is deliberately left open.** Setting a number now would be a guess.
E3 (pricing concept test) is designed to produce the number.

### 5.3 Local payment considerations (verified)

- Payme Business supports both one-off and **recurring** payments
  (`Subscribe API`: "принимать регулярные платежи и автоплатежи") over Uzcard and
  HUMO cards — [Payme Business docs](https://developer.help.paycom.uz/protokol-subscribe-api).
- Onboarding requires a **legal entity** (ИП, ЧП, ООО, АО, ГУП, СП, НОУ) —
  [Payme Business](https://developer.help.paycom.uz/protokol-merchant-api/avtorizatsiya).
  This is a business-setup prerequisite, not just a technical one.
- Alternative rails (Click, Uzum) were not verified in this research and must be
  checked before choosing a provider.

---

## 6. V5 — MVP prioritisation

### 6.1 Scoring

Scale 1–5: **Value** (customer value), **Complexity** (higher = harder),
**Dependency** (external service reliance), **Cost risk** (higher = riskier).
Priority = Value high, others low.

| Feature | Value | Complexity | Dependency | Cost risk | Verdict |
|---|---|---|---|---|---|
| Prompt → **editable parametric furniture** (8 types) | **5** | 3 | Low (LLM optional; local fallback exists) | Low | **MUST** |
| Geometry/dimension validation | 5 | 2 | None | None | **MUST** (already built) |
| GLB / OBJ / STL / JSON export | 4 | 2 | None | None | **MUST** (already built) |
| Materials & lighting presets | 3 | 2 | None | None | **SHOULD** (already built) |
| Rendering (browser PNG) | 3 | 2 | None | Low | **SHOULD** (already built) |
| Project saving + versioning | 4 | 2 | None | None | **MUST** (already built) |
| **Cut list / BOM export (CSV/SVG)** | **5** | 3 | None | None | **MUST for the chosen wedge** |
| Editing existing design via natural language | 3 | 4 | LLM | Medium | LATER (W15) |
| Interior / multi-room design | 2 | 4 | None | None | LATER |
| Server-side 4K render | 2 | 4 | GPU | **High** | LATER (W17) |
| Image → 3D (real provider) | 3 | 3 | Vendor | **High** | LATER (W18) |
| Real billing provider | 3 | 3 | Vendor + legal | Medium | BEFORE PAID PILOT |
| Collaboration / multi-user | 1 | 5 | None | None | OUT OF SCOPE |
| DXF/CNC output | 3 | 3 | None | None | LATER (W20) |

### 6.2 Recommended smallest commercially testable MVP

**"Prompt → editable parametric furniture → cut list → export."**

Scope:
1. 8 furniture types generated from a text prompt (the W13 gap: today the AI path
   supports only `table` — see `services/ai/spec.py:54`).
2. Parameter panel for editing every dimension after generation.
3. Validation that rejects impossible geometry.
4. Export: GLB + cut list (CSV) + technical drawing (SVG) — the three artifacts a
   workshop actually hands to production or a client.
5. Project save/load (already built).
6. One paid tier, monthly, with a bounded AI allowance.

**Deliberately excluded from the first test:** interior multi-room, server 4K
render, image→3D, collaboration, DXF/CNC, natural-language *editing* of an
existing design.

**Why this is the smallest testable unit:** it can be sold to a workshop as
"describe the cabinet, get the cut list". That is a business outcome, not a
feature demo. It uses only capabilities that mostly exist today plus the W13 fix,
so time-to-pilot is short.

### 6.3 What the MVP must prove

- A workshop can produce a usable cut list from a prompt in under ~15 minutes.
- The output is accurate enough to cut material (measured against a manually
  produced list on the same piece).
- The workshop will pay *something* recurring to keep using it.

If (3) fails, the product is a tool, not a business.

---

## 7. V6 — Validation experiments and decision gates

> All sample sizes and thresholds below are **recommendations**, not established
> facts. They are sized for a small team and a 4-week window.

### E1 — Customer interviews (workshops first)

| Element | Definition |
|---|---|
| **Hypothesis** | Small furniture workshops lose measurable time on re-modelling and cut-list preparation, and would pay to reduce it. |
| **Participants** | 10–12 owners/managers of furniture workshops (recommended), Tashkent + one regional city; mixed size (3–20 staff). Recruited via local industry contacts, Telegram business groups, and furniture bazaars. |
| **Method** | 30–40 min semi-structured interview, in Uzbek or Russian; no product pitch in the first half; ask them to walk through the last real order end-to-end. |
| **Evidence to collect** | Actual hours per order; which tools are used; who prepares cut lists; current software spend; what they do when the client changes a dimension; whether they would trial a browser tool. |
| **Success criteria (recommended)** | ≥6 of 10 describe re-modelling/cut-list work as a top-3 cost; ≥5 currently spend money on software or freelancers; ≥5 agree to a pilot. |
| **Failure criteria** | ≤3 describe the problem as material; or the workflow is already fully automated by an existing tool. |
| **Next decision** | Success → run E2/E3. Failure → re-scope to designers, or stop. |

### E2 — Competitor-based landing page positioning

| Element | Definition |
|---|---|
| **Hypothesis** | The message "describe it, get an editable model **and a cut list**" converts better than "AI-generated 3D model". |
| **Participants** | Cold traffic in Uzbekistan (targeted social/Telegram ads) — recommended budget capped; plus direct outreach list of ~100 workshops. |
| **Method** | Two landing-page variants (A: AI model; B: cut-list/manufacturing outcome). Same offer, same price display, randomised traffic. |
| **Evidence to collect** | Click-through, sign-up for early access, replies to direct outreach, qualitative comments. |
| **Success criteria (recommended)** | Variant B ≥1.5× variant A on early-access sign-ups; and ≥10 qualified workshop sign-ups in 2 weeks. |
| **Failure criteria** | No variant reaches 10 qualified sign-ups; or sign-ups are all students/hobbyists, not workshops. |
| **Next decision** | Success → E3. Failure → messaging or segment is wrong; revisit V1. |

### E3 — Pricing concept test

| Element | Definition |
|---|---|
| **Hypothesis** | A monthly subscription with a credit allowance is preferred over pure pay-per-export in this segment. |
| **Participants** | 10–15 workshop owners from E1 plus E2 sign-ups. |
| **Method** | Show three concrete options (monthly subscription; credit packs; per-export), with **real relative price levels**, and ask them to choose and explain. Use a simple Van Westendorp-style question set (too cheap / cheap / expensive / too expensive) in local currency. |
| **Evidence to collect** | Chosen model, acceptable price band in UZS, objections, invoice/VAT requirements. |
| **Success criteria (recommended)** | A single price band emerges where ≥50% would buy; ≥1 model preferred by ≥60%. |
| **Failure criteria** | No band where ≥30% would buy; or all participants would only use a free tier. |
| **Next decision** | Success → set the pilot price. Failure → the segment cannot support paid software at this stage. |

### E4 — Clickable prototype / pilot with real customers

| Element | Definition |
|---|---|
| **Hypothesis** | Workshops can complete "prompt → edit → cut list → export" without hand-holding, and the output is good enough to act on. |
| **Participants** | 3–5 workshops (recommended), each bringing one real order. |
| **Method** | Moderated session with the real product (W13 complete). Observe, do not instruct. Then leave it with them for one real order. |
| **Evidence to collect** | Task completion without help; time to first usable cut list; count of corrections needed; whether they actually used the cut list; willingness to pay after use. |
| **Success criteria (recommended)** | ≥3 of 5 complete the task unaided; ≥3 say the cut list was usable or nearly usable; ≥2 ask to continue after the trial. |
| **Failure criteria** | Users cannot complete without constant help; cut lists need full manual rework; nobody asks to continue. |
| **Next decision** | Success → GO to implementation (W13→W14→W20). Failure → CONDITIONAL/NO-GO per §10. |

### E5 (optional, later) — Paid pilot

| Element | Definition |
|---|---|
| **Hypothesis** | At least a few workshops will pay real money for the MVP. |
| **Participants** | 3–5 of the E4 workshops. |
| **Method** | Real invoice through a local payment rail (Payme/Click after legal setup). |
| **Success criteria (recommended)** | ≥3 paying customers for one billing cycle. |
| **Failure criteria** | 0 paid conversions. |

---

## 8. Evidence and source register

All accessed **2026-10-17**.

| ID | Claim | Source (official unless noted) | URL |
|---|---|---|---|
| S1 | SketchUp Go $10.75/mo, Pro $33.25/mo, Studio $71.58/mo, per user billed annually | Trimble / SketchUp official pricing | https://www.sketchup.com/plans-and-pricing |
| S2 | Planner 5D: Free $0; Premium $19.99/mo or $59.99/yr; Professional $49.99/mo or $399.99/yr | Planner 5D official pricing | https://planner5d.com/pricing |
| S3 | Foyr Neo: Basic $39/mo ($33 yearly), Standard $89/mo ($67), Premium $159/mo ($103); 14-day trial | Foyr official pricing | https://foyr.com/pricing |
| S4 | Spline: Free $0; Hobby $12/mo yearly ($15 monthly); Pro $25/mo yearly ($30); Max $60/mo yearly ($70) | Spline official pricing | https://spline.design/pricing |
| S5 | Floorplanner credits: 5/$8.15, 10/$16.30, 30/$48.90, 100/$163.00; project upgrades 2/5/10/20 credits (SD/HD/4K/8K) | Floorplanner official credits page | https://floorplanner.com/credits |
| S6 | Meshy: Free 100 credits; Pro $20/mo (1,000 credits); Premium $40; Ultra $100; Studio $70/seat | Meshy official pricing + help centre | https://www.meshy.ai/pricing · https://help.meshy.ai/en/articles/12062933-which-meshy-plan-is-right-for-you-free-vs-pro-vs-premium-vs-ultra |
| S7 | Meshy Starter plan $10/mo, 250 credits, in some developing countries | Meshy help centre | https://help.meshy.ai/en/articles/12927561-what-is-the-starter-plan-available-in-some-developing-countries |
| S8 | Tripo: Free 200 credits; Pro $20/mo ($240/yr, ≈$0.16/model); Max $90/mo; Team $55/seat/mo yearly | Tripo official pricing | https://www.tripo3d.ai/pricing |
| S9 | Tripo API: 1 credit = $0.01; Image to 3D 20–30 credits | Tripo developer pricing | https://developers.tripo3d.ai/en/pricing |
| S10 | Blender is free software under GNU GPL, commercial use allowed | Blender Foundation | https://www.blender.org/about/license |
| S11 | Autodesk 3ds Max $2,010/year (official store, promotional) | Autodesk official store | https://www.autodesk.com/products |
| S12 | Autodesk free 1-year student/educator licences; 30-day trial | Autodesk 3ds Max product page | https://www.autodesk.com/products/3ds-max/overview |
| S13 | Payme Business Subscribe API supports recurring payments/auto-payments; Uzcard/HUMO; legal entities only | Payme Business developer docs | https://developer.help.paycom.uz/protokol-subscribe-api |
| S14 | Payme Merchant API is JSON-RPC 2.0 over HTTPS | Payme Business developer docs | https://developer.help.paycom.uz/protokol-merchant-api |
| S15 | Uzbekistan: 33.1M internet users, 89.0% penetration (end-2025); 33.9M mobile connections (91.1%) | DataReportal, Digital 2026: Uzbekistan (aggregates GSMA Intelligence / official sources) | https://datareportal.com/reports/digital-2026-uzbekistan |
| S16 | Uzbekistan: 94.2% of population used the internet, Jan–Aug 2025 | Uzstat (official statistics committee) | https://stat.uz/en/press-center/news-of-committee/64213-zbekiston-a-olisining-94-2-foizi-internetdan-fojdalanadi-4 |
| S17 | 6,094 furniture manufacturing enterprises operating (Jan 2022) | Uzstat | https://stat.uz/uz/matbuot-markazi/qo-mita-yangiliklar/18145-o-zbekiston-respublikasida-mebel-ishlab-chiqarish-sanoati-3 |
| S18 | Furniture production: 4.4 thousand enterprises, 6.9% of manufacturing (2026 industrial release) | Uzstat press release PDF | https://stat.uz/img/press-relizlar/press-reliz-sanoat-05-2026-zb-lotin_p97849.pdf |

**Not verified / deliberately omitted:** local furniture market revenue, average
software spend, number of interior designers in Uzbekistan, conversion rates,
churn, ARPU, CAC. No credible public source was found during this research, and
guessing would be misleading.

---

## 9. Facts vs assumptions vs hypotheses

### 9.1 Verified facts (cited above)

| # | Fact |
|---|---|
| F1 | Major browser 3D/interior tools sell at $10.75–$159/month depending on tier (S1–S4). |
| F2 | AI 3D generation is sold at commodity prices: Tripo ≈$0.16/model on Pro, API $0.20–$0.30 per image→3D (S8, S9). |
| F3 | Blender is free and usable commercially, anchoring indie users at $0 (S10). |
| F4 | Professional CAD/DCC tools cost $560–$2,010/year (S11). |
| F5 | Uzbekistan has 89–94% internet penetration and ~33M users (S15, S16). |
| F6 | Uzbekistan has ~4.4–6.1 thousand furniture-production enterprises (different years/methods) (S17, S18). |
| F7 | Payme supports recurring payments and requires a legal entity (S13, S14). |

### 9.2 Assumptions (believed but unverified)

| # | Assumption | Risk if wrong |
|---|---|---|
| A1 | Workshops produce cut lists manually today | The core wedge disappears |
| A2 | Uzbek/Russian-language prompting is a meaningful advantage over English-only tools | The local-language differentiator is weaker than assumed |
| A3 | A browser tool is acceptable to workshops (vs desktop) | Adoption barrier |
| A4 | Workshops will pay in UZS via card/online rails | Monetisation blocked or shifted to invoicing |
| A5 | Cut-list accuracy achievable from parametric geometry without CAD-grade tolerances | Product fails the "usable in production" bar |

### 9.3 Hypotheses to test (V6)

| # | Hypothesis | Experiment |
|---|---|---|
| H1 | Re-modelling + cut lists are a top-3 cost for workshops | E1 |
| H2 | "Manufacturing outcome" messaging beats "AI model" messaging | E2 |
| H3 | Monthly subscription + credits is preferred over per-export | E3 |
| H4 | Workshops can complete prompt→cut list unaided | E4 |
| H5 | At least some workshops will pay real money | E5 |

---

## 10. GO / CONDITIONAL GO / NO-GO criteria

### GO — proceed to implementation (W13 → W14 → W20)

All of the following must hold:

1. **E1:** ≥6/10 workshops describe re-modelling/cut-list work as a top-3 cost.
2. **E2:** ≥10 qualified workshop sign-ups; manufacturing-outcome messaging wins.
3. **E3:** a price band exists where ≥50% would buy, and one model preferred by ≥60%.
4. **E4:** ≥3/5 workshops complete prompt→cut list unaided and call the output usable.
5. At least **2 workshops explicitly ask to continue** after the trial.

### CONDITIONAL GO — proceed with a narrower scope

Any of the following:

- E1 and E4 succeed, but E3 shows price sensitivity below a viable level
  → narrow to a **per-project credit** model and re-test.
- E1 succeeds but E2 fails → the segment is right, the message is wrong;
  re-run E2 with new positioning before building.
- E4 succeeds but E2 is weak (few sign-ups) → run a paid pilot with the E4
  workshops directly (E5) and skip broad acquisition.

Action under CONDITIONAL GO: build only the W13 gap fix (8 types in the AI path)
+ cut-list export, and continue validating in parallel. Do **not** start W17/W18.

### NO-GO — stop or re-scope

Any of the following:

- E1 failure: workshops do not recognise the problem as material.
- E4 failure: users cannot complete the flow without constant help, or cut lists
  need full manual rework.
- E3 failure: no price band at which a meaningful share would pay, and no
  alternative segment shows better willingness to pay.
- E5 failure: zero paid conversions after a real invoice.

Action: do not proceed to W13+ investment. Archive findings in this document and
re-evaluate either a different segment (designers/retail) or a different wedge.

---

## 11. Risks and unresolved business decisions

### 11.1 Business risks (cross-reference `RISK_REGISTER.md`)

| Risk | Note |
|---|---|
| R-13 Market demand absent | This report does **not** close this risk; only E1–E4 can |
| R-16 Free users consume AI cost | Monetisation recommendation (§5.2) is designed around this |
| R-17 Payment provider rejection | Payme requires a legal entity (S13); legal setup is a prerequisite |
| R-27 Provider licence restricts commercial use | Must be checked per provider before launch |
| Price anchoring vs free Blender | Blender at $0 sets a hard ceiling for "just modelling" tools (S10) |

### 11.2 Unresolved business decisions

1. **Price point** — not set. Must come from E3.
2. **Legal entity** — required for Payme Business onboarding; not yet confirmed.
3. **Language strategy** — Uzbek-first, Russian-first, or bilingual? Affects UI and
   prompt engineering. **Unvalidated.**
4. **Segment focus** — workshops vs designers vs retail. Recommended: workshops,
   but E1 may contradict this.
5. **Whether exports are free or metered** — affects the value proposition.
6. **Whether to support offline use** — internet is at 89–94% penetration (S15,
   S16), but reliability in workshops is unknown.

---

## 12. Decision summary for the product owner

| Question | Answer |
|---|---|
| Has market demand been validated? | **No.** Only desk research was done. No customer evidence exists yet. |
| Is the category real and monetised? | **Yes** — competitors sell at $10.75–$159/month and AI generation at ~$0.16–$0.30/model. |
| What is our differentiator? | **Prompt → editable parametric → cut list / manufacturing output.** Not AI generation itself, which is commoditised. |
| What is the smallest testable MVP? | 8 furniture types from a prompt + parameter editing + validation + GLB/cut-list/SVG export + one paid tier. |
| What monetisation should we test? | Free tier + monthly credit allowance + optional top-ups. Price set by E3, not guessed. |
| What is the biggest unknown? | **Willingness to pay in Uzbekistan.** |
| What must happen before W13 implementation? | E1–E4 completed, with the GO criteria in §10 met. |
| Current decision | **CONDITIONAL GO** — conditional on E1–E4 evidence. |

**Recommended immediate next step:** run **E1 (10–12 workshop interviews)**. It is
the cheapest experiment, it can invalidate the whole thesis fastest, and it does not
require any code.
