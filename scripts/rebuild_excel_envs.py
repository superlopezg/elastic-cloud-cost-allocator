# -*- coding: utf-8 -*-
"""Rebuild Excel workbook with configurable Environments sheet (any N clusters)."""
from pathlib import Path
import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import FormulaRule
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(r"C:\Users\DK\Mygithub\elastic-cloud-cost-allocator")
OUT = ROOT / "elastic-cloud-cost-allocator.xlsx"
SEED = json.loads((ROOT / "docs" / "seed-measurement.json").read_text(encoding="utf-8"))

YELLOW = PatternFill("solid", fgColor="FFF2CC")
HEADER = PatternFill("solid", fgColor="E8F0EF")
TITLE = Font(bold=True, size=14, color="1F6B66")
BOLD = Font(bold=True)
THIN = Border(
    left=Side(style="thin", color="D9E2DF"),
    right=Side(style="thin", color="D9E2DF"),
    top=Side(style="thin", color="D9E2DF"),
    bottom=Side(style="thin", color="D9E2DF"),
)

ENVS = [
    # code, label, applySurcharge, hot, frozen, kibana, integrations, tiebreaker, snapshots
    ("PRE", "Pre-production (sample)", True, 3.5, 0.35, 0.28, 0.14, 0, 200),
    ("PRO", "Production (sample)", True, 5.0, 1.0, 0.56, 0.14, 0.07, 500),
    ("MON", "Monitoring dedicated (sample)", False, 0.5, 0, 0, 0, 0, 10),
]

wb = Workbook()

# --- Environments ---
ws = wb.active
ws.title = "Environments"
ws["A1"] = "Environments — configure as many clusters as you need (rename codes, add DEV/INT/UAT/…)."
ws["A1"].font = TITLE
ws.merge_cells("A1:I1")
ws["A2"] = "Yellow cells are editable. Measurement.env must match Code. Surcharge=TRUE → families get commit uplift; FALSE → dedicated (own rate, deducted from commit target)."
headers = ["Code", "Label", "Apply surcharge", "Hot ECU/h", "Frozen ECU/h", "Kibana ECU/h", "Integrations ECU/h", "Tiebreaker ECU/h", "Snapshots ECU/month"]
for c, h in enumerate(headers, 1):
    cell = ws.cell(4, c, h)
    cell.fill = HEADER
    cell.font = BOLD
for i, row in enumerate(ENVS, 5):
    for c, v in enumerate(row, 1):
        cell = ws.cell(i, c, v)
        cell.fill = YELLOW
        cell.border = THIN
ws.column_dimensions["A"].width = 12
ws.column_dimensions["B"].width = 32
for col in range(3, 10):
    ws.column_dimensions[get_column_letter(col)].width = 16

# --- Global ---
wg = wb.create_sheet("Global")
wg["A1"] = "Global contract parameters"
wg["A1"].font = TITLE
wg["A3"] = "Hours / month"
wg["B3"] = 730
wg["B3"].fill = YELLOW
wg["A4"] = "Annual ECU commit"
wg["B4"] = 100000
wg["B4"].fill = YELLOW
wg["A5"] = "Margin on commit"
wg["B5"] = 0.03
wg["B5"].fill = YELLOW
wg["A6"] = "Other ECU / year (egress + snapshot API)"
wg["B6"] = 500
wg["B6"].fill = YELLOW
wg["A8"] = "Hours / year"
wg["B8"] = "=B3*12"
wg["A9"] = "Annual target"
wg["B9"] = "=B4*(1+B5)"
wg["A11"] = "Surchargeable base / year (envs with Apply surcharge = TRUE)"
wg["B11"] = '=SUMPRODUCT((Environments!C5:C50=TRUE)*(Environments!D5:D50+Environments!E5:E50)*$B$8)+SUMPRODUCT((Environments!C5:C50=TRUE)*Environments!I5:I50*12)'
wg["A12"] = "Dedicated envs / year (Apply surcharge = FALSE)"
wg["B12"] = '=SUMPRODUCT((Environments!C5:C50=FALSE)*(Environments!D5:D50+Environments!E5:E50)*$B$8)+SUMPRODUCT((Environments!C5:C50=FALSE)*Environments!I5:I50*12)'
wg["A13"] = "Platform annual (Kibana+Integrations+Tiebreaker on surchargeable envs)"
wg["B13"] = '=SUMPRODUCT((Environments!C5:C50=TRUE)*(Environments!F5:F50+Environments!G5:G50+Environments!H5:H50)*$B$8)'
wg["A14"] = "Computed surcharge"
wg["B14"] = '=IF(B11=0,0,(B9-B12)/B11-1)'
wg["A15"] = "Estimated consumption"
wg["B15"] = "=B11+B12+B13+B6"
wg.column_dimensions["A"].width = 70
wg.column_dimensions["B"].width = 18

