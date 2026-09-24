(() => {
  const STORAGE_KEY = "dk-elastic-cost-allocator-v3";
  const LANG_KEY = "dk-elastic-cost-allocator-lang";

  /** Storage tiers — enable only what the cluster uses (hot-only, hot+warm+cold, +frozen, …). */
  const DEFAULT_TIERS = [
    { code: "hot", label: "Hot", enabled: true },
    { code: "warm", label: "Warm", enabled: false },
    { code: "cold", label: "Cold", enabled: false },
    { code: "frozen", label: "Frozen", enabled: true },
  ];

  const EMPTY_RATES = () => ({ hot: 0, warm: 0, cold: 0, frozen: 0 });
  const EMPTY_GB = () => ({ hot: 0, warm: 0, cold: 0, frozen: 0 });
  const EMPTY_PLATFORM = () => ({ kibana: 0, integrations: 0, tiebreaker: 0 });

  const DEFAULT_ENVIRONMENTS = [
    {
      code: "PRE",
      label: "Pre-production",
      applySurcharge: true,
      rates: { hot: 3.5, warm: 0, cold: 0, frozen: 0.35 },
      platform: { kibana: 0.28, integrations: 0.14, tiebreaker: 0 },
      snapshots: 200,
    },
    {
      code: "PRO",
      label: "Production",
      applySurcharge: true,
      rates: { hot: 5.0, warm: 0, cold: 0, frozen: 1.0 },
      platform: { kibana: 0.56, integrations: 0.14, tiebreaker: 0.07 },
      snapshots: 500,
    },
    {
      code: "MON",
      label: "Monitoring (dedicated)",
      applySurcharge: false,
      rates: { hot: 0.5, warm: 0, cold: 0, frozen: 0 },
      platform: EMPTY_PLATFORM(),
      snapshots: 10,
    },
  ];

  const DEFAULT_PARAMS = {
    deployment: "cloud", // cloud | onprem
    unit: "ECU", // ECU, EUR, USD, …
    hoursMonth: 730,
    annualCommit: 100000,
    margin: 0.03,
    otherAnnual: 500,
    snapshotAllocTier: "auto", // auto | hot | warm | cold | frozen
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
    tiers: structuredClone(DEFAULT_TIERS),
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

  function unit() {
    return state.params.unit || "ECU";
  }

  function enabledTiers() {
    return state.tiers.filter((x) => x.enabled);
  }

  function tierCodes() {
    return state.tiers.map((x) => x.code);
  }

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

  function escapeAttr(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;");
  }

  function envCodes() {
    return state.environments.map((e) => e.code).filter(Boolean);
  }

  function findEnv(code) {
    return state.environments.find((e) => e.code === code);
  }

  function normalizeEnv(env) {
    const rates = { ...EMPTY_RATES(), ...(env.rates || {}) };
    if (env.hot != null && env.rates == null) rates.hot = Number(env.hot) || 0;
    if (env.frozen != null && env.rates == null) rates.frozen = Number(env.frozen) || 0;
    const platform = { ...EMPTY_PLATFORM(), ...(env.platform || {}) };
    if (env.kibana != null && env.platform == null) platform.kibana = Number(env.kibana) || 0;
    if (env.integrations != null && env.platform == null) platform.integrations = Number(env.integrations) || 0;
    if (env.tiebreaker != null && env.platform == null) platform.tiebreaker = Number(env.tiebreaker) || 0;
    return {
      code: env.code,
      label: env.label || "",
      applySurcharge: !!env.applySurcharge,
      rates,
      platform,
      snapshots: Number(env.snapshots) || 0,
    };
  }

  function normalizeRow(r) {
    const gb = { ...EMPTY_GB(), ...(r.gb || {}) };
    if (r.gbHot != null && r.gb == null) gb.hot = Number(r.gbHot) || 0;
    if (r.gbFrozen != null && r.gb == null) gb.frozen = Number(r.gbFrozen) || 0;
    return {
      family: r.family || "",
      env: r.env || "",
      what: r.what || "",
      eps15: Number(r.eps15) || 0,
      kbdoc: Number(r.kbdoc) || 0,
      docs: Number(r.docs) || 0,
      indices: Number(r.indices) || 0,
      epsLife: Number(r.epsLife) || 0,
      ageDays: Number(r.ageDays) || 0,
      gb,
    };
  }

  function platformRate(envObj) {
    if (!envObj) return 0;
    const p = envObj.platform || EMPTY_PLATFORM();
    return (Number(p.kibana) || 0) + (Number(p.integrations) || 0) + (Number(p.tiebreaker) || 0);
  }

  function tierRatesSum(envObj) {
    let s = 0;
    for (const tier of enabledTiers()) {
      s += Number(envObj.rates?.[tier.code]) || 0;
    }
    return s;
  }

  function envAnnualBase(envObj, hoursYear) {
    return tierRatesSum(envObj) * hoursYear + (Number(envObj.snapshots) || 0) * 12;
  }

  function computeSurcharge() {
    const p = state.params;
    if (p.surchargeOverride != null && p.surchargeOverride !== "") return Number(p.surchargeOverride);
    const hy = p.hoursMonth * 12;
    let base = 0;
    let dedicatedAnnual = 0;
    for (const env of state.environments) {
      const annual = envAnnualBase(env, hy);
      if (env.applySurcharge) base += annual;
      else dedicatedAnnual += annual;
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
      } else dedicatedAnnual += annual;
    }
    const objetivo = p.annualCommit * (1 + p.margin);
    return {
      hy,
      base,
      dedicatedAnnual,
      platformAnnual,
      objetivo,
      surcharge: computeSurcharge(),
      consumo: base + platformAnnual + dedicatedAnnual + p.otherAnnual,
    };
  }

  function clusterTotals(rows = state.rows) {
    const out = {};
    for (const code of envCodes()) {
      out[code] = EMPTY_GB();
    }
    for (const r of rows) {
      if (!out[r.env]) out[r.env] = EMPTY_GB();
      for (const tier of tierCodes()) {
        out[r.env][tier] += Number(r.gb?.[tier]) || 0;
      }
    }
    return out;
  }

  /** Which tier share drives snapshot allocation. */
  function resolveSnapshotTier(envCode, totals) {
    const pref = state.params.snapshotAllocTier || "auto";
    const tot = totals[envCode] || EMPTY_GB();
    if (pref !== "auto") {
      const tdef = state.tiers.find((x) => x.code === pref && x.enabled);
      if (tdef) return pref;
    }
    for (const code of ["frozen", "cold", "warm", "hot"]) {
      const tdef = state.tiers.find((x) => x.code === code && x.enabled);
      if (tdef && (tot[code] || 0) > 0) return code;
    }
    const first = enabledTiers()[0];
    return first ? first.code : "hot";
  }

  function allocateRow(row, withAdmin, totals, surcharge) {
    const env = row.env;
    const envObj = findEnv(env);
    const tot = totals[env] || EMPTY_GB();
    const hours = state.params.hoursMonth;
    const shares = {};
    let ecuMesCap = 0;
    const tierCosts = {};
    for (const tier of enabledTiers()) {
      const code = tier.code;
      const gb = Number(row.gb?.[code]) || 0;
      const den = tot[code] || 0;
      const share = den > 0 ? gb / den : 0;
      shares[code] = share;
      const rate = envObj ? Number(envObj.rates?.[code]) || 0 : 0;
      const cost = share * rate * hours;
      tierCosts[code] = cost;
      ecuMesCap += cost;
    }
    const snapTier = resolveSnapshotTier(env, totals);
    const snapShare = shares[snapTier] ?? 0;
    const snaps = envObj ? Number(envObj.snapshots) || 0 : 0;
    const ecuMesSnap = snapShare * snaps;
    const ecuMesElastic = ecuMesCap + ecuMesSnap;
    const applySur = withAdmin && !!(envObj && envObj.applySurcharge);
    const ecuMesRecargo = applySur ? ecuMesElastic * surcharge : 0;
    const ecuMes = ecuMesElastic + ecuMesRecargo;
    return {
      ...row,
      shares,
      tierCosts,
      snapTier,
      snapShare,
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
    const gb = EMPTY_GB();
    for (const r of rows) {
      for (const c of tierCodes()) gb[c] += Number(r.gb?.[c]) || 0;
    }
    return {
      rows,
      gb,
      ecuMes: rows.reduce((a, r) => a + r.ecuMes, 0),
      ecuYear: rows.reduce((a, r) => a + r.ecuYear, 0),
    };
  }

  function migrate(data) {
    let params = { ...DEFAULT_PARAMS, ...(data.params || {}) };
    // v1 fixed maps
    if (data.params?.hot && !data.environments) {
      /* handled below via environments migration */
    }
    let tiers = data.tiers?.length ? data.tiers.map((x) => ({ ...x })) : structuredClone(DEFAULT_TIERS);
    let environments;
    if (data.environments?.length) {
      environments = data.environments.map(normalizeEnv);
    } else if (data.params?.hot) {
      const p = data.params;
      environments = structuredClone(DEFAULT_ENVIRONMENTS).map((env) => {
        const code = env.code;
        return normalizeEnv({
          ...env,
          rates: {
            hot: p.hot?.[code] ?? env.rates.hot,
            warm: 0,
            cold: 0,
            frozen: p.frozen?.[code] ?? env.rates.frozen,
          },
          platform: {
            kibana: p.kibana?.[code] ?? env.platform.kibana,
            integrations: p.integrations?.[code] ?? env.platform.integrations,
            tiebreaker: p.tiebreaker?.[code] ?? env.platform.tiebreaker,
          },
          snapshots: p.snapshots?.[code] ?? env.snapshots,
        });
      });
      params = {
        ...DEFAULT_PARAMS,
        hoursMonth: p.hoursMonth ?? DEFAULT_PARAMS.hoursMonth,
        annualCommit: p.annualCommit ?? DEFAULT_PARAMS.annualCommit,
        margin: p.margin ?? DEFAULT_PARAMS.margin,
        otherAnnual: p.otherAnnual ?? DEFAULT_PARAMS.otherAnnual,
      };
    } else {
      environments = structuredClone(DEFAULT_ENVIRONMENTS);
    }

    // Ensure rates keys for all tier codes
    for (const env of environments) {
      for (const code of tierCodes()) {
        if (env.rates[code] == null) env.rates[code] = 0;
      }
    }

    const rows = (data.rows?.length ? data.rows : window.DK_SEED_MEASUREMENT || []).map(normalizeRow);
    return { params, tiers, environments, rows };
  }

  function save() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        params: state.params,
        tiers: state.tiers,
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
      const raw =
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem("dk-elastic-cost-allocator-v2") ||
        localStorage.getItem("dk-elastic-cost-allocator-v1");
      if (!raw) {
        state.params = structuredClone(DEFAULT_PARAMS);
        state.tiers = structuredClone(DEFAULT_TIERS);
        state.environments = structuredClone(DEFAULT_ENVIRONMENTS);
        state.rows = (window.DK_SEED_MEASUREMENT || []).map(normalizeRow);
        return;
      }
      const data = JSON.parse(raw);
      const m = migrate(data);
      state.params = m.params;
      state.tiers = m.tiers;
      state.environments = m.environments;
      state.rows = m.rows;
      state.cloudFamilies = data.cloudFamilies || [...SAMPLE_CLOUD];
      state.onpremFamilies = data.onpremFamilies || [...SAMPLE_ONPREM];
      state.anyFamily = data.anyFamily || state.anyFamily;
    } catch {
      state.params = structuredClone(DEFAULT_PARAMS);
      state.tiers = structuredClone(DEFAULT_TIERS);
      state.environments = structuredClone(DEFAULT_ENVIRONMENTS);
      state.rows = (window.DK_SEED_MEASUREMENT || []).map(normalizeRow);
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
    const ecuMes = withA.reduce((a, r) => a + r.ecuMes, 0);
    let hotSum = 0;
    for (const env of Object.values(totals)) {
      for (const tier of enabledTiers()) hotSum += env[tier.code] || 0;
    }
    $("#kpi-ecu-month").textContent = money(ecuMes);
    $("#kpi-ecu-year").textContent = money(ecuMes * 12);
    $("#kpi-surcharge").textContent = pct(computeSurcharge());
    $("#kpi-hot").textContent = `${num(hotSum, 1)} GB`;
    $("#kpi-families").textContent = t("dyn.families", { n: state.rows.length });
    const surEnvs = state.environments.filter((e) => e.applySurcharge).map((e) => e.code).join(" + ") || "—";
    const sub = $("#kpi-surcharge-sub");
    if (sub) sub.textContent = t("kpi.surcharge.sub", { envs: surEnvs });
    const u = unit();
    $$("[data-unit]").forEach((el) => {
      el.textContent = u;
    });
    document.body.dataset.deployment = state.params.deployment;
  }

  function renderTiers() {
    const box = $("#tiers-body");
    box.innerHTML = state.tiers
      .map(
        (tier, i) => `<tr data-ti="${i}">
          <td><input data-tf="code" value="${escapeAttr(tier.code)}" ${["hot", "warm", "cold", "frozen"].includes(tier.code) ? "readonly" : ""}></td>
          <td><input data-tf="label" value="${escapeAttr(tier.label)}"></td>
          <td style="text-align:center"><input data-tf="enabled" type="checkbox" ${tier.enabled ? "checked" : ""}></td>
        </tr>`
      )
      .join("");

    const snapSel = $("#snapshot-tier");
    const cur = state.params.snapshotAllocTier;
    snapSel.innerHTML =
      `<option value="auto">${t("tier.snapAuto")}</option>` +
      enabledTiers()
        .map((x) => `<option value="${x.code}" ${cur === x.code ? "selected" : ""}>${escapeAttr(x.label)}</option>`)
        .join("");
    if (cur !== "auto" && !enabledTiers().some((x) => x.code === cur)) {
      state.params.snapshotAllocTier = "auto";
      snapSel.value = "auto";
    } else snapSel.value = cur;
  }

  function renderParams() {
    const p = state.params;
    const dep = $("#deployment-mode");
    if (dep && document.activeElement !== dep) dep.value = p.deployment;
    const unitEl = $("[data-param='unit']");
    if (unitEl && document.activeElement !== unitEl) unitEl.value = p.unit;
    ["hoursMonth", "annualCommit", "margin", "otherAnnual"].forEach((k) => {
      const el = document.querySelector(`[data-param="${k}"]`);
      if (el && document.activeElement !== el) el.value = p[k];
    });

    // rename commit labels for onprem via small hints
    const commitLab = $("[data-i18n='params.commit']");
    if (commitLab) {
      commitLab.textContent = t(p.deployment === "onprem" ? "params.commitOnprem" : "params.commit", { unit: unit() });
    }
    const otherLab = $("[data-i18n='params.other']");
    if (otherLab) {
      otherLab.textContent = t(p.deployment === "onprem" ? "params.otherOnprem" : "params.other", { unit: unit() });
    }

    renderTiers();

    const fin = financeSummary();
    $("#out-surcharge").textContent = pct(fin.surcharge);
    $("#out-objetivo").textContent = money(fin.objetivo);
    $("#out-consumo").textContent = money(fin.consumo);
    $("#out-platform").textContent = money(fin.platformAnnual);
    $("#out-dedicated").textContent = money(fin.dedicatedAnnual);
    $("#out-base").textContent = money(fin.base);

    const thead = $("#env-head");
    const tierHeads = enabledTiers()
      .map((x) => `<th>${escapeAttr(x.label)} ${unit()}/h</th>`)
      .join("");
    thead.innerHTML = `<tr>
      <th>${t("env.th.code")}</th>
      <th>${t("env.th.label")}</th>
      <th>${t("env.th.surcharge")}</th>
      ${tierHeads}
      <th>${t("env.th.kibana")}</th>
      <th>${t("env.th.integrations")}</th>
      <th>${t("env.th.tiebreaker")}</th>
      <th>${t("env.th.snapshots")}</th>
      <th></th>
    </tr>`;

    const tbody = $("#env-body");
    tbody.innerHTML = state.environments
      .map((env, i) => {
        const rateCells = enabledTiers()
          .map(
            (tier) =>
              `<td><input data-ef-rate="${tier.code}" type="number" step="any" value="${env.rates[tier.code] ?? 0}"></td>`
          )
          .join("");
        return `<tr data-ei="${i}">
          <td><input data-ef="code" value="${escapeAttr(env.code)}"></td>
          <td><input data-ef="label" value="${escapeAttr(env.label || "")}"></td>
          <td style="text-align:center"><input data-ef="applySurcharge" type="checkbox" ${env.applySurcharge ? "checked" : ""}></td>
          ${rateCells}
          <td><input data-ef-plat="kibana" type="number" step="any" value="${env.platform.kibana}"></td>
          <td><input data-ef-plat="integrations" type="number" step="any" value="${env.platform.integrations}"></td>
          <td><input data-ef-plat="tiebreaker" type="number" step="any" value="${env.platform.tiebreaker}"></td>
          <td><input data-ef="snapshots" type="number" step="any" value="${env.snapshots}"></td>
          <td><button class="btn btn--danger btn--sm" data-env-del="${i}" type="button">✕</button></td>
        </tr>`;
      })
      .join("");

    const totals = clusterTotals();
    $("#env-usage").innerHTML = state.environments
      .map((env) => {
        const tot = totals[env.code] || EMPTY_GB();
        const lines = enabledTiers()
          .map((tier) => `<div>GB ${escapeAttr(tier.label)}: <strong>${num(tot[tier.code], 2)}</strong></div>`)
          .join("");
        return `<div class="env-usage-card">
          <strong>${escapeAttr(env.code)}</strong>
          <span class="hint">${escapeAttr(env.label || "")}</span>
          ${lines}
          <div class="hint">${env.applySurcharge ? t("env.roleSurcharge") : t("env.roleDedicated")}</div>
        </div>`;
      })
      .join("");

    // platform column visibility hint for onprem
    $$(".platform-cols-hint").forEach((el) => {
      el.textContent = t(p.deployment === "onprem" ? "env.platformOnprem" : "env.platformCloud");
    });
  }

  function filteredRows() {
    return state.rows.filter((r) => {
      if (state.filterEnv !== "ALL" && r.env !== state.filterEnv) return false;
      if (!state.search) return true;
      const q = state.search.toLowerCase();
      return String(r.family).toLowerCase().includes(q) || String(r.what || "").toLowerCase().includes(q);
    });
  }

  function envSelectOptions(selected) {
    const codes = envCodes();
    const all = new Set([...codes, selected].filter(Boolean));
    return [...all]
      .map((e) => {
        const known = codes.includes(e);
        return `<option value="${escapeAttr(e)}" ${e === selected ? "selected" : ""}>${escapeAttr(known ? e : e + " ⚠")}</option>`;
      })
      .join("");
  }

  function renderMeasurement() {
    const et = enabledTiers();
    const head = $("#meas-head");
    head.innerHTML = `<tr>
      <th>${t("meas.th.family")}</th>
      <th>${t("meas.th.env")}</th>
      <th>${t("meas.th.what")}</th>
      <th>${t("meas.th.eps15")}</th>
      <th>${t("meas.th.kbdoc")}</th>
      <th>${t("meas.th.docs")}</th>
      ${et.map((x) => `<th>GB ${escapeAttr(x.label)}</th>`).join("")}
      <th>${t("meas.th.idx")}</th>
      <th>${t("meas.th.epsLife")}</th>
      <th>${t("meas.th.age")}</th>
      <th></th>
    </tr>`;

    const rows = filteredRows();
    $("#meas-body").innerHTML = rows
      .map((r) => {
        const idx = state.rows.indexOf(r);
        const gbCells = et
          .map(
            (tier) =>
              `<td><input data-fgb="${tier.code}" type="number" step="any" value="${r.gb?.[tier.code] ?? 0}"></td>`
          )
          .join("");
        return `<tr data-idx="${idx}" class="${findEnv(r.env) ? "" : "row-warn"}">
          <td><input data-f="family" value="${escapeAttr(r.family)}"></td>
          <td><select data-f="env">${envSelectOptions(r.env)}</select></td>
          <td><input data-f="what" value="${escapeAttr(r.what || "")}"></td>
          <td><input data-f="eps15" type="number" step="any" value="${r.eps15}"></td>
          <td><input data-f="kbdoc" type="number" step="any" value="${r.kbdoc}"></td>
          <td><input data-f="docs" type="number" step="1" value="${r.docs}"></td>
          ${gbCells}
          <td><input data-f="indices" type="number" step="1" value="${r.indices}"></td>
          <td><input data-f="epsLife" type="number" step="any" value="${r.epsLife}"></td>
          <td><input data-f="ageDays" type="number" step="any" value="${r.ageDays}"></td>
          <td><button class="btn btn--danger btn--sm" data-del="${idx}">✕</button></td>
        </tr>`;
      })
      .join("");

    $("#meas-count").textContent = t("dyn.measCount", { shown: rows.length, total: state.rows.length });
    const filter = $("#filter-env");
    const cur = state.filterEnv;
    filter.innerHTML =
      `<option value="ALL">${t("meas.allEnvs")}</option>` +
      envCodes()
        .map((c) => `<option value="${escapeAttr(c)}" ${c === cur ? "selected" : ""}>${escapeAttr(c)}</option>`)
        .join("");
  }

  function renderAllocTable(target, withAdmin) {
    const et = enabledTiers();
    const rows = allocations(withAdmin);
    const sorted = [...rows].sort((a, b) => b.ecuMes - a.ecuMes);
    const total = sorted.reduce((a, r) => a + r.ecuMes, 0);
    const u = unit();
    $(target).innerHTML = `
      <div class="hint" style="margin-bottom:.6rem">
        ${t("dyn.surchargeApplied")} <strong>${withAdmin ? pct(computeSurcharge()) : "0%"}</strong>
        ${t("dyn.totalChargeback")} <strong>${money(total)} ${u}/${t("dyn.month")}</strong>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th>${t("meas.th.family")}</th><th>${t("meas.th.env")}</th>
          ${et.map((x) => `<th>GB ${escapeAttr(x.label)}</th><th>${t("dyn.share")} ${escapeAttr(x.label)}</th>`).join("")}
          <th>${u}/${t("dyn.month")} ${t("dyn.capacity")}</th>
          <th>${u}/${t("dyn.month")} ${t("dyn.snapshots")}</th>
          <th>${u}/${t("dyn.month")} Elastic</th>
          <th>${u}/${t("dyn.month")} ${t("dyn.surcharge")}</th>
          <th>${u}/${t("dyn.month")} ${t("dyn.total")}</th>
          <th>${u}/${t("dyn.year")}</th>
        </tr></thead>
        <tbody>
          ${sorted
            .map((r) => {
              const gbShare = et
                .map(
                  (x) =>
                    `<td class="num">${num(r.gb?.[x.code], 3)}</td><td class="num">${pct(r.shares?.[x.code] || 0)}</td>`
                )
                .join("");
              return `<tr class="${r.unknownEnv ? "row-warn" : ""}">
              <td>${escapeAttr(r.family)}</td>
              <td><span class="badge">${escapeAttr(r.env)}</span></td>
              ${gbShare}
              <td class="num">${money(r.ecuMesCap)}</td>
              <td class="num">${money(r.ecuMesSnap)}</td>
              <td class="num">${money(r.ecuMesElastic)}</td>
              <td class="num">${money(r.ecuMesRecargo)}</td>
              <td class="num money">${money(r.ecuMes)}</td>
              <td class="num money">${money(r.ecuYear)}</td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table></div>`;
  }

  function renderWorkload(kind) {
    const names = kind === "cloud" ? state.cloudFamilies : state.onpremFamilies;
    const box = $(`#${kind}-chips`);
    box.innerHTML =
      names
        .map(
          (n, i) =>
            `<span class="chip">${escapeAttr(n)} <button type="button" data-kind="${kind}" data-i="${i}">×</button></span>`
        )
        .join("") || `<span class="hint">${t("dyn.addFamiliesHint")}</span>`;
    const sum = sumFamilies(names, true);
    const gbLines = enabledTiers()
      .map((x) => `<div><span class="hint">GB ${escapeAttr(x.label)}</span><div><strong>${num(sum.gb[x.code], 2)}</strong></div></div>`)
      .join("");
    $(`#${kind}-gb`).innerHTML = gbLines;
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
      .map((f) => `<option value="${escapeAttr(f)}" ${f === state.anyFamily ? "selected" : ""}>${escapeAttr(f)}</option>`)
      .join("");
    const row = state.rows.find((r) => r.family === state.anyFamily);
    const steps = $("#any-steps");
    if (!row) {
      steps.innerHTML = `<p class="hint">${t("dyn.noFamily")}</p>`;
      return;
    }
    const totals = clusterTotals();
    const a = allocateRow(row, true, totals, computeSurcharge());
    const envObj = findEnv(row.env);
    const u = unit();
    const items = [];
    for (const tier of enabledTiers()) {
      const code = tier.code;
      items.push([`GB ${tier.label} (${t("dyn.family")})`, a.gb?.[code] || 0, t("step.fromMeas")]);
      items.push([`GB ${tier.label} (${row.env})`, totals[row.env]?.[code] || 0, t("step.sumEnv")]);
      items.push([`${t("dyn.share")} ${tier.label}`, a.shares?.[code] || 0, t("step.shareHot.h"), true]);
      items.push([`${tier.label} ${u}/h`, envObj?.rates?.[code] || 0, t("step.ecuHot.h")]);
    }
    items.push([t("step.hours"), state.params.hoursMonth, t("step.hours.h")]);
    items.push([`${u}/${t("dyn.month")} ${t("dyn.capacity")}`, a.ecuMesCap, t("step.cap.h")]);
    items.push([t("tier.snapVia"), a.snapTier, t("tier.snapVia.h")]);
    items.push([`${u}/${t("dyn.month")} ${t("dyn.snapshots")}`, a.ecuMesSnap, t("step.snap.h")]);
    items.push([`${u}/${t("dyn.month")} Elastic`, a.ecuMesElastic, t("step.elastic.h")]);
    items.push([t("step.sur"), computeSurcharge(), t("step.sur.h"), true]);
    items.push([
      `${u}/${t("dyn.month")} ${t("dyn.surcharge")}`,
      a.ecuMesRecargo,
      envObj?.applySurcharge ? t("step.surAmt.h") : t("step.surAmt.dedicated"),
    ]);
    items.push([`${u}/${t("dyn.month")} ${t("dyn.total")}`, a.ecuMes, t("step.total.h")]);
    items.push([`${u}/${t("dyn.year")}`, a.ecuYear, t("step.year.h")]);

    steps.innerHTML = items
      .map((it, i) => {
        const [label, value, hint, isPct] = it;
        return `<div class="step">
          <div class="step-n">${i + 1}</div>
          <div><strong>${escapeAttr(String(label))}</strong><span>${escapeAttr(String(hint))}</span></div>
          <em>${isPct ? pct(value) : typeof value === "number" && Math.abs(value) > 20 ? money(value) : typeof value === "number" ? num(value, 4) : escapeAttr(String(value))}</em>
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

  function ensureRatesForTiers() {
    for (const env of state.environments) {
      for (const code of tierCodes()) {
        if (env.rates[code] == null) env.rates[code] = 0;
      }
    }
    for (const row of state.rows) {
      for (const code of tierCodes()) {
        if (row.gb[code] == null) row.gb[code] = 0;
      }
    }
  }

  function bindEvents() {
    document.body.addEventListener("change", (e) => {
      const el = e.target;
      if (el.matches("#deployment-mode")) {
        state.params.deployment = el.value;
        if (el.value === "onprem" && state.params.unit === "ECU") state.params.unit = "EUR";
        if (el.value === "cloud" && state.params.unit === "EUR") state.params.unit = "ECU";
        renderAll();
        return;
      }
      if (el.matches("#snapshot-tier")) {
        state.params.snapshotAllocTier = el.value;
        renderAll();
        return;
      }
      if (el.matches("[data-param]")) {
        const k = el.dataset.param;
        state.params[k] = k === "unit" ? el.value : Number(el.value);
        renderAll();
        return;
      }
      if (el.matches("#filter-env")) {
        state.filterEnv = el.value;
        renderMeasurement();
        return;
      }
      if (el.matches("#any-family")) {
        state.anyFamily = el.value;
        renderAnyFamily();
        save();
        return;
      }
      if (el.matches("#cloud-add") && el.value) {
        state.cloudFamilies.push(el.value);
        el.value = "";
        renderWorkload("cloud");
        save();
        return;
      }
      if (el.matches("#onprem-add") && el.value) {
        state.onpremFamilies.push(el.value);
        el.value = "";
        renderWorkload("onprem");
        save();
        return;
      }

      const tierTr = el.closest("tr[data-ti]");
      if (tierTr && el.matches("[data-tf]")) {
        const i = Number(tierTr.dataset.ti);
        const f = el.dataset.tf;
        if (f === "enabled") {
          const enabledCount = state.tiers.filter((x) => x.enabled).length;
          if (!el.checked && enabledCount <= 1) {
            el.checked = true;
            toast(t("toast.tierMin"));
            return;
          }
          state.tiers[i].enabled = el.checked;
        } else if (f === "label") state.tiers[i].label = el.value;
        else if (f === "code") state.tiers[i].code = el.value.trim().toLowerCase();
        ensureRatesForTiers();
        renderAll();
        return;
      }

      const envTr = el.closest("tr[data-ei]");
      if (envTr) {
        const i = Number(envTr.dataset.ei);
        if (el.matches("[data-ef]")) {
          const f = el.dataset.ef;
          if (f === "applySurcharge") state.environments[i].applySurcharge = el.checked;
          else if (f === "code") {
            const old = state.environments[i].code;
            state.environments[i].code = el.value.trim();
            renameEnvInRows(old, state.environments[i].code);
          } else if (f === "label") state.environments[i].label = el.value;
          else if (f === "snapshots") state.environments[i].snapshots = Number(el.value);
        } else if (el.matches("[data-ef-rate]")) {
          state.environments[i].rates[el.dataset.efRate] = Number(el.value);
        } else if (el.matches("[data-ef-plat]")) {
          state.environments[i].platform[el.dataset.efPlat] = Number(el.value);
        }
        renderAll();
        return;
      }

      const tr = el.closest("tr[data-idx]");
      if (tr) {
        const idx = Number(tr.dataset.idx);
        if (el.matches("[data-f]")) {
          const f = el.dataset.f;
          let v = el.value;
          if (!["family", "what", "env"].includes(f)) v = Number(v);
          state.rows[idx][f] = v;
        } else if (el.matches("[data-fgb]")) {
          state.rows[idx].gb[el.dataset.fgb] = Number(el.value);
        }
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
      const rates = EMPTY_RATES();
      rates.hot = 1;
      state.environments.push({
        code,
        label: t("env.newLabel"),
        applySurcharge: true,
        rates,
        platform: EMPTY_PLATFORM(),
        snapshots: 0,
      });
      renderAll();
      toast(t("toast.envAdded", { code }));
      $(".tab[data-tab='parameters']").click();
    });

    $("#btn-add-tier").addEventListener("click", () => {
      let n = 1;
      let code = `tier${n}`;
      while (tierCodes().includes(code)) {
        n += 1;
        code = `tier${n}`;
      }
      state.tiers.push({ code, label: t("tier.newLabel"), enabled: true });
      ensureRatesForTiers();
      renderAll();
      toast(t("toast.tierAdded", { code }));
    });

    $("#btn-add-row").addEventListener("click", () => {
      const first = envCodes()[0] || "ENV1";
      state.rows.unshift(
        normalizeRow({
          family: "new-family",
          env: first,
          gb: { hot: 1, warm: 0, cold: 0, frozen: 0 },
        })
      );
      renderAll();
      toast(t("toast.added"));
      $(".tab[data-tab='measurement']").click();
    });

    $("#btn-reset-sample").addEventListener("click", () => {
      if (!confirm(t("toast.resetConfirm"))) return;
      state.params = structuredClone(DEFAULT_PARAMS);
      state.tiers = structuredClone(DEFAULT_TIERS);
      state.environments = structuredClone(DEFAULT_ENVIRONMENTS);
      state.rows = (window.DK_SEED_MEASUREMENT || []).map(normalizeRow);
      state.cloudFamilies = [...SAMPLE_CLOUD];
      state.onpremFamilies = [...SAMPLE_ONPREM];
      renderAll();
      toast(t("toast.reset"));
    });

    $("#btn-export-csv").addEventListener("click", () => {
      const et = enabledTiers();
      const header = ["family", "env", "what", "eps15", "kbdoc", "docs", ...et.map((x) => `gb_${x.code}`), "indices", "epsLife", "ageDays"];
      const lines = [header.join(",")].concat(
        state.rows.map((r) => {
          const vals = [r.family, r.env, r.what, r.eps15, r.kbdoc, r.docs, ...et.map((x) => r.gb[x.code] || 0), r.indices, r.epsLife, r.ageDays];
          return vals
            .map((v) => {
              const s = String(v ?? "").replaceAll('"', '""');
              return /[",\n]/.test(s) ? `"${s}"` : s;
            })
            .join(",");
        })
      );
      download("measurement.csv", lines.join("\n"), "text/csv");
      toast(t("toast.csvOut"));
    });

    $("#btn-export-envs").addEventListener("click", () => {
      const et = enabledTiers();
      const header = ["code", "label", "applySurcharge", ...et.map((x) => `rate_${x.code}`), "kibana", "integrations", "tiebreaker", "snapshots"];
      const lines = [header.join(",")].concat(
        state.environments.map((e) =>
          [
            e.code,
            e.label,
            e.applySurcharge ? "TRUE" : "FALSE",
            ...et.map((x) => e.rates[x.code] || 0),
            e.platform.kibana,
            e.platform.integrations,
            e.platform.tiebreaker,
            e.snapshots,
          ].join(",")
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
      const known = new Set(envCodes());
      for (const r of parsed) {
        if (r.env && !known.has(r.env)) {
          state.environments.push({
            code: r.env,
            label: r.env,
            applySurcharge: true,
            rates: { ...EMPTY_RATES(), hot: 1 },
            platform: EMPTY_PLATFORM(),
            snapshots: 0,
          });
          known.add(r.env);
        }
      }
      // auto-enable tiers that have data
      for (const tier of state.tiers) {
        if (!tier.enabled && parsed.some((r) => (r.gb?.[tier.code] || 0) > 0)) tier.enabled = true;
      }
      renderAll();
      toast(t("toast.csvIn", { n: parsed.length }));
      e.target.value = "";
    });

    $("#btn-export-alloc").addEventListener("click", () => {
      const et = enabledTiers();
      const rows = allocations(true);
      const header = ["family", "env", ...et.map((x) => `gb_${x.code}`), ...et.map((x) => `share_${x.code}`), "ecuMesCap", "ecuMesSnap", "ecuMesElastic", "ecuMesRecargo", "ecuMes", "ecuYear"];
      const lines = [header.join(",")].concat(
        rows.map((r) =>
          [
            r.family,
            r.env,
            ...et.map((x) => r.gb?.[x.code] || 0),
            ...et.map((x) => r.shares?.[x.code] || 0),
            r.ecuMesCap,
            r.ecuMesSnap,
            r.ecuMesElastic,
            r.ecuMesRecargo,
            r.ecuMes,
            r.ecuYear,
          ].join(",")
        )
      );
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
        const gb = EMPTY_GB();
        gb.hot = Number(obj.gb_hot || obj.gbHot || obj["GB hot"] || 0);
        gb.warm = Number(obj.gb_warm || obj.gbWarm || obj["GB warm"] || 0);
        gb.cold = Number(obj.gb_cold || obj.gbCold || obj["GB cold"] || 0);
        gb.frozen = Number(obj.gb_frozen || obj.gbFrozen || obj["GB frozen"] || 0);
        return normalizeRow({
          family: obj.family || obj.Familia || "",
          env: obj.env || obj.Entorno || envCodes()[0] || "ENV1",
          what: obj.what || "",
          eps15: Number(obj.eps15 || 0),
          kbdoc: Number(obj.kbdoc || 0),
          docs: Number(obj.docs || 0),
          indices: Number(obj.indices || 0),
          epsLife: Number(obj.epsLife || 0),
          ageDays: Number(obj.ageDays || 0),
          gb,
        });
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
