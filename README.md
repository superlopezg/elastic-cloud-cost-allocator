# Elastic Cloud Cost Allocator

**Allocate Elastic Cloud (ECU) spend across index families and data streams** using measured hot/frozen storage share — with optional platform/admin surcharge and annual commit coverage.

> Spreadsheet **and** web UI for SRE, FinOps, and observability teams who need a transparent, auditable way to charge back Elastic Cloud cost to workloads.

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

Elastic Cloud invoices are easy to read at the **cluster** level (hot nodes, frozen tier, Kibana, snapshots, monitoring…) and hard to explain at the **workload** level:

- Which application / data stream drives most of the bill?
- How do you share platform cost (Kibana, Integrations Server, tiebreaker) fairly?
- How do you cover an annual ECU commit when measured usage alone does not reach it?
- How do you show the same result **with** and **without** an admin/ops surcharge?

This workbook turns **measured GB on hot and frozen** into a **cost share per index family**, so you can charge back, prioritize retention changes, or justify sizing.

It does **not** call Elastic Cloud APIs and does **not** change your cluster. You paste (or export) measurements; formulas do the rest.

---

## What’s in the box

| Sheet / UI | Purpose |
|---|---|
| **Environments** | **Configurable** list of clusters/envs (any codes: DEV, INT, UAT, PROD, MONITORING, …). Per-env rates + “Apply surcharge” flag. |
| **Global** | Hours/month, annual ECU commit, margin, other annual ECU. Computes commit uplift. |
| **Measurement** | One row per index family: **env code** (must match Environments), GB hot/frozen, optional events/s & KB/doc. |
| **Without Admin Cost** | Per-family ECU/month using measured share only. |
| **With Admin Cost** | Same + surcharge on environments marked for commit uplift. |
| **Any Family** | Step-by-step calculation for one family (VLOOKUP rates by env). |
| **Web UI** (`web/`) | Same model: add/rename/remove environments, ES/EN, CSV import/export. |

Sample workbook ships with example codes `PRE` / `PRO` / `MON` — they are **not required**. Rename or replace them for your client topology.


---

## How the allocation works

1. **Define environments** (any number): code, ECU/h rates, snapshots/month, and whether commit **surcharge** applies.
2. **Measure** primary dataset size per family (GB hot, GB frozen) tagged with an env code.
3. **Share** within that environment:  
   - Hot → proportional to **GB hot** in the same env  
   - Frozen + snapshots → proportional to **GB frozen** (falls back to hot share if frozen is zero)
4. **Rate** → env rates × hours/month from Global / Parameters.
5. **Surcharge (optional)** → environments with *Apply surcharge = TRUE* form the commit base; dedicated envs (e.g. monitoring) are billed at their own rate and deducted from the annual target when computing uplift.

```text
family_ECU/month ≈
    (GB_hot_family / GB_hot_env) × ECU/h_hot × hours
  + (GB_frozen_family / GB_frozen_env) × (ECU/h_frozen × hours + snapshots/month)
  + optional surcharge if the environment is marked
```

---

## Quick start

1. Open [`elastic-cloud-cost-allocator.xlsx`](./elastic-cloud-cost-allocator.xlsx) in Excel, LibreOffice Calc, or Google Sheets (upload).
2. Go to **Parameters** and replace the sample ECU/h rates, snapshot costs and annual commit with **your** contract / console figures.
3. Go to **Measurement** and replace every sample family with **your** index patterns and measured GB (and optional events/s, KB/doc).
4. Read **Without Admin Cost** / **With Admin Cost** for the full ledger, or use **Any Family** / the sample workload sheets for a single chargeback story.
5. Duplicate a workload sheet (like Sample Cloud Apps) for each real business owner: put their exact Measurement family names in the yellow cells.

### Suggested measurement sources

- Elasticsearch `_cat/indices` / ILM / data stream stats for primary store size  
- Frozen / searchable snapshots dataset size from the same inventory  
- Optional: docs in `now-15m` for events/s, primary bytes / docs for KB/doc  

Exact queries depend on your version and deployment; keep them in your own runbook and only paste **aggregates** into Measurement.

---

## Sample data notice

This repository ships with **fictional** family names and **synthetic** volumetrics and rates.

- No real customer names  
- No real index inventories  
- No real ECU commits or invoice lines  

Use the workbook as a **template**. Swap in your own numbers before any internal or customer-facing report.

---

## Repo layout

```text
elastic-cloud-cost-allocator/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── .gitignore
├── elastic-cloud-cost-allocator.xlsx   # Environments + Global + Measurement + Allocations
├── scripts/rebuild_excel_envs.py      # regenerate Excel template
└── web/
    ├── index.html
    ├── styles.css
    ├── app.js
    ├── i18n.js
    ├── seed.js
    └── logo-color.png
```

---

## Contributing

Improvements welcome: clearer English/Spanish labels, export scripts (ES|QL / `_cat` → CSV → Measurement), Google Sheets port, Python/Streamlit UI, multi-cluster support, ILM-aware retention what-if.

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Safety

- Do **not** commit real customer names, tenant URLs, tokens, or production index inventories.
- Prefer synthetic demos in PRs; keep real workbooks private.
- This tool is for **cost modelling / chargeback**. It does not modify Elastic Cloud.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Credits

Built as an open template for Elastic observability FinOps / chargeback workflows.  
Maintainer: [superlopezg](https://github.com/superlopezg)