# --- Measurement ---
wm = wb.create_sheet("Measurement")
wm["A1"] = "Measurement — one row per index family. Env code must exist in Environments!A."
wm["A1"].font = TITLE
wm.merge_cells("A1:K1")
mheaders = ["Family", "Env", "What", "Events/s 15m", "KB/doc", "Docs", "GB hot", "GB frozen", "Indices", "Events/s life", "Age days"]
for c, h in enumerate(mheaders, 1):
    cell = wm.cell(2, c, h)
    cell.fill = HEADER
    cell.font = BOLD
for i, r in enumerate(SEED, 3):
    vals = [r["family"], r["env"], r.get("what", ""), r["eps15"], r["kbdoc"], r["docs"], r["gbHot"], r["gbFrozen"], r["indices"], r["epsLife"], r["ageDays"]]
    for c, v in enumerate(vals, 1):
        cell = wm.cell(i, c, v)
        if c in (1, 2, 3, 7, 8):
            cell.fill = YELLOW
last_meas = 2 + len(SEED)
# data validation for env from Environments list
dv = DataValidation(type="list", formula1="=Environments!$A$5:$A$50", allow_blank=True)
wm.add_data_validation(dv)
dv.add(f"B3:B{last_meas + 50}")
for col, w in enumerate([28, 10, 40, 12, 10, 14, 12, 12, 10, 12, 10], 1):
    wm.column_dimensions[get_column_letter(col)].width = w

# --- Allocation helper formulas ---
def build_alloc(sheet_name, with_admin):
    wa = wb.create_sheet(sheet_name)
    wa["A1"] = sheet_name + (" — surcharge applied when Environments!Apply surcharge is TRUE" if with_admin else " — no surcharge")
    wa["A1"].font = TITLE
    wa["A2"] = "Surcharge rate"
    wa["B2"] = f"=Global!B14" if with_admin else 0
    if with_admin:
        wa["B2"].fill = YELLOW
    headers = [
        "Family", "Env", "GB hot", "Share hot", "GB frozen", "Share frozen",
        "Hot ECU/h", "Frozen ECU/h", "Snapshots/mo",
        "ECU/mo capacity", "ECU/mo snapshots", "ECU/mo Elastic", "ECU/mo surcharge", "ECU/mo total", "ECU/year",
    ]
    for c, h in enumerate(headers, 1):
        cell = wa.cell(4, c, h)
        cell.fill = HEADER
        cell.font = BOLD
    # rows linked to Measurement — generate enough rows
    n = len(SEED)
    for i in range(n):
        r = 5 + i
        m = 3 + i  # Measurement row
        wa.cell(r, 1, f"=Measurement!A{m}")
        wa.cell(r, 2, f"=Measurement!B{m}")
        wa.cell(r, 3, f"=Measurement!G{m}")
        # share hot = gb / sumif env
        wa.cell(r, 4, f'=IF(SUMIF(Measurement!$B:$B,B{r},Measurement!$G:$G)=0,0,C{r}/SUMIF(Measurement!$B:$B,B{r},Measurement!$G:$G))')
        wa.cell(r, 5, f"=Measurement!H{m}")
        wa.cell(r, 6, f'=IF(SUMIF(Measurement!$B:$B,B{r},Measurement!$H:$H)=0,0,E{r}/SUMIF(Measurement!$B:$B,B{r},Measurement!$H:$H))')
        wa.cell(r, 7, f'=IFERROR(VLOOKUP(B{r},Environments!$A$5:$I$50,4,FALSE),0)')
        wa.cell(r, 8, f'=IFERROR(VLOOKUP(B{r},Environments!$A$5:$I$50,5,FALSE),0)')
        wa.cell(r, 9, f'=IFERROR(VLOOKUP(B{r},Environments!$A$5:$I$50,9,FALSE),0)')
        wa.cell(r, 10, f"=(D{r}*G{r}+F{r}*H{r})*Global!$B$3")
        wa.cell(r, 11, f"=IF(SUMIF(Measurement!$B:$B,B{r},Measurement!$H:$H)=0,D{r}*I{r},F{r}*I{r})")
        wa.cell(r, 12, f"=J{r}+K{r}")
        if with_admin:
            wa.cell(r, 13, f'=IF(IFERROR(VLOOKUP(B{r},Environments!$A$5:$I$50,3,FALSE),FALSE),L{r}*$B$2,0)')
        else:
            wa.cell(r, 13, 0)
        wa.cell(r, 14, f"=L{r}+M{r}")
        wa.cell(r, 15, f"=N{r}*12")
    for col in range(1, 16):
        wa.column_dimensions[get_column_letter(col)].width = 14
    wa.column_dimensions["A"].width = 28

