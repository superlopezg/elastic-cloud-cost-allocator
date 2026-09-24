(() => {
  const STORAGE_KEY = "dk-elastic-cost-allocator-v1";

  const DEFAULT_PARAMS = {
    hoursMonth: 730,
    hot: { PRE: 3.5, PRO: 5.0, MON: 0.5 },
    frozen: { PRE: 0.35, PRO: 1.0, MON: 0 },
    kibana: { PRE: 0.28, PRO: 0.56, MON: 0 },
    integrations: { PRE: 0.14, PRO: 0.14, MON: 0 },
    tiebreaker: { PRE: 0, PRO: 0.07, MON: 0 },
    snapshots: { PRE: 200, PRO: 500, MON: 10 },
    annualCommit: 100000,
    margin: 0.03,
    otherAnnual: 500,
    surchargeOverride: null,
  };

  const SAMPLE_CLOUD = [
    "pre-k8s-cloud-applogs-tst",
    "pre-k8s-cloud-applogs",
    "pre-k8s-cloud-applogs-dev",
    "pre-k8s-cloud-applogs-30d",
    "pro-k8s-cloud-applogs",
    "pro-k8s-cloud-applogs-30d",
  ];

  const SAMPLE_ONPREM = [
    "pre-k8s-onprem-applogs-tst",
    "pre-k8s-onprem-applogs-dev",
    "pre-k8s-onprem-applogs",
    "pro-k8s-onprem-applogs",
    "pro-k8s-onprem-applogs-sso",
  ];

  const state = {
    params: structuredClone(DEFAULT_PARAMS),
    rows: [],
    cloudFamilies: [...SAMPLE_CLOUD],
    onpremFamilies: [...SAMPLE_ONPREM],
    anyFamily: "pro-app-appserver",
    filterEnv: "ALL",
    search: "",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function money(n) {
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function num(n, d = 2) {
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function pct(n) {
    if (!Number.isFinite(n)) return "—";
    return (n * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
  }

  function platformRate(env, p = state.params) {
    return (p.kibana[env] || 0) + (p.integrations[env] || 0) + (p.tiebreaker[env] || 0);
  }

  function computeSurcharge(p = state.params) {
    if (p.surchargeOverride != null && p.surchargeOverride !== "") {
      return Number(p.surchargeOverride);
    }
    const hy = p.hoursMonth * 12;
    const basePRE = p.hot.PRE * hy + p.frozen.PRE * hy + p.snapshots.PRE * 12;
    const basePRO = p.hot.PRO * hy + p.frozen.PRO * hy + p.snapshots.PRO * 12;
    const base = basePRE + basePRO;
    const monAnnual = p.hot.MON * hy + p.snapshots.MON * 12;
    const objetivo = p.annualCommit * (1 + p.margin);
    if (base <= 0) return 0;
    return (objetivo - monAnnual) / base - 1;
  }

  function clusterTotals(rows = state.rows) {
    const out = {
      PRE: { hot: 0, frozen: 0 },
      PRO: { hot: 0, frozen: 0 },
      MON: { hot: 0, frozen: 0 },
    };
    for (const r of rows) {
      const e = r.env;
      if (!out[e]) continue;
      out[e].hot += Number(r.gbHot) || 0;
      out[e].frozen += Number(r.gbFrozen) || 0;
    }
    return out;
  }

  function allocateRow(row, withAdmin, totals, surcharge, p = state.params) {
    const env = row.env;
    const gbHot = Number(row.gbHot) || 0;
    const gbFrozen = Number(row.gbFrozen) || 0;
    const denHot = totals[env]?.hot || 0;
    const denFrozen = totals[env]?.frozen || 0;
    const shareHot = denHot > 0 ? gbHot / denHot : 0;
    const shareFrozen = denFrozen > 0 ? gbFrozen / denFrozen : 0;
    const ecuHHot = p.hot[env] || 0;
    const ecuHFrozen = p.frozen[env] || 0;
    const snaps = p.snapshots[env] || 0;
    const hours = p.hoursMonth;
    const ecuMesCap = (shareHot * ecuHHot + shareFrozen * ecuHFrozen) * hours;
    const snapShare = denFrozen > 0 ? shareFrozen : shareHot;
    const ecuMesSnap = snapShare * snaps;
    const ecuMesElastic = ecuMesCap + ecuMesSnap;
    const applySur = withAdmin && (env === "PRE" || env === "PRO");
    const ecuMesRecargo = applySur ? ecuMesElastic * surcharge : 0;
    const ecuMes = ecuMesElastic + ecuMesRecargo;
    return {
      ...row,
      shareHot,
      shareFrozen,
      ecuHHot,
      ecuHFrozen,
      ecuMesCap,
      ecuMesSnap,
      ecuMesElastic,
      ecuMesRecargo,
      ecuMes,
      ecuYear: ecuMes * 12,
    };
  }

  function allocations(withAdmin) {
    const totals = clusterTotals();
    const surcharge = computeSurcharge();
    return state.rows.map((r) => allocateRow(r, withAdmin, totals, surcharge));
  }

  function sumFamilies(names, withAdmin = true) {
    const set = new Set(names.filter(Boolean));
    const rows = allocations(withAdmin).filter((r) => set.has(r.family));
    return {
      rows,
      gbHot: rows.reduce((a, r) => a + (Number(r.gbHot) || 0), 0),
      gbFrozen: rows.reduce((a, r) => a + (Number(r.gbFrozen) || 0), 0),
      ecuMes: rows.reduce((a, r) => a + r.ecuMes, 0),
      ecuYear: rows.reduce((a, r) => a + r.ecuYear, 0),
    };
  }

  function save() {
    const payload = {
      params: state.params,
      rows: state.rows,
      cloudFamilies: state.cloudFamilies,
      onpremFamilies: state.onpremFamilies,
      anyFamily: state.anyFamily,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state.rows = structuredClone(window.DK_SEED_MEASUREMENT || []);
        return;
      }
      const data = JSON.parse(raw);
      state.params = { ...DEFAULT_PARAMS, ...data.params };
      state.rows = data.rows?.length ? data.rows : structuredClone(window.DK_SEED_MEASUREMENT || []);
      state.cloudFamilies = data.cloudFamilies || [...SAMPLE_CLOUD];
      state.onpremFamilies = data.onpremFamilies || [...SAMPLE_ONPREM];
      state.anyFamily = data.anyFamily || state.anyFamily;
    } catch {
      state.rows = structuredClone(window.DK_SEED_MEASUREMENT || []);
    }
  }

  function bindTabs() {
    $$(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".tab").forEach((b) => b.classList.remove("is-active"));
        $$(".panel").forEach((p) => p.classList.remove("is-active"));
        btn.classList.add("is-active");
        $(`#panel-${btn.dataset.tab}`).classList.add("is-active");
      });
    });
  }

  function renderKPIs() {
    const withA = allocations(true);
    const totals = clusterTotals();
    const surcharge = computeSurcharge();
    const ecuMes = withA.reduce((a, r) => a + r.ecuMes, 0);
    $("#kpi-ecu-month").textContent = money(ecuMes);
    $("#kpi-ecu-year").textContent = money(ecuMes * 12);
    $("#kpi-surcharge").textContent = pct(surcharge);
    $("#kpi-hot").textContent = `${num(totals.PRE.hot + totals.PRO.hot + totals.MON.hot, 1)} GB`;
    $("#kpi-families").textContent = `${state.rows.length} families`;
  }

  function renderParams() {
    const p = state.params;
    const map = {
      hoursMonth: p.hoursMonth,
      annualCommit: p.annualCommit,
      margin: p.margin,
      otherAnnual: p.otherAnnual,
      "hot.PRE": p.hot.PRE,
      "hot.PRO": p.hot.PRO,
      "hot.MON": p.hot.MON,
      "frozen.PRE": p.frozen.PRE,
      "frozen.PRO": p.frozen.PRO,
      "frozen.MON": p.frozen.MON,
      "kibana.PRE": p.kibana.PRE,
      "kibana.PRO": p.kibana.PRO,
      "integrations.PRE": p.integrations.PRE,
      "integrations.PRO": p.integrations.PRO,
      "tiebreaker.PRO": p.tiebreaker.PRO,
      "snapshots.PRE": p.snapshots.PRE,
      "snapshots.PRO": p.snapshots.PRO,
      "snapshots.MON": p.snapshots.MON,
    };
    Object.entries(map).forEach(([k, v]) => {
      const el = document.querySelector(`[data-param="${k}"]`);
      if (el && document.activeElement !== el) el.value = v;
    });
    const sur = computeSurcharge();
    const hy = p.hoursMonth * 12;
    const basePRE = p.hot.PRE * hy + p.frozen.PRE * hy + p.snapshots.PRE * 12;
    const basePRO = p.hot.PRO * hy + p.frozen.PRO * hy + p.snapshots.PRO * 12;
    const monAnnual = p.hot.MON * hy + p.snapshots.MON * 12;
    const platformAnnual = (platformRate("PRE") + platformRate("PRO")) * hy;
    const objetivo = p.annualCommit * (1 + p.margin);
    const consumo = basePRE + basePRO + platformAnnual + monAnnual + p.otherAnnual;
    $("#out-surcharge").textContent = pct(sur);
    $("#out-objetivo").textContent = money(objetivo);
    $("#out-consumo").textContent = money(consumo);
    $("#out-platform").textContent = money(platformAnnual);
    $("#out-mon").textContent = money(monAnnual);
    const totals = clusterTotals();
    $("#out-hot-pre").textContent = num(totals.PRE.hot, 2);
    $("#out-hot-pro").textContent = num(totals.PRO.hot, 2);
    $("#out-hot-mon").textContent = num(totals.MON.hot, 2);
    $("#out-frz-pre").textContent = num(totals.PRE.frozen, 2);
    $("#out-frz-pro").textContent = num(totals.PRO.frozen, 2);
    $("#out-frz-mon").textContent = num(totals.MON.frozen, 2);
  }

  function filteredRows() {
    return state.rows.filter((r) => {
      if (state.filterEnv !== "ALL" && r.env !== state.filterEnv) return false;
      if (!state.search) return true;
      const q = state.search.toLowerCase();
      return (
        String(r.family).toLowerCase().includes(q) ||
        String(r.what || "").toLowerCase().includes(q)
      );
    });
  }

  function renderMeasurement() {
    const tbody = $("#meas-body");
    const rows = filteredRows();
    tbody.innerHTML = rows
      .map((r) => {
        const idx = state.rows.indexOf(r);
        return `<tr data-idx="${idx}">
          <td><input data-f="family" value="${escapeAttr(r.family)}"></td>
          <td>
            <select data-f="env">
              ${["PRE", "PRO", "MON"].map((e) => `<option ${e === r.env ? "selected" : ""}>${e}</option>`).join("")}
            </select>
          </td>
          <td><input data-f="what" value="${escapeAttr(r.what || "")}"></td>
          <td><input data-f="eps15" type="number" step="any" value="${r.eps15}"></td>
          <td><input data-f="kbdoc" type="number" step="any" value="${r.kbdoc}"></td>
          <td><input data-f="docs" type="number" step="1" value="${r.docs}"></td>
          <td><input data-f="gbHot" type="number" step="any" value="${r.gbHot}"></td>
          <td><input data-f="gbFrozen" type="number" step="any" value="${r.gbFrozen}"></td>
          <td><input data-f="indices" type="number" step="1" value="${r.indices}"></td>
          <td><input data-f="epsLife" type="number" step="any" value="${r.epsLife}"></td>
          <td><input data-f="ageDays" type="number" step="any" value="${r.ageDays}"></td>
          <td><button class="btn btn--danger btn--sm" data-del="${idx}">✕</button></td>
        </tr>`;
      })
      .join("");
    $("#meas-count").textContent = `${rows.length} / ${state.rows.length} families`;
  }

  function escapeAttr(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;");
  }

  function renderAllocTable(target, withAdmin) {
    const rows = allocations(withAdmin);
    const sorted = [...rows].sort((a, b) => b.ecuMes - a.ecuMes);
    const el = $(target);
    const total = sorted.reduce((a, r) => a + r.ecuMes, 0);
    el.innerHTML = `
      <div class="hint" style="margin-bottom:.6rem">
        Surcharge applied: <strong>${withAdmin ? pct(computeSurcharge()) : "0%"}</strong>
        · Total to charge back: <strong>${money(total)} ECU/month</strong>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th>Family</th><th>Env</th><th>GB hot</th><th>Share hot</th>
          <th>GB frozen</th><th>Share frozen</th>
          <th>ECU/mo capacity</th><th>ECU/mo snapshots</th>
          <th>ECU/mo Elastic</th><th>ECU/mo surcharge</th><th>ECU/mo total</th><th>ECU/year</th>
        </tr></thead>
        <tbody>
          ${sorted
            .map(
              (r) => `<tr>
              <td>${escapeAttr(r.family)}</td>
              <td><span class="badge badge-${r.env}">${r.env}</span></td>
              <td class="num">${num(r.gbHot, 3)}</td>
              <td class="num">${pct(r.shareHot)}</td>
              <td class="num">${num(r.gbFrozen, 3)}</td>
              <td class="num">${pct(r.shareFrozen)}</td>
              <td class="num">${money(r.ecuMesCap)}</td>
              <td class="num">${money(r.ecuMesSnap)}</td>
              <td class="num">${money(r.ecuMesElastic)}</td>
              <td class="num">${money(r.ecuMesRecargo)}</td>
              <td class="num money">${money(r.ecuMes)}</td>
              <td class="num money">${money(r.ecuYear)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table></div>`;
  }

  function renderWorkload(kind) {
    const names = kind === "cloud" ? state.cloudFamilies : state.onpremFamilies;
    const box = $(`#${kind}-chips`);
    box.innerHTML = names
      .map(
        (n, i) =>
          `<span class="chip">${escapeAttr(n)} <button type="button" data-kind="${kind}" data-i="${i}" aria-label="Remove">×</button></span>`
      )
      .join("") || `<span class="hint">Add families from Measurement</span>`;

    const sum = sumFamilies(names, true);
    $(`#${kind}-gbhot`).textContent = num(sum.gbHot, 2);
    $(`#${kind}-gbfrozen`).textContent = num(sum.gbFrozen, 2);
    $(`#${kind}-ecumo`).textContent = money(sum.ecuMes);
    $(`#${kind}-ecuyr`).textContent = money(sum.ecuYear);

    const sel = $(`#${kind}-add`);
    const options = state.rows
      .map((r) => r.family)
      .filter((f) => !names.includes(f));
    sel.innerHTML =
      `<option value="">Add family…</option>` +
      options.map((f) => `<option value="${escapeAttr(f)}">${escapeAttr(f)}</option>`).join("");
  }

  function renderAnyFamily() {
    const sel = $("#any-family");
    const families = state.rows.map((r) => r.family);
    if (!families.includes(state.anyFamily) && families.length) {
      state.anyFamily = families[0];
    }
    sel.innerHTML = families
      .map(
        (f) =>
          `<option value="${escapeAttr(f)}" ${f === state.anyFamily ? "selected" : ""}>${escapeAttr(f)}</option>`
      )
      .join("");

    const row = state.rows.find((r) => r.family === state.anyFamily);
    const steps = $("#any-steps");
    if (!row) {
      steps.innerHTML = `<p class="hint">No family selected.</p>`;
      return;
    }
    const totals = clusterTotals();
    const sur = computeSurcharge();
    const a = allocateRow(row, true, totals, sur);
    const denHot = totals[row.env].hot;
    const denFrz = totals[row.env].frozen;
    const items = [
      ["GB hot (family)", a.gbHot, "From Measurement"],
      ["GB hot (cluster " + row.env + ")", denHot, "Sum of Measurement for env"],
      ["Hot share", a.shareHot, "family / cluster", true],
      ["GB frozen (family)", a.gbFrozen, "From Measurement"],
      ["GB frozen (cluster)", denFrz, "Sum of Measurement for env"],
      ["Frozen share", a.shareFrozen, "family / cluster", true],
      ["ECU/h hot", a.ecuHHot, "Parameters"],
      ["ECU/h frozen", a.ecuHFrozen, "Parameters"],
      ["Hours / month", state.params.hoursMonth, "Parameters"],
      ["ECU/month capacity", a.ecuMesCap, "(share×rates)×hours"],
      ["ECU/month snapshots", a.ecuMesSnap, "share × cluster snapshots"],
      ["ECU/month Elastic", a.ecuMesElastic, "capacity + snapshots"],
      ["Surcharge", sur, "Commit coverage uplift", true],
      ["ECU/month surcharge", a.ecuMesRecargo, "Elastic × surcharge (PRE/PRO only)"],
      ["ECU/month chargeback", a.ecuMes, "Elastic + surcharge"],
      ["ECU/year", a.ecuYear, "× 12"],
    ];
    steps.innerHTML = items
      .map((it, i) => {
        const [label, value, hint, isPct] = it;
        return `<div class="step">
          <div class="step-n">${i + 1}</div>
          <div><strong>${label}</strong><span>${hint}</span></div>
          <em>${isPct ? pct(value) : typeof value === "number" && value > 20 ? money(value) : num(Number(value), 4)}</em>
        </div>`;
      })
      .join("");
  }

  function renderAll() {
    renderKPIs();
    renderParams();
    renderMeasurement();
    renderAllocTable("#alloc-without", false);
    renderAllocTable("#alloc-with", true);
    renderWorkload("cloud");
    renderWorkload("onprem");
    renderAnyFamily();
    save();
  }

  function setParam(path, value) {
    const parts = path.split(".");
    let cur = state.params;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    const key = parts[parts.length - 1];
    cur[key] = Number(value);
  }

  function bindEvents() {
    document.body.addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches("[data-param]")) {
        setParam(t.dataset.param, t.value);
        renderAll();
        return;
      }
      if (t.matches("#filter-env")) {
        state.filterEnv = t.value;
        renderMeasurement();
        return;
      }
      if (t.matches("#any-family")) {
        state.anyFamily = t.value;
        renderAnyFamily();
        save();
        return;
      }
      if (t.matches("#cloud-add") && t.value) {
        state.cloudFamilies.push(t.value);
        t.value = "";
        renderWorkload("cloud");
        save();
        return;
      }
      if (t.matches("#onprem-add") && t.value) {
        state.onpremFamilies.push(t.value);
        t.value = "";
        renderWorkload("onprem");
        save();
        return;
      }
      const tr = t.closest("tr[data-idx]");
      if (tr && t.matches("[data-f]")) {
        const idx = Number(tr.dataset.idx);
        const f = t.dataset.f;
        let v = t.value;
        if (f !== "family" && f !== "what" && f !== "env") v = Number(v);
        state.rows[idx][f] = v;
        renderAll();
      }
    });

    document.body.addEventListener("input", (e) => {
      if (e.target.matches("#search-family")) {
        state.search = e.target.value.trim();
        renderMeasurement();
      }
    });

    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del]");
      if (btn) {
        state.rows.splice(Number(btn.dataset.del), 1);
        renderAll();
        toast("Family removed");
        return;
      }
      const chipBtn = e.target.closest(".chip button");
      if (chipBtn) {
        const kind = chipBtn.dataset.kind;
        const i = Number(chipBtn.dataset.i);
        if (kind === "cloud") state.cloudFamilies.splice(i, 1);
        else state.onpremFamilies.splice(i, 1);
        renderWorkload(kind);
        save();
      }
    });

    $("#btn-add-row").addEventListener("click", () => {
      state.rows.unshift({
        family: "new-family",
        env: "PRE",
        what: "",
        eps15: 0,
        kbdoc: 1,
        docs: 0,
        gbHot: 1,
        gbFrozen: 0,
        indices: 1,
        epsLife: 0,
        ageDays: 1,
      });
      renderAll();
      toast("Row added — edit the yellow-style fields");
      $(".tab[data-tab='measurement']").click();
    });

    $("#btn-reset-sample").addEventListener("click", () => {
      if (!confirm("Reset Measurement and Parameters to sample demo data?")) return;
      state.params = structuredClone(DEFAULT_PARAMS);
      state.rows = structuredClone(window.DK_SEED_MEASUREMENT || []);
      state.cloudFamilies = [...SAMPLE_CLOUD];
      state.onpremFamilies = [...SAMPLE_ONPREM];
      renderAll();
      toast("Sample data restored");
    });

    $("#btn-export-csv").addEventListener("click", () => {
      const header = [
        "family",
        "env",
        "what",
        "eps15",
        "kbdoc",
        "docs",
        "gbHot",
        "gbFrozen",
        "indices",
        "epsLife",
        "ageDays",
      ];
      const lines = [header.join(",")].concat(
        state.rows.map((r) =>
          header
            .map((h) => {
              const v = r[h] ?? "";
              const s = String(v).replaceAll('"', '""');
              return /[",\n]/.test(s) ? `"${s}"` : s;
            })
            .join(",")
        )
      );
      download("measurement.csv", lines.join("\n"), "text/csv");
      toast("CSV exported");
    });

    $("#btn-import-csv").addEventListener("click", () => $("#file-csv").click());
    $("#file-csv").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.length) {
        toast("No rows found in CSV");
        return;
      }
      state.rows = parsed;
      renderAll();
      toast(`Imported ${parsed.length} families`);
      e.target.value = "";
    });

    $("#btn-export-alloc").addEventListener("click", () => {
      const rows = allocations(true);
      const header = [
        "family",
        "env",
        "gbHot",
        "shareHot",
        "gbFrozen",
        "shareFrozen",
        "ecuMesElastic",
        "ecuMesRecargo",
        "ecuMes",
        "ecuYear",
      ];
      const lines = [header.join(",")].concat(
        rows.map((r) => header.map((h) => r[h]).join(","))
      );
      download("allocation-with-admin.csv", lines.join("\n"), "text/csv");
      toast("Allocation CSV exported");
    });
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cols = splitCsvLine(line);
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = cols[i] ?? "";
      });
      return {
        family: obj.family || obj.Familia || "",
        env: obj.env || obj.Entorno || "PRE",
        what: obj.what || obj.Que || "",
        eps15: Number(obj.eps15 || 0),
        kbdoc: Number(obj.kbdoc || 0),
        docs: Number(obj.docs || 0),
        gbHot: Number(obj.gbHot || obj["GB hot"] || 0),
        gbFrozen: Number(obj.gbFrozen || obj["GB frozen"] || 0),
        indices: Number(obj.indices || 0),
        epsLife: Number(obj.epsLife || 0),
        ageDays: Number(obj.ageDays || 0),
      };
    }).filter((r) => r.family);
  }

  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (c === "," && !q) {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out;
  }

  function init() {
    load();
    bindTabs();
    bindEvents();
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
