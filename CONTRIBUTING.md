# Contributing

Thanks for helping improve **Elastic Cloud Cost Allocator**.

## Ways to contribute

- Clearer sheet labels / bilingual EN–ES tips
- Scripts that export Elasticsearch stats into the **Measurement** sheet (CSV)
- Ports: Google Sheets, LibreOffice-only tips, Python/Streamlit UI
- Multi-cluster and multi-project chargeback
- ILM / retention what-if scenarios
- Unit tests for the allocation formulas (e.g. openpyxl + pytest)

## Rules for PRs

1. **No real customer data** — use fictional family names and synthetic GB/ECU figures.
2. Prefer small, focused PRs with a short description of the “why”.
3. Update the README when behaviour or sheet names change.
4. Keep secrets, tokens, tenant URLs and production inventories out of the repo.

## Local check before opening a PR

- Open the `.xlsx` and confirm yellow (editable) cells still work.
- Spot-check that **Any Family** and a sample workload sheet still resolve after your change.
- Search the workbook for client names and real index patterns before committing.

## Commit style

Conventional commits preferred: `feat:`, `fix:`, `docs:`, `chore:`.