build_alloc("Without Admin Cost", False)
build_alloc("With Admin Cost", True)

# --- Any Family ---
wy = wb.create_sheet("Any Family")
wy["A1"] = "Pick any Measurement family — rates come from Environments via VLOOKUP (works for any env code)."
wy["A1"].font = TITLE
wy["A3"] = "Family"
wy["B3"] = SEED[0]["family"] if SEED else ""
wy["B3"].fill = YELLOW
wy["A4"] = "Env"
wy["B4"] = '=IFERROR(INDEX(Measurement!B:B,MATCH(B3,Measurement!A:A,0)),"")'
wy["A5"] = "GB hot"
wy["B5"] = '=IFERROR(SUMIF(Measurement!A:A,B3,Measurement!G:G),0)'
wy["A6"] = "GB frozen"
wy["B6"] = '=IFERROR(SUMIF(Measurement!A:A,B3,Measurement!H:H),0)'
wy["A7"] = "Hot share"
wy["B7"] = '=IF(SUMIF(Measurement!B:B,B4,Measurement!G:G)=0,0,B5/SUMIF(Measurement!B:B,B4,Measurement!G:G))'
wy["A8"] = "Frozen share"
wy["B8"] = '=IF(SUMIF(Measurement!B:B,B4,Measurement!H:H)=0,0,B6/SUMIF(Measurement!B:B,B4,Measurement!H:H))'
wy["A9"] = "Hot ECU/h"
wy["B9"] = '=IFERROR(VLOOKUP(B4,Environments!$A$5:$I$50,4,FALSE),0)'
wy["A10"] = "Frozen ECU/h"
wy["B10"] = '=IFERROR(VLOOKUP(B4,Environments!$A$5:$I$50,5,FALSE),0)'
wy["A11"] = "Snapshots / mo"
wy["B11"] = '=IFERROR(VLOOKUP(B4,Environments!$A$5:$I$50,9,FALSE),0)'
wy["A12"] = "Apply surcharge?"
wy["B12"] = '=IFERROR(VLOOKUP(B4,Environments!$A$5:$I$50,3,FALSE),FALSE)'
wy["A13"] = "ECU/mo capacity"
wy["B13"] = "=(B7*B9+B8*B10)*Global!B3"
wy["A14"] = "ECU/mo snapshots"
wy["B14"] = "=IF(SUMIF(Measurement!B:B,B4,Measurement!H:H)=0,B7*B11,B8*B11)"
wy["A15"] = "ECU/mo Elastic"
wy["B15"] = "=B13+B14"
wy["A16"] = "ECU/mo surcharge"
wy["B16"] = "=IF(B12,B15*Global!B14,0)"
wy["A17"] = "ECU/mo total"
wy["B17"] = "=B15+B16"
wy["A18"] = "ECU/year"
wy["B18"] = "=B17*12"
wy.column_dimensions["A"].width = 22
wy.column_dimensions["B"].width = 36

# --- README sheet ---
wr = wb.create_sheet("README", 0)
wr["A1"] = "Elastic Cloud Cost Allocator — configurable environments"
wr["A1"].font = TITLE
wr["A3"] = "1. Edit Environments: add/rename codes (DEV, INT, UAT, PROD, MONITORING, …). Set Apply surcharge TRUE/FALSE."
wr["A4"] = "2. Edit Global: hours, annual commit, margin, other annual ECU."
wr["A5"] = "3. Fill Measurement with your index families. Env must match an Environments Code."
wr["A6"] = "4. Read Without / With Admin Cost and Any Family."
wr["A8"] = "Sample PRE/PRO/MON codes are examples only — not required. Replace with your topology."
wr["A9"] = "HTML twin: web/index.html (same model)."
wr["A10"] = "https://github.com/superlopezg/elastic-cloud-cost-allocator"
wr.column_dimensions["A"].width = 110

wb.save(OUT)
print("Wrote", OUT, "sheets", wb.sheetnames, "meas rows", len(SEED))
