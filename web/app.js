(() => {
  const STORAGE_KEY = "dk-elastic-cost-allocator-v2";
  const LANG_KEY = "dk-elastic-cost-allocator-lang";

  /** Sample defaults — rename / add / remove for any client topology. */
  const DEFAULT_ENVIRONMENTS = [
    {
      code: "PRE",
      label: "Pre-production",
      applySurcharge: true,
      hot: 3.5,
      frozen: 0.35,
      kibana: 0.28,
      integrations: 0.14,
      tiebreaker: 0,
      snapshots: 200,
    },
    {
      code: "PRO",
      label: "Production",
      applySurcharge: true,
      hot: 5.0,
      frozen: 1.0,
      kibana: 0.56,
      integrations: 0.14,
      tiebreaker: 0.07,
      snapshots: 500,
    },
    {
      code: "MON",
      label: "Monitoring (dedicated)",
      applySurcharge: false,
      hot: 0.5,
      frozen: 0,
      kibana: 0,
      integrations: 0,
      tiebreaker: 0,
      snapshots: 10,
    },
  ];

  const DEFAULT_PARAMS = {
    hoursMonth: 730,
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
    environments: structuredClone(DEFAULT_ENVIRONMENTS),
    rows: [],
    cloudFamilies: [...SAMPLE_CLOUD],
    onpremFamilies: [...SAMPLE_ONPREM],
    anyFamily: "pro-app-appserver",
    filterEnv: "ALL",
    search: "",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const t = (...args) => window.t(...args);

  function detectLang() {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "es" || saved === "en") return saved;
    return (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";
  }

  function setLang(lang, announce) {
    window.DK_LANG = lang === "es" ? "es" : "en";
    localStorage.setItem(LANG_KEY, window.DK_LANG);
    window.applyI18n();
    renderAll();
    if (announce) toast(t(window.DK_LANG === "es" ? "toast.langEs" : "toast.langEn"));
  }

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

  function envCodes() {
    return state.environments.map((e) => e.code).filter(Boolean);
  }

  function findEnv(code) {
    return state.environments.find((e) => e.code === code);
  }

  function platformRate(envObj) {
    if (!envObj) return 0;
    return (Number(envObj.kibana) || 0) + (Number(envObj.integrations) || 0) + (Number(envObj.tiebreaker) || 0);
  }

  function envAnnualBase(envObj, hoursYear) {
    return (
      (Number(envObj.hot) || 0) * hoursYear +
      (Number(envObj.frozen) || 0) * hoursYear +
      (Number(envObj.snapshots) || 0) * 12
    );
  }

  /** Commit uplift: only environments with applySurcharge feed the base; others are dedicated (billed at own rate, deducted from target). */
  function computeSurcharge() {
    const p = state.params;
    if (p.surchargeOverride != null && p.surchargeOverride !== "") {
      return Number(p.surchargeOverride);
    }
    const hy = p.hoursMonth * 12;
    let base = 0;
    let dedicatedAnnual = 0;
    let platformAnnual = 0;
    for (const env of state.environments) {
      const annual = envAnnualBase(env, hy);
      if (env.applySurcharge) {
        base += annual;
        platformAnnual += platformRate(env) * hy;
      } else {
        dedicatedAnnual += annual;
      }
    }
    const objetivo = p.annualCommit * (1 + p.margin);
    if (base <= 0) return 0;
    return (objetivo - dedicatedAnnual) / base - 1;
  }

  function financeSummary() {
    const p = state.params;
    const hy = p.hoursMonth * 12;
    let base = 0;
    let dedicatedAnnual = 0;
    let platformAnnual = 0;
    for (const env of state.environments) {
      const annual = envAnnualBase(env, hy);
      if (env.applySurcharge) {
        base += annual;
        platformAnnual += platformRate(env) * hy;
      } else {
        dedicatedAnnual += annual;
      }
    }
    const objetivo = p.annualCommit * (1 + p.margin);
    const surcharge = computeSurcharge();
    const consumo = base + platformAnnual + dedicatedAnnual + p.otherAnnual;
    return { hy, base, dedicatedAnnual, platformAnnual, objetivo, surcharge, consumo };
  }

  function clusterTotals(rows = state.rows) {
    const out = {};
    for (const code of envCodes()) out[code] = { hot: 0, frozen: 0 };
    for (const r of rows) {
      const e = r.env;
      if (!out[e]) out[e] = { hot: 0, frozen: 0 };
      out[e].hot += Number(r.gbHot) || 0;
      out[e].frozen += Number(r.gbFrozen) || 0;
    }
    return out;
  }

  function allocateRow(row, withAdmin, totals, surcharge) {
    const env = row.env;
    const envObj = findEnv(env);
    const gbHot = Number(row.gbHot) || 0;
    const gbFrozen = Number(row.gbFrozen) || 0;
    const denHot = totals[env]?.hot || 0;
    const denFrozen = totals[env]?.frozen || 0;
    const shareHot = denHot > 0 ? gbHot / denHot : 0;
    const shareFrozen = denFrozen > 0 ? gbFrozen / denFrozen : 0;
    const ecuHHot = envObj ? Number(envObj.hot) || 0 : 0;
    const ecuHFrozen = envObj ? Number(envObj.frozen) || 0 : 0;
    const snaps = envObj ? Number(envObj.snapshots) || 0 : 0;
    const hours = state.params.hoursMonth;
    const ecuMesCap = (shareHot * ecuHHot + shareFrozen * ecuHFrozen) * hours;
    const snapShare = denFrozen > 0 ? shareFrozen : shareHot;
    const ecuMesSnap = snapShare * snaps;
    const ecuMesElastic = ecuMesCap + ecuMesSnap;
    const applySur = withAdmin && !!(envObj && envObj.applySurcharge);
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
      unknownEnv: !envObj,
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

  function migrateLegacyParams(data) {
    if (data.environments?.length) {
      return {
        params: { ...DEFAULT_PARAMS, ...data.params },
        environments: data.environments,
      };
    }
    // v1: fixed PRE/PRO/MON maps → environments[]
    const p = data.params || {};
    const environments = structuredClone(DEFAULT_ENVIRONMENTS).map((env) => {
      const code = env.code;
      return {
        ...env,
        hot: p.hot?.[code] ?? env.hot,
        frozen: p.frozen?.[code] ?? env.frozen,
        kibana: p.kibana?.[code] ?? env.kibana,
        integrations: p.integrations?.[code] ?? env.integrations,
        tiebreaker: p.tiebreaker?.[code] ?? env.tiebreaker,
        snapshots: p.snapshots?.[code] ?? env.snapshots,
      };
    });
    return {
      params: {
        hoursMonth: p.hoursMonth ?? DEFAULT_PARAMS.hoursMonth,
        annualCommit: p.annualCommit ?? DEFAULT_PARAMS.annualCommit,
        margin: p.margin ?? DEFAULT_PARAMS.margin,
        otherAnnual: p.otherAnnual ?? DEFAULT_PARAMS.otherAnnual,
        surchargeOverride: p.surchargeOverride ?? null,
      },
      environments,
    };
  }

  function save() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        params: state.params,
        environments: state.environments,
        rows: state.rows,
        cloudFamilies: state.cloudFamilies,
        onpremFamilies: state.onpremFamilies,
        anyFamily: state.anyFamily,
      })
    );
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("dk-elastic-cost-allocator-v1");
      if (!raw) {
        state.environments = structuredClone(DEFAULT_ENVIRONMENTS);
        state.params = structuredClone(DEFAULT_PARAMS);
        state.rows = structuredClone(window.DK_SEED_MEASUREMENT || []);
        return;
      }
      const data = JSON.parse(raw);
      const migrated = migrateLegacyParams(data);
      state.params = migrated.params;
      state.environments = migrated.environments;
      state.rows = data.rows?.length ? data.rows : structuredClone(window.DK_SEED_MEASUREMENT || []);
      state.cloudFamilies = data.cloudFamilies || [...SAMPLE_CLOUD];
      state.onpremFamilies = data.onpremFamilies || [...SAMPLE_ONPREM];
      state.anyFamily = data.anyFamily || state.anyFamily;
    } catch {
      state.environments = structuredClone(DEFAULT_ENVIRONMENTS);
      state.params = structuredClone(DEFAULT_PARAMS);
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
    const hotSum = Object.values(totals).reduce((a, t) => a + t.hot, 0);
    $("#kpi-ecu-month").textContent = money(ecuMes);
    $("#kpi-ecu-year").textContent = money(ecuMes * 12);
    $("#kpi-surcharge").textContent = pct(surcharge);
    $("#kpi-hot").textContent = `${num(hotSum, 1)} GB`;
    $("#kpi-families").textContent = t("dyn.families", { n: state.rows.length });
    const surEnvs = state.environments.filter((e) => e.applySurcharge).map((e) => e.code).join(" + ") || "—";
    const sub = $("#kpi-surcharge-sub");
    if (sub) sub.textContent = t("kpi.surcharge.sub", { envs: surEnvs });
  }

  function renderParams() {
    const p = state.params;
    const map = {
      hoursMonth: p.hoursMonth,
      annualCommit: p.annualCommit,
      margin: p.margin,
      otherAnnual: p.otherAnnual,
    };
    Object.entries(map).forEach(([k, v]) => {
      const el = document.querySelector(`[data-param="${k}"]`);
      if (el && document.activeElement !== el) el.value = v;
    });

    const fin = financeSummary();
    $("#out-surcharge").textContent = pct(fin.surcharge);
    $("#out-objetivo").textContent = money(fin.objetivo);
    $("#out-consumo").textContent = money(fin.consumo);
    $("#out-platform").textContent = money(fin.platformAnnual);
    $("#out-dedicated").textContent = money(fin.dedicatedAnnual);
    $("#out-base").textContent = money(fin.base);

    const tbody = $("#env-body");
    tbody.innerHTML = state.environments
      .map((env, i) => {
        const focused = document.activeElement;
        const skipFocus = focused && focused.closest?.(`#env-body tr[data-ei="${i}"]`);
        void skipFocus;
        return `<tr data-ei="${i}">
          <td><input data-ef="code" value="${escapeAttr(env.code)}"></td>
          <td><input data-ef="label" value="${escapeAttr(env.label || "")}"></td>
          <td style="text-align:center"><input data-ef="applySurcharge" type="checkbox" ${env.applySurcharge ? "checked" : ""} title="${escapeAttr(t("env.applyHint"))}"></td>
          <td><input data-ef="hot" type="number" step="any" value="${env.hot}"></td>
          <td><input data-ef="frozen" type="number" step="any" value="${env.frozen}"></td>
          <td><input data-ef="kibana" type="number" step="any" value="${env.kibana}"></td>
          <td><input data-ef="integrations" type="number" step="any" value="${env.integrations}"></td>
          <td><input data-ef="tiebreaker" type="number" step="any" value="${env.tiebreaker}"></td>
          <td><input data-ef="snapshots" type="number" step="any" value="${env.snapshots}"></td>
          <td><button class="btn btn--danger btn--sm" data-env-del="${i}" type="button">✕</button></td>
        </tr>`;
      })
      .join("");

    const totals = clusterTotals();
    const usage = $("#env-usage");
    usage.innerHTML = state.environments
      .map((env) => {
        const tot = totals[env.code] || { hot: 0, frozen: 0 };
        return `<div class="env-usage-card">
          <strong>${escapeAttr(env.code)}</strong>
          <span class="hint">${escapeAttr(env.label || "")}</span>
          <div>${t("env.usageHot")}: <strong>${num(tot.hot, 2)}</strong></div>
          <div>${t("env.usageFrz")}: <strong>${num(tot.frozen, 2)}</strong></div>
          <div class="hint">${env.applySurcharge ? t("env.roleSurcharge") : t("env.roleDedicated")}</div>
        </div>`;
      })
      .join("");
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

  function escapeAttr(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;");
  }

  function envSelectOptions(selected) {
    const codes = envCodes();
    const all = new Set([...codes, selected].filter(Boolean));
    return [...all]
      .map((e) => {
        const known = codes.includes(e);
        const label = known ? e : `${e} ⚠`;
        return `<option value="${escapeAttr(e)}" ${e === selected ? "selected" : ""}>${escapeAttr(label)}</option>`;
      })
      .join("");
  }

  function renderMeasurement() {
    const tbody = $("#meas-body");
    const rows = filteredRows();
    tbody.innerHTML = rows
      .map((r) => {
        const idx = state.rows.indexOf(r);
        const unknown = !findEnv(r.env);
        return `<tr data-idx="${idx}" class="${unknown ? "row-warn" : ""}">
          <td><input data-f="family" value="${escapeAttr(r.family)}"></td>
          <td><select data-f="env">${envSelectOptions(r.env)}</select></td>
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
    $("#meas-count").textContent = t("dyn.measCount", {
      shown: rows.length,
      total: state.rows.length,
    });

    const filter = $("#filter-env");
    const cur = state.filterEnv;
    filter.innerHTML =
      `<option value="ALL">${t("meas.allEnvs")}</option>` +
      envCodes()
        .map((c) => `<option value="${escapeAttr(c)}" ${c === cur ? "selected" : ""}>${escapeAttr(c)}</option>`)
        .join("");
  }

  function renderAllocTable(target, withAdmin) {
    const rows = allocations(withAdmin);
    const sorted = [...rows].sort((a, b) => b.ecuMes - a.ecuMes);
    const el = $(target);
    const total = sorted.reduce((a, r) => a + r.ecuMes, 0);
    el.innerHTML = `
      <div class="hint" style="margin-bottom:.6rem">
        ${t("dyn.surchargeApplied")} <strong>${withAdmin ? pct(computeSurcharge()) : "0%"}</strong>
        ${t("dyn.totalChargeback")} <strong>${money(total)} ${t("dyn.ecuMonth")}</strong>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th>${t("meas.th.family")}</th><th>${t("meas.th.env")}</th><th>${t("meas.th.hot")}</th><th>${t("dyn.th.shareHot")}</th>
          <th>${t("meas.th.frz")}</th><th>${t("dyn.th.shareFrz")}</th>
          <th>${t("dyn.th.cap")}</th><th>${t("dyn.th.snap")}</th>
          <th>${t("dyn.th.elastic")}</th><th>${t("dyn.th.sur")}</th><th>${t("dyn.th.total")}</th><th>${t("dyn.th.year")}</th>
        </tr></thead>
        <tbody>
          ${sorted
            .map(
              (r) => `<tr class="${r.unknownEnv ? "row-warn" : ""}">
              <td>${escapeAttr(r.family)}</td>
              <td><span class="badge">${escapeAttr(r.env)}</span></td>
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
      .join("") || `<span class="hint">${t("dyn.addFamiliesHint")}</span>`;

    const sum = sumFamilies(names, true);
    $(`#${kind}-gbhot`).textContent = num(sum.gbHot, 2);
    $(`#${kind}-gbfrozen`).textContent = num(sum.gbFrozen, 2);
    $(`#${kind}-ecumo`).textContent = money(sum.ecuMes);
    $(`#${kind}-ecuyr`).textContent = money(sum.ecuYear);

    const sel = $(`#${kind}-add`);
    const options = state.rows.map((r) => r.family).filter((f) => !names.includes(f));
    sel.innerHTML =
      `<option value="">${t("dyn.addFamily")}</option>` +
      options.map((f) => `<option value="${escapeAttr(f)}">${escapeAttr(f)}</option>`).join("");
  }

  function renderAnyFamily() {
    const sel = $("#any-family");
    const families = state.rows.map((r) => r.family);
    if (!families.includes(state.anyFamily) && families.length) state.anyFamily = families[0];
    sel.innerHTML = families
      .map(
        (f) =>
          `<option value="${escapeAttr(f)}" ${f === state.anyFamily ? "selected" : ""}>${escapeAttr(f)}</option>`
      )
      .join("");

    const row = state.rows.find((r) => r.family === state.anyFamily);
    const steps = $("#any-steps");
    if (!row) {
      steps.innerHTML = `<p class="hint">${t("dyn.noFamily")}</p>`;
      return;
    }
    const totals = clusterTotals();
    const sur = computeSurcharge();
    const a = allocateRow(row, true, totals, sur);
    const denHot = totals[row.env]?.hot || 0;
    const denFrz = totals[row.env]?.frozen || 0;
    const envObj = findEnv(row.env);
    const items = [
      [t("step.gbHotFam"), a.gbHot, t("step.gbHotFam.h")],
      [t("step.gbHotCl", { env: row.env }), denHot, t("step.gbHotCl.h")],
      [t("step.shareHot"), a.shareHot, t("step.shareHot.h"), true],
      [t("step.gbFrzFam"), a.gbFrozen, t("step.gbFrzFam.h")],
      [t("step.gbFrzCl"), denFrz, t("step.gbFrzCl.h")],
      [t("step.shareFrz"), a.shareFrozen, t("step.shareFrz.h"), true],
      [t("step.ecuHot"), a.ecuHHot, t("step.ecuHot.h")],
      [t("step.ecuFrz"), a.ecuHFrozen, t("step.ecuFrz.h")],
      [t("step.hours"), state.params.hoursMonth, t("step.hours.h")],
      [t("step.cap"), a.ecuMesCap, t("step.cap.h")],
      [t("step.snap"), a.ecuMesSnap, t("step.snap.h")],
      [t("step.elastic"), a.ecuMesElastic, t("step.elastic.h")],
      [t("step.sur"), sur, t("step.sur.h"), true],
      [
        t("step.surAmt"),
        a.ecuMesRecargo,
        envObj?.applySurcharge ? t("step.surAmt.h") : t("step.surAmt.dedicated"),
      ],
      [t("step.total"), a.ecuMes, t("step.total.h")],
      [t("step.year"), a.ecuYear, t("step.year.h")],
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

  function renameEnvInRows(oldCode, newCode) {
    if (!oldCode || !newCode || oldCode === newCode) return;
    state.rows.forEach((r) => {
      if (r.env === oldCode) r.env = newCode;
    });
  }

  function bindEvents() {
    document.body.addEventListener("change", (e) => {
      const tEl = e.target;
      if (tEl.matches("[data-param]")) {
        state.params[tEl.dataset.param] = Number(tEl.value);
        renderAll();
        return;
      }
      if (tEl.matches("#filter-env")) {
        state.filterEnv = tEl.value;
        renderMeasurement();
        return;
      }
      if (tEl.matches("#any-family")) {
        state.anyFamily = tEl.value;
        renderAnyFamily();
        save();
        return;
      }
      if (tEl.matches("#cloud-add") && tEl.value) {
        state.cloudFamilies.push(tEl.value);
        tEl.value = "";
        renderWorkload("cloud");
        save();
        return;
      }
      if (tEl.matches("#onprem-add") && tEl.value) {
        state.onpremFamilies.push(tEl.value);
        tEl.value = "";
        renderWorkload("onprem");
        save();
        return;
      }

      const envTr = tEl.closest("tr[data-ei]");
      if (envTr && tEl.matches("[data-ef]")) {
        const i = Number(envTr.dataset.ei);
        const f = tEl.dataset.ef;
        if (f === "applySurcharge") {
          state.environments[i].applySurcharge = tEl.checked;
        } else if (f === "code") {
          const old = state.environments[i].code;
          const next = tEl.value.trim();
          state.environments[i].code = next;
          renameEnvInRows(old, next);
        } else if (f === "label") {
          state.environments[i].label = tEl.value;
        } else {
          state.environments[i][f] = Number(tEl.value);
        }
        renderAll();
        return;
      }

      const tr = tEl.closest("tr[data-idx]");
      if (tr && tEl.matches("[data-f]")) {
        const idx = Number(tr.dataset.idx);
        const f = tEl.dataset.f;
        let v = tEl.value;
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
      const del = e.target.closest("[data-del]");
      if (del) {
        state.rows.splice(Number(del.dataset.del), 1);
        renderAll();
        toast(t("toast.removed"));
        return;
      }
      const envDel = e.target.closest("[data-env-del]");
      if (envDel) {
        if (state.environments.length <= 1) {
          toast(t("toast.envMin"));
          return;
        }
        const i = Number(envDel.dataset.envDel);
        const code = state.environments[i].code;
        state.environments.splice(i, 1);
        renderAll();
        toast(t("toast.envRemoved", { code }));
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
      const langBtn = e.target.closest("[data-lang-btn]");
      if (langBtn) setLang(langBtn.getAttribute("data-lang-btn"), true);
    });

    $("#btn-add-env").addEventListener("click", () => {
      let n = state.environments.length + 1;
      let code = `ENV${n}`;
      while (envCodes().includes(code)) {
        n += 1;
        code = `ENV${n}`;
      }
      state.environments.push({
        code,
        label: t("env.newLabel"),
        applySurcharge: true,
        hot: 1,
        frozen: 0,
        kibana: 0,
        integrations: 0,
        tiebreaker: 0,
        snapshots: 0,
      });
      renderAll();
      toast(t("toast.envAdded", { code }));
      $(".tab[data-tab='parameters']").click();
    });

    $("#btn-add-row").addEventListener("click", () => {
      const first = envCodes()[0] || "ENV1";
      state.rows.unshift({
        family: "new-family",
        env: first,
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
      toast(t("toast.added"));
      $(".tab[data-tab='measurement']").click();
    });

    $("#btn-reset-sample").addEventListener("click", () => {
      if (!confirm(t("toast.resetConfirm"))) return;
      state.params = structuredClone(DEFAULT_PARAMS);
      state.environments = structuredClone(DEFAULT_ENVIRONMENTS);
      state.rows = structuredClone(window.DK_SEED_MEASUREMENT || []);
      state.cloudFamilies = [...SAMPLE_CLOUD];
      state.onpremFamilies = [...SAMPLE_ONPREM];
      renderAll();
      toast(t("toast.reset"));
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
      toast(t("toast.csvOut"));
    });

    $("#btn-export-envs").addEventListener("click", () => {
      const header = [
        "code",
        "label",
        "applySurcharge",
        "hot",
        "frozen",
        "kibana",
        "integrations",
        "tiebreaker",
        "snapshots",
      ];
      const lines = [header.join(",")].concat(
        state.environments.map((e) =>
          header.map((h) => (h === "applySurcharge" ? (e[h] ? "TRUE" : "FALSE") : e[h])).join(",")
        )
      );
      download("environments.csv", lines.join("\n"), "text/csv");
      toast(t("toast.envCsvOut"));
    });

    $("#btn-import-csv").addEventListener("click", () => $("#file-csv").click());
    $("#file-csv").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.length) {
        toast(t("toast.csvEmpty"));
        return;
      }
      state.rows = parsed;
      // auto-add missing env codes from CSV
      const known = new Set(envCodes());
      for (const r of parsed) {
        if (r.env && !known.has(r.env)) {
          state.environments.push({
            code: r.env,
            label: r.env,
            applySurcharge: true,
            hot: 1,
            frozen: 0,
            kibana: 0,
            integrations: 0,
            tiebreaker: 0,
            snapshots: 0,
          });
          known.add(r.env);
        }
      }
      renderAll();
      toast(t("toast.csvIn", { n: parsed.length }));
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
      const lines = [header.join(",")].concat(rows.map((r) => header.map((h) => r[h]).join(",")));
      download("allocation-with-admin.csv", lines.join("\n"), "text/csv");
      toast(t("toast.allocOut"));
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
    return lines
      .slice(1)
      .map((line) => {
        const cols = splitCsvLine(line);
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = cols[i] ?? "";
        });
        return {
          family: obj.family || obj.Familia || "",
          env: obj.env || obj.Entorno || envCodes()[0] || "ENV1",
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
      })
      .filter((r) => r.family);
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
    setLang(detectLang(), false);
    bindTabs();
    bindEvents();
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
