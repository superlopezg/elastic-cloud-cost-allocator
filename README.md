# Elastic Cost Allocator

**Allocate Elastic spend across index families and data streams** using measured storage share — for **Elastic Cloud or on-premises**, with **configurable storage tiers** (hot / warm / cold / frozen, or hot-only), optional platform/admin surcharge, and annual commit or budget coverage.

> Spreadsheet **and** web UI for SRE, FinOps, and observability teams who need a transparent, auditable way to charge back Elastic cost to workloads.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Excel](https://img.shields.io/badge/format-Excel%20.xlsx-green.svg)
![HTML](https://img.shields.io/badge/web-HTML%20UI-teal.svg)
![Status](https://img.shields.io/badge/sample%20data-fictional-orange.svg)

### Try the web UI

Open [`web/index.html`](./web/index.html) in a browser (or serve the `web/` folder). Styled like [dotandkey.es](https://dotandkey.es) with logo + link to the site.

```bash
cd web && python -m http.server 8765
# → http://localhost:8765
```

---

## Why this exists

Elastic invoices (Cloud ECU or on-prem license / ops cost) are easy to read at the **cluster** level and hard to explain at the **workload** level:

- Which application / data stream drives most of the bill?
- Do you run **hot-only**, or **hot + warm + cold**, or **+ frozen** searchable snapshots?
- How do you share platform cost (Kibana, Integrations Server, tiebreaker) fairly on Cloud — or leave them at zero on-prem?
- How do you cover an annual commit / budget when measured usage alone does not reach it?

This template turns **measured GB per enabled tier** into a **cost share per index family**, so you can charge back, prioritize retention changes, or justify sizing.

It does **not** call Elastic APIs and does **not** change your cluster. You paste (or export) measurements; formulas do the rest.

---

## What’s in the box

| Sheet / UI | Purpose |
|---|---|
| **Tiers** | Enable only the storage tiers you use (hot-only, +warm/cold, +frozen, custom). |
| **Environments** | Configurable clusters/envs (any codes). Per-env rates per tier + “Apply surcharge” flag. |
| **Global** | Deployment (`cloud` \| `onprem`), cost unit (ECU/EUR/USD…), hours, annual commit/budget, margin, snapshot alloc preference. |
| **Measurement** | One row per index family: env code + GB per tier (+ optional events/s & KB/doc). |
| **Without Admin Cost** | Per-family cost/month using measured share only. |
| **With Admin Cost** | Same + surcharge on environments marked for commit/budget uplift. |
| **Any Family** | Step-by-step calculation for one family (VLOOKUP rates by env). |
| **Web UI** (`web/`) | Same model: toggle Cloud/on-prem, enable tiers, add/rename envs, ES/EN, CSV import/export. |

Sample workbook ships with example codes `PRE` / `PRO` / `MON` and **hot + frozen** enabled (warm/cold off) — not required. Change topology to match your client.

---

## How the allocation works

1. **Enable tiers** that exist in your cluster(s).
2. **Define environments** (any number): code, rates per enabled tier, snapshots/month, surcharge flag.
3. **Measure** primary dataset size per family (GB per tier) tagged with an env code.
4. **Share** within that environment, per tier:  
   `GB_tier_family / GB_tier_env × rate_tier × hours`
5. **Snapshots / backup** → allocated by preferred tier (`auto` = frozen→cold→warm→hot with data, else first enabled).
6. **Surcharge (optional)** → envs with *Apply surcharge = TRUE* form the commit/budget base; dedicated envs are billed at their own rate and deducted from the annual target.

```text
family_cost/month ≈
    Σ_enabled_tiers (GB_tier_family / GB_tier_env) × rate_tier × hours
  + snap_share × snapshots/month
  + optional surcharge if the environment is marked
```

---

## Quick start

1. Open [`elastic-cloud-cost-allocator.xlsx`](./elastic-cloud-cost-allocator.xlsx) in Excel, LibreOffice Calc, or Google Sheets (upload).
2. Adjust **Tiers** (enable only what you use) and **Global** (deployment, unit, commit/budget).
3. Edit **Environments** rates; set platform columns to 0 for typical on-prem if unused.
4. Replace **Measurement** sample families with your inventory and GB per tier.
5. Read **Without Admin Cost** / **With Admin Cost**, or use the web UI for the same model.

### Suggested measurement sources

- Elasticsearch `_cat/indices` / ILM / data stream stats for primary store size by tier  
- Frozen / searchable snapshots dataset size from the same inventory  
- Optional: docs in `now-15m` for events/s, primary bytes / docs for KB/doc  

Exact queries depend on your version and deployment; keep them in your own runbook and only paste **aggregates** into Measurement.

---

## Sample data notice

This repository ships with **fictional** family names and **synthetic** volumetrics and rates.

- No real customer names  
- No real index inventories  
- No real commits, invoices, or license lines  

Use the workbook as a **template**. Swap in your own numbers before any internal or customer-facing report.

---

## Repo layout

```text
elastic-cloud-cost-allocator/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── .gitignore
├── elastic-cloud-cost-allocator.xlsx   # Tiers + Environments + Global + Measurement + Allocations
├── scripts/rebuild_excel_envs.py      # regenerate Excel template
└── web/
    ├── index.html
    ├── styles.css
    ├── app.js
    ├── i18n.js
    ├── seed.js
    └── logo-color.png
```

Regenerate the Excel file after seed changes:

```bash
python scripts/rebuild_excel_envs.py
```

---

## Contributing

Improvements welcome: clearer English/Spanish labels, export scripts (ES|QL / `_cat` → CSV → Measurement), Google Sheets port, Python/Streamlit UI, ILM-aware retention what-if.

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Safety

- Do **not** commit real customer names, tenant URLs, tokens, or production index inventories.
- Prefer synthetic demos in PRs; keep real workbooks private.
- This tool is for **cost modelling / chargeback**. It does not modify Elastic Cloud or on-prem clusters.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Credits

Built as an open template for Elastic observability FinOps / chargeback workflows.  
Maintainer: [superlopezg](https://github.com/superlopezg)
