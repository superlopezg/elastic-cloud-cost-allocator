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

| Sheet | Purpose |
|---|---|
| **Measurement** | One row per index family / data-stream pattern: env (PRE / PRO / MON), events/s, KB/doc, docs, GB hot, GB frozen, index count, age. **Replace sample rows with your metrics.** |
| **Parameters** | Editable yellow cells: hours/month, ECU/h rates (hot, frozen, Kibana…), snapshot monthly cost, annual commit, margin. Drives the surcharge math. |
| **Without Admin Cost** | Per-family ECU/month using measured share only (no admin surcharge on the allocation rows). |
| **With Admin Cost** | Same allocation **plus** the PRE/PRO surcharge that covers platform gap, egress/API, peak buffer and ops margin. |
| **Sample Cloud Apps** | Example “client / workload” view: pick several Measurement families (cloud Kubernetes app logs) and get a rolled-up chargeback. |
| **Sample OnPrem Apps** | Same pattern for on-prem Kubernetes app logs. |
| **Any Family** | Pick **one** family name from Measurement and get the full step-by-step ECU calculation. |

Yellow cells are meant to be edited. Everything else is formula-driven.

---

## How the allocation works

1. **Measure** primary dataset size per family (GB hot, GB frozen) for PRE, PRO and Monitoring.
2. **Share**  
   - Hot (+ platform components you choose to fold in) → proportional to **GB hot**  
   - Frozen + snapshots → proportional to **GB frozen** (falls back to hot share if frozen is zero)
3. **Rate** → `ECU/h × hours/month` from Parameters (sample rates are illustrative).
4. **Surcharge (optional)** → when annual commit + margin exceed the pure hot/frozen/snapshot formula for PRE+PRO, Parameters computes the uplift applied on the **With Admin Cost** sheet. Monitoring is billed on its own rows and is not double-counted into that uplift.

Events/s and KB/doc are shown for context (noise, cardinality, retention conversations). They are **not** used in the ECU share.

```text
family_ECU/month ≈
    (GB_hot_family / GB_hot_cluster)   × ECU/h_hot   × hours
  + (GB_frozen_family / GB_frozen_cluster) × (ECU/h_frozen × hours + snapshots/month)
  + optional PRE/PRO surcharge
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
├── elastic-cloud-cost-allocator.xlsx
└── web/
    ├── index.html      # interactive calculator (Dot & Key look)
    ├── styles.css
    ├── app.js
    ├── seed.js         # fictional sample Measurement rows
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
