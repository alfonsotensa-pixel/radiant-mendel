/* Elemental Club · Monitoreo de gasto mensual (presupuesto Drive vs. gasto Supabase) */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG;
  const BUDGET = window.BUDGET;
  const T = CFG.thresholds;
  const COL = CFG.columns;

  const fmt0 = new Intl.NumberFormat(CFG.locale, { style: "currency", currency: CFG.currency, maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat(CFG.locale, { style: "currency", currency: CFG.currency, minimumFractionDigits: 2 });
  const fmtC = new Intl.NumberFormat(CFG.locale, { style: "currency", currency: CFG.currency, notation: "compact", maximumFractionDigits: 1 });
  const pct = (v) => (isFinite(v) ? `${(v * 100).toFixed(v < 0.1 && v > 0 ? 1 : 0)}%` : "—");
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const STATUS = {
    green: { label: "En control", cls: "green" },
    amber: { label: "En riesgo", cls: "amber" },
    red: { label: "Excedido", cls: "red" },
    redTrend: { label: "Tendencia a exceder", cls: "red" },
    grey: { label: "Sin movimientos", cls: "grey" },
    unbudgeted: { label: "Sin presupuesto", cls: "amber" },
    paid: { label: "Pagado", cls: "green" },
    pending: { label: "Pendiente", cls: "grey" },
    nearLimit: { label: "Cerca del límite", cls: "amber" },
    notPaid: { label: "Sin pago registrado", cls: "amber" },
  };

  let supa = null;
  let mode = "demo";
  let transactions = [];
  let newIds = new Set();
  let barChart, lineChart;

  /* ---------------- Mes seleccionado (por defecto, el actual) ---------------- */
  const today0 = new Date();
  const CURRENT = { y: today0.getFullYear(), m: today0.getMonth() };
  let selected = { ...CURRENT };
  const monthKey = (s) => s.y * 12 + s.m;
  const isCurrent = () => monthKey(selected) === monthKey(CURRENT);
  const HISTORY_MONTHS = 24; // meses anteriores disponibles en el selector
  // Enlace directo: index.html#mes=2026-10 abre ese mes
  {
    const h = location.hash.match(/mes=(\d{4})-(\d{1,2})/);
    if (h) {
      const s = { y: +h[1], m: +h[2] - 1 };
      const k = monthKey(s);
      if (k <= monthKey(CURRENT) && k >= monthKey(CURRENT) - HISTORY_MONTHS) selected = s;
    }
  }

  /* ---------------- Fechas del periodo ---------------- */
  function period() {
    const now = new Date();
    const { y, m } = selected;
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 1);
    const dim = new Date(y, m + 1, 0).getDate();
    const closed = !isCurrent();
    // Un mes anterior se evalúa completo (resultado final); el actual, al día de hoy.
    const day = closed ? dim : now.getDate();
    return { now, y, m, start, end, dim, day, closed, frac: day / dim, daysLeft: dim - day };
  }
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function parseDate(v) {
    if (v instanceof Date) return v;
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  }

  /* ---------------- Clasificación de categorías ---------------- */
  const allBuckets = [...BUDGET.categories, ...BUDGET.nonOperating.map((n) => ({ ...n, nonOp: true }))];
  function classify(rawCat) {
    const c = norm(rawCat);
    for (const b of allBuckets) if (b.match.some((k) => norm(k) === c)) return b;
    for (const b of allBuckets) if (b.match.some((k) => c.includes(norm(k)))) return b;
    return null;
  }

  /* ---------------- Cálculo y semáforo ---------------- */
  function compute() {
    const P = period();
    const unmapped = {};
    const sums = Object.fromEntries(allBuckets.map((b) => [b.id, 0]));
    const txByBucket = Object.fromEntries(allBuckets.map((b) => [b.id, []]));
    const dailyOp = new Array(P.dim + 1).fill(0);

    for (const t of transactions) {
      let b = classify(t.category);
      if (!b) {
        unmapped[t.category || "(vacía)"] = (unmapped[t.category || "(vacía)"] || 0) + t.amount;
        b = BUDGET.categories.find((c) => c.id === "general");
      }
      sums[b.id] += t.amount;
      txByBucket[b.id].push(t);
      if (!b.nonOp) {
        const d = t.date.getDate();
        if (d >= 1 && d <= P.dim) dailyOp[d] += t.amount;
      }
    }

    const cats = BUDGET.categories.map((c) => {
      const spent = sums[c.id];
      const budget = c.budget;
      const expected = c.pace === "fixed" ? Math.min(spent, budget) : budget * P.frac;
      // Proyección: combina el ritmo real (spent / avance) con el supuesto de que el resto
      // del mes se gaste al ritmo presupuestado. El peso del ritmo real crece con el avance
      // del mes, lo que evita falsas alarmas por pagos grandes al inicio.
      let projection;
      if (P.closed) projection = spent; // mes cerrado: el resultado es el gasto real
      else if (c.pace === "fixed") projection = Math.max(spent, budget);
      else {
        const runRate = spent / P.frac;
        const onBudget = spent + budget * (1 - P.frac);
        const w = P.day < T.minDaysForProjection ? 0 : P.frac;
        projection = w * runRate + (1 - w) * onBudget;
      }

      const rSpent = budget ? spent / budget : (spent > 0 ? Infinity : 0);
      const rProj = budget ? projection / budget : (projection > 0 ? Infinity : 0);
      let status;
      if (!budget) status = spent > 0 ? "unbudgeted" : "grey";
      else if (c.pace === "fixed") status = spent > budget * 1.001 ? "red" : spent >= budget * 0.999 ? "paid" : "pending";
      else if (rSpent >= T.spentRed) status = "red";
      else if (rProj >= T.projectionRed) status = "redTrend";
      else if (rProj >= T.projectionAmber || (rSpent >= T.spentAmber && P.daysLeft > T.minDaysLeft)) status = "amber";
      else if (spent === 0) status = "grey";
      else status = "green";
      if (P.closed && status === "amber") status = "nearLimit";
      if (P.closed && status === "pending") status = "notPaid";

      const level = STATUS[status].cls; // green | amber | red | grey
      return { ...c, spent, expected, projection, rSpent, rProj, status, level, tx: txByBucket[c.id] };
    });

    const budgetTotal = BUDGET.categories.reduce((a, c) => a + c.budget, 0);
    const expectedTotal = cats.reduce((a, c) => a + c.expected, 0);
    const fixedBudget = cats.filter((c) => c.pace === "fixed").reduce((a, c) => a + c.budget, 0);
    const spentTotal = cats.reduce((a, c) => a + c.spent, 0);
    const projTotal = cats.reduce((a, c) => a + c.projection, 0);
    const nonOp = BUDGET.nonOperating.map((n) => ({ ...n, spent: sums[n.id], count: txByBucket[n.id].length }));

    return { P, cats, budgetTotal, expectedTotal, fixedBudget, spentTotal, projTotal, nonOp, unmapped, dailyOp };
  }

  /* ---------------- Render ---------------- */
  function render() {
    const R = compute();
    const { P } = R;
    const monthName = P.start.toLocaleDateString(CFG.locale, { month: "long", year: "numeric" });

    $("monthTitle").textContent = `Gasto mensual · ${monthName.charAt(0).toUpperCase()}${monthName.slice(1)}`;
    $("periodText").textContent = P.closed
      ? "Mes cerrado · resultado final contra el presupuesto operativo"
      : `Día ${P.day} de ${P.dim} · ${P.daysLeft} días restantes`;
    document.body.classList.toggle("is-history", P.closed);
    syncMonthControls();

    // Marcador: gasto global del mes vs. presupuesto mensual
    const totalLevel = levelFor(R.projTotal / R.budgetTotal, R.spentTotal / R.budgetTotal);
    const rSpent = R.spentTotal / R.budgetTotal;
    const spentLevel = P.closed ? levelFor(rSpent, rSpent) : totalLevel;
    const heroLabels = P.closed
      ? { green: "Cerró dentro del presupuesto", amber: "Cerró cerca del límite", red: "Cerró excedido" }
      : { green: "En control", amber: "En riesgo", red: rSpent >= 1 ? "Presupuesto excedido" : "Tendencia a exceder" };
    $("heroStatus").className = `pill pill--${spentLevel}`;
    $("heroStatus").textContent = heroLabels[spentLevel];
    $("heroPct").textContent = pct(rSpent);
    $("heroPct").className = `t-${spentLevel}`;
    $("ringFill").setAttribute("stroke-dasharray", `${Math.min(rSpent, 1) * 100} 100`);
    $("ringFill").setAttribute("class", `ring__fill ring__fill--${spentLevel}`);
    $("ringMark").setAttribute("transform", `rotate(${Math.min(R.expectedTotal / R.budgetTotal, 1) * 360} 60 60)`);
    $("ringMark").style.display = P.closed ? "none" : "";
    $("kpiSpent").textContent = fmt0.format(R.spentTotal);
    $("kpiBudget").textContent = fmt0.format(R.budgetTotal);
    $("spendBar").style.width = `${Math.min(rSpent, 1) * 100}%`;
    $("spendBar").className = `track__fill track__fill--${spentLevel}`;
    $("spendMark").style.left = `${(R.expectedTotal / R.budgetTotal) * 100}%`;
    $("spendMark").style.display = P.closed ? "none" : "";
    $("spendPct").textContent = pct(rSpent);
    $("monthPct").textContent = P.closed ? "Cerrado" : pct(P.frac);
    $("monthBar").style.width = `${P.frac * 100}%`;
    $("periodLabel").textContent = P.closed ? "Mes" : "Avance del mes";

    const vsExpected = R.spentTotal - R.expectedTotal;
    $("kpiExpLabel").textContent = P.closed ? "Vs. presupuesto" : "Esperado a hoy";
    $("kpiExp").textContent = P.closed ? `${vsExpected > 0 ? "+" : "−"}${fmt0.format(Math.abs(vsExpected))}` : fmt0.format(R.expectedTotal);
    $("kpiExp").className = `hstat__v ${P.closed ? (vsExpected > 0 ? "t-red" : "t-green") : ""}`;
    $("kpiSpentFoot").innerHTML = P.closed
      ? `<span class="muted">${vsExpected > 0 ? "Por encima" : "Por debajo"} del presupuesto</span>`
      : `<span class="${vsExpected > 0 ? "t-red" : "t-green"}">${vsExpected > 0 ? "+" : "−"}${fmt0.format(Math.abs(vsExpected))} ${vsExpected > 0 ? "arriba" : "abajo"} de lo esperado</span>`;
    $("kpiProjLabel").textContent = P.closed ? "Resultado del cierre" : "Proyección al cierre";
    $("kpiProj").textContent = fmt0.format(R.projTotal);
    $("kpiProj").className = `hstat__v t-${totalLevel}`;
    const diff = R.projTotal - R.budgetTotal;
    $("kpiProjFoot").innerHTML = `<span class="t-${totalLevel}">${pct(R.projTotal / R.budgetTotal)} · ${diff > 0 ? "exceso" : "ahorro"} ${P.closed ? "real" : "estimado"} ${fmt0.format(Math.abs(diff))}</span>`;
    const avail = R.budgetTotal - R.spentTotal;
    $("kpiAvailLabel").textContent = P.closed ? (avail < 0 ? "Sobregiro" : "Remanente") : "Disponible";
    $("kpiAvail").textContent = fmt0.format(avail);
    $("kpiAvail").className = `hstat__v ${avail < 0 ? "t-red" : ""}`;
    $("kpiAvailFoot").textContent = P.daysLeft > 0 ? `≈ ${fmt0.format(Math.max(avail, 0) / P.daysLeft)} por día restante` : avail < 0 ? "Por encima del presupuesto" : "Presupuesto no ejercido";
    const nonOpTotal = R.nonOp.reduce((a, n) => a + n.spent, 0);
    $("kpiTotal").textContent = fmt0.format(R.spentTotal + nonOpTotal);
    $("kpiTotalFoot").textContent = `Incluye ${fmt0.format(nonOpTotal)} no operativos`;

    // Contadores del semáforo
    const budgeted = R.cats.filter((c) => c.budget > 0 || c.spent > 0);
    $("cntGreen").textContent = budgeted.filter((c) => c.level === "green" || c.level === "grey").length;
    $("cntAmber").textContent = budgeted.filter((c) => c.level === "amber").length;
    $("cntRed").textContent = budgeted.filter((c) => c.level === "red").length;

    renderCategories(R);
    renderAlerts(R);
    renderCharts(R);
    renderNonOp(R);
    lastR = R;
    if (dlg.open) renderDetail(R);
    else if (pendingDetail) { openDetail(pendingDetail); pendingDetail = null; }
    renderTx();

    $("sources").textContent = `Fuentes: Presupuesto → ${BUDGET.source}. Gasto real → ${mode === "demo" ? "datos simulados (modo demo)" : `Supabase, tabla "${CFG.table}"`}.`;
    $("lastUpdate").textContent = `Actualizado ${new Date().toLocaleTimeString(CFG.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  }

  function levelFor(rProj, rSpent) {
    if (rSpent >= T.spentRed || rProj >= T.projectionRed) return "red";
    if (rProj >= T.projectionAmber) return "amber";
    return "green";
  }

  function renderCategories(R) {
    const { P } = R;
    const rows = R.cats
      .filter((c) => c.budget > 0 || c.spent > 0)
      .sort((a, b) => rank(b) - rank(a) || b.budget - a.budget);

    $("catTable").innerHTML = rows.map((c) => {
      const s = STATUS[c.status];
      const barPct = c.budget ? Math.min(c.rSpent, 1) * 100 : (c.spent > 0 ? 100 : 0);
      const markPct = c.pace === "fixed" || !c.budget || P.closed ? null : P.frac * 100;
      const projTxt = c.budget ? `${pct(c.rProj)} del ppto.` : "—";
      return `
        <div class="cat-row" role="button" tabindex="0" data-id="${c.id}" aria-haspopup="dialog" aria-label="Ver desglose de ${esc(c.name)}">
          <span class="dot dot--${c.level}" title="${s.label}"></span>
          <div>
            <div class="cat-row__name">${esc(c.name)}</div>
            <div class="cat-row__sub">${fmt0.format(c.spent)} de ${fmt0.format(c.budget)}</div>
          </div>
          <div class="cat-row__bar">
            <div class="cat-row__pct"><span>${c.budget ? pct(c.rSpent) + " consumido" : "Fuera de presupuesto"}</span><span>${c.budget ? "Disp. " + fmt0.format(c.budget - c.spent) : ""}</span></div>
            <div class="track">
              <div class="track__fill track__fill--${c.level === "grey" ? "neutral" : c.level}" style="width:${barPct}%"></div>
              ${markPct !== null ? `<span class="track__mark" style="left:${markPct}%" title="Esperado a hoy: ${fmt0.format(c.expected)}"></span>` : ""}
            </div>
          </div>
          <div class="cat-row__proj"><span class="muted small">${P.closed ? "Cierre" : "Proyección"}</span><strong class="t-${c.level === "grey" ? "" : c.level}">${fmt0.format(c.projection)}</strong><span class="muted small">${projTxt}</span></div>
          <span class="pill pill--${s.cls}">${s.label}</span>
        </div>`;
    }).join("");
  }
  const rank = (c) => ({ red: 3, amber: 2, green: 1, grey: 0 }[c.level]);

  function alertFor(c, P) {
    const daily = P.daysLeft > 0 ? Math.max(c.budget - c.spent, 0) / P.daysLeft : 0;
    if (c.status === "red") return { lvl: "red", title: `${c.name}: ${P.closed ? "cerró excedido" : "presupuesto excedido"}`, msg: `Gastado ${fmt0.format(c.spent)} (${pct(c.rSpent)}) de ${fmt0.format(c.budget)}. Sobregiro de ${fmt0.format(c.spent - c.budget)}.` };
    if (c.status === "nearLimit") return { lvl: "amber", title: `${c.name}: cerró cerca del límite`, msg: `Gastado ${fmt0.format(c.spent)} (${pct(c.rSpent)}) de ${fmt0.format(c.budget)}. Margen de ${fmt0.format(c.budget - c.spent)}.` };
    if (c.status === "notPaid") return { lvl: "amber", title: `${c.name}: sin pago registrado`, msg: `No se registró el pago de ${fmt0.format(c.budget)} en este mes.` };
    if (c.status === "redTrend") return { lvl: "red", title: `${c.name}: tendencia a exceder`, msg: `Proyección al cierre ${fmt0.format(c.projection)} (${pct(c.rProj)}), ${fmt0.format(c.projection - c.budget)} por encima. Ritmo diario ${fmt0.format(c.spent / P.day)} vs. ${fmt0.format(c.budget / P.dim)} presupuestado.` };
    if (c.status === "amber") return { lvl: "amber", title: `${c.name}: en riesgo`, msg: `Proyección ${fmt0.format(c.projection)} (${pct(c.rProj)}). Para cerrar en presupuesto, gasto máximo de ${fmt0.format(daily)}/día en los ${P.daysLeft} días restantes.` };
    if (c.status === "unbudgeted") return { lvl: "amber", title: `${c.name}`, msg: `${fmt0.format(c.spent)} en gastos sin rubro presupuestado. Revisar clasificación.` };
    if (c.status === "pending" && P.daysLeft <= 5) return { lvl: "amber", title: `${c.name}: pago pendiente`, msg: `Aún no se registra el pago de ${fmt0.format(c.budget)}.` };
    return null;
  }

  function renderAlerts(R) {
    const { P } = R;
    const items = R.cats.map((c) => { const a = alertFor(c, P); return a && { ...a, id: c.id }; }).filter(Boolean);
    const unm = Object.keys(R.unmapped);
    if (unm.length) items.push({ lvl: "amber", title: "Categorías sin mapear", msg: `${unm.map(esc).join(", ")} se sumaron a Gastos Generales. Agrégalas en js/budget.js.` });

    items.sort((a, b) => (a.lvl === "red" ? 0 : 1) - (b.lvl === "red" ? 0 : 1));
    $("alertCount").textContent = items.length ? `${items.length} activas` : "";
    $("alerts").innerHTML = items.length
      ? items.map((a) => `<li class="alert alert--${a.lvl}${a.id ? " alert--link" : ""}" ${a.id ? `data-id="${a.id}" role="button" tabindex="0" aria-haspopup="dialog"` : ""}><span class="dot dot--${a.lvl}"></span><div><div class="alert__title">${esc(a.title)}</div><div class="alert__msg">${a.msg}</div></div></li>`).join("")
      : `<li class="alert alert--ok"><span class="dot dot--green"></span><div><div class="alert__title">Todo en orden</div><div class="alert__msg">${P.closed ? "Todas las categorías cerraron dentro de su presupuesto." : "Todas las categorías avanzan dentro de su presupuesto."}</div></div></li>`;
  }

  function renderCharts(R) {
    if (!window.Chart) return;
    const css = getComputedStyle(document.documentElement);
    const color = (n) => css.getPropertyValue(n).trim();
    const lvlColor = { green: color("--green"), amber: color("--amber"), red: color("--red"), grey: "#94a3b8" };
    const cats = R.cats.filter((c) => c.budget > 0 || c.spent > 0);
    const SHORT = { nomina: "Nómina", renta: "Renta", servicios: "Servicios", consumibles: "Consumibles", digitales: "Digitales", comisiones: "Comisiones", mantenimiento: "Mantenimiento" };
    const shortName = (c) => SHORT[c.id] || c.name.replace(/ \(.*\)/, "").replace(/ y .*/, "");

    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.color = color("--muted");
    const money = (v) => fmt0.format(v);

    // Se grafica como % del presupuesto para que categorías chicas y grandes sean comparables.
    const bc = cats.filter((c) => c.budget > 0);
    const barData = {
      labels: bc.map((c) => shortName(c)),
      datasets: [
        { label: "Gastado", data: bc.map((c) => +(c.rSpent * 100).toFixed(1)), backgroundColor: color("--navy-2"), borderRadius: 4, _abs: bc.map((c) => c.spent) },
        { label: R.P.closed ? "Cierre del mes" : "Proyección al cierre", data: bc.map((c) => +(c.rProj * 100).toFixed(1)), backgroundColor: bc.map((c) => lvlColor[c.level] + "66"), borderColor: bc.map((c) => lvlColor[c.level]), borderWidth: 1.5, borderRadius: 4, _abs: bc.map((c) => c.projection) },
      ],
    };
    const limitLine = {
      id: "limitLine",
      afterDatasetsDraw(chart) {
        const x = chart.scales.x.getPixelForValue(100);
        const { top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        ctx.save();
        ctx.strokeStyle = color("--red"); ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        ctx.fillStyle = color("--red"); ctx.font = "600 11px Inter, sans-serif"; ctx.textAlign = "center";
        ctx.fillText("100 % presupuesto", x, top - 4);
        ctx.restore();
      },
    };
    if (barChart) { barChart.data = barData; barChart.update(); }
    else {
      barChart = new Chart($("barChart"), {
        type: "bar", data: barData, plugins: [limitLine],
        options: {
          maintainAspectRatio: false, indexAxis: "y", layout: { padding: { top: 14 } },
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } },
            tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw}% · ${money(ctx.dataset._abs[ctx.dataIndex])}` } },
          },
          scales: {
            x: { suggestedMax: 120, min: 0, ticks: { callback: (v) => `${v}%` }, grid: { color: "#eef2f7" } },
            y: { grid: { display: false } },
          },
        },
      });
    }

    const { P } = R;
    const labels = Array.from({ length: P.dim }, (_, i) => i + 1);
    let acc = 0;
    const actual = labels.map((d) => (d <= P.day ? (acc += R.dailyOp[d]) : null));
    const ideal = labels.map((d) => R.fixedBudget + (R.budgetTotal - R.fixedBudget) * (d / P.dim));
    const proj = labels.map((d) => (d < P.day ? null : d === P.day ? acc : acc + (R.projTotal - acc) * ((d - P.day) / Math.max(P.dim - P.day, 1))));
    const projLevel = levelFor(R.projTotal / R.budgetTotal, R.spentTotal / R.budgetTotal);
    const lineData = {
      labels,
      datasets: [
        { label: "Presupuesto lineal", data: ideal, borderColor: "#94a3b8", borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5 },
        { label: "Gasto real", data: actual, borderColor: color("--navy-2"), backgroundColor: "rgba(44,82,130,.08)", fill: true, pointRadius: 0, borderWidth: 2.5, tension: 0.2 },
        { label: "Proyección", data: proj, borderColor: lvlColor[projLevel], borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
      ],
    };
    if (lineChart) { lineChart.data = lineData; lineChart.update(); }
    else {
      lineChart = new Chart($("lineChart"), {
        type: "line", data: lineData,
        options: {
          maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
          plugins: { legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { title: (i) => `Día ${i[0].label}`, label: (ctx) => (ctx.raw == null ? null : `${ctx.dataset.label}: ${money(ctx.raw)}`) } } },
          scales: { y: { beginAtZero: true, ticks: { callback: (v) => fmtC.format(v) }, grid: { color: "#eef2f7" } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } },
        },
      });
    }
  }

  function renderNonOp(R) {
    $("nonOp").innerHTML = R.nonOp.map((n) => `
      <div class="nonop__item"><div><div><strong>${esc(n.name)}</strong></div><div class="muted small">${n.count} operaciones</div></div><strong>${fmt0.format(n.spent)}</strong></div>`).join("");
    const unm = Object.entries(R.unmapped);
    $("unmapped").innerHTML = unm.length ? `⚠ Categorías no reconocidas: ${unm.map(([k, v]) => `${esc(k)} (${fmt0.format(v)})`).join(", ")}` : "";
  }

  function renderTx() {
    const list = transactions.slice().sort((a, b) => b.date - a.date || (b.seq || 0) - (a.seq || 0)).slice(0, 25);
    $("txCount").textContent = `${transactions.length} registros en el mes`;
    $("txBody").innerHTML = list.map((t) => `
      <tr class="${newIds.has(t.id) ? "new" : ""}">
        <td>${t.date.toLocaleDateString(CFG.locale, { day: "2-digit", month: "short" })}</td>
        <td>${esc(t.category)}</td>
        <td>${esc(t.concept || "—")}</td>
        <td class="muted">${esc(t.wallet || "—")}</td>
        <td class="num">${fmt2.format(t.amount)}</td>
      </tr>`).join("") || `<tr><td colspan="5" class="muted">Sin movimientos registrados este mes.</td></tr>`;
    newIds = new Set();
  }

  /* ---------------- Fuente de datos: Supabase ---------------- */
  function mapRow(r) {
    return {
      id: r.id ?? `${r[COL.date]}-${r[COL.amount]}-${Math.random()}`,
      date: parseDate(r[COL.date]),
      amount: Math.abs(Number(r[COL.amount]) || 0),
      category: r[COL.category] ?? "",
      concept: COL.concept ? r[COL.concept] : "",
      wallet: COL.wallet ? r[COL.wallet] : "",
    };
  }

  async function loadSupabase() {
    const P = period();
    const key = monthKey(selected);
    // PostgREST limita las filas por respuesta (1000 por defecto): se pagina.
    const data = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supa
        .from(CFG.table)
        .select("*")
        .gte(COL.date, isoDate(P.start))
        .lt(COL.date, isoDate(P.end))
        .order(COL.date, { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      data.push(...page);
      if (page.length < PAGE) break;
    }
    if (key !== monthKey(selected)) return; // el usuario cambió de mes mientras cargaba
    const before = new Set(transactions.map((t) => t.id));
    transactions = data.map(mapRow);
    if (before.size) transactions.forEach((t) => { if (!before.has(t.id)) newIds.add(t.id); });
  }

  let debounce;
  function scheduleReload() {
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 600);
  }

  async function refresh() {
    try {
      if (mode === "live") await loadSupabase();
      render();
      if (mode === "live" && $("liveBadge").classList.contains("badge--error")) setBadge("idle", "Conectado");
    } catch (e) {
      console.error(e);
      setBadge("error", "Error de conexión");
      $("lastUpdate").textContent = e.message || String(e);
    }
  }

  function setBadge(kind, text) {
    $("liveBadge").className = `badge badge--${kind}`;
    $("liveText").textContent = text;
  }

  function startLive(conn) {
    supa = window.supabase.createClient(conn.url, conn.key);
    mode = "live";
    supa
      .channel("gastos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: CFG.table }, scheduleReload)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setBadge("live", "En vivo");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setBadge("demo", `Conectado · se actualiza cada ${Math.round(CFG.pollIntervalMs / 1000)} s`);
      });
    setInterval(refresh, CFG.pollIntervalMs);
    refresh();
  }

  /* ---------------- Modo demo ---------------- */
  const demoCache = new Map();
  let demoSeq = 0;

  function demoMonth(sel) {
    const key = monthKey(sel);
    if (demoCache.has(key)) return demoCache.get(key);
    let seed = 20260000 + key * 7919;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const dim = new Date(sel.y, sel.m + 1, 0).getDate();
    const isCur = key === monthKey(CURRENT);
    const lastDay = isCur ? new Date().getDate() : dim;
    const wallets = ["alfonso mercado", "Caja chica", "Tensa", "Resguardo"];
    // El mes actual tiene un patrón fijo; los meses anteriores varían por mes.
    const pace = isCur
      ? { nomina: 0.97, servicios: 0.8, consumibles: 1.55, digitales: 0.9, comisiones: 0.92, mantenimiento: 0.55 }
      : Object.fromEntries(["nomina", "servicios", "consumibles", "digitales", "comisiones", "mantenimiento"].map((k) => [k, 0.75 + rnd() * 0.45]));
    const catName = { nomina: "Nomina", servicios: "Servicios", consumibles: "consumibles", digitales: "Marketing/Ventas", comisiones: "Comisiones", mantenimiento: "Mantenimiento" };
    const list = [];
    const push = (day, cat, concept, amount, wallet) =>
      list.push({ id: `d${++demoSeq}`, seq: demoSeq, date: new Date(sel.y, sel.m, day), category: cat, concept, amount: Math.round(amount * 100) / 100, wallet: wallet || wallets[Math.floor(rnd() * 2)] });

    push(1, "Renta", "Renta de Inmueble", 150000, "Tensa");
    push(2, "Marketing/Ventas", "App Trainingym", 9500, "alfonso mercado");
    for (let d = 1; d <= lastDay; d++) {
      for (const [id, k] of Object.entries(pace)) {
        const c = BUDGET.categories.find((x) => x.id === id);
        const base = id === "digitales" ? c.budget - 9500 : c.budget;
        const daily = (base / dim) * k * (0.6 + rnd() * 0.8);
        const n = 1 + Math.floor(rnd() * 2);
        for (let i = 0; i < n; i++) push(d, catName[id], c.concepts[Math.floor(rnd() * c.concepts.length)][0], daily / n);
      }
      if (rnd() < 0.4) push(d, "General", "Gastos varios", 150 + rnd() * 350, "Caja chica");
      if (rnd() < 0.5) push(d, "Utilidades", "Retiro socio", 500 + rnd() * 1500);
      if (rnd() < 0.2) push(d, "inversion", "Equipamiento", 2000 + rnd() * 6000);
    }
    demoCache.set(key, list);
    return list;
  }

  function startDemo() {
    mode = "demo";
    setBadge("demo", "Modo demo · datos simulados");
    transactions = demoMonth(selected);
    // Simula nuevos registros entrando en tiempo real (solo en el mes actual)
    setInterval(() => {
      const cur = demoMonth(CURRENT);
      const opts = ["consumibles", "Servicios", "Nomina", "Mantenimiento", "General"];
      cur.push({ id: `d${++demoSeq}`, seq: demoSeq, date: new Date(CURRENT.y, CURRENT.m, new Date().getDate()), category: opts[Math.floor(Math.random() * opts.length)], concept: "Registro en vivo (demo)", amount: Math.round((200 + Math.random() * 2500) * 100) / 100, wallet: "Caja chica" });
      if (isCurrent()) { newIds.add(`d${demoSeq}`); render(); }
    }, 20000);
    render();
  }

  /* ---------------- Selector de mes ---------------- */
  const monthSel = $("monthSelect");
  function fillMonthSelect() {
    const opts = [];
    for (let i = 0; i <= HISTORY_MONTHS; i++) {
      const d = new Date(CURRENT.y, CURRENT.m - i, 1);
      const label = d.toLocaleDateString(CFG.locale, { month: "long", year: "numeric" });
      opts.push(`<option value="${d.getFullYear()}-${d.getMonth()}">${label.charAt(0).toUpperCase()}${label.slice(1)}${i === 0 ? " (actual)" : ""}</option>`);
    }
    monthSel.innerHTML = opts.join("");
  }
  function syncMonthControls() {
    monthSel.value = `${selected.y}-${selected.m}`;
    const k = monthKey(selected);
    $("monthPrev").disabled = k <= monthKey(CURRENT) - HISTORY_MONTHS;
    $("monthNext").disabled = isCurrent();
    $("monthReset").hidden = isCurrent();
  }
  async function changeMonth(sel) {
    selected = { y: sel.y, m: sel.m };
    newIds = new Set();
    if (mode === "demo") { transactions = demoMonth(selected); render(); }
    else { transactions = []; await refresh(); }
  }
  const shift = (n) => { const d = new Date(selected.y, selected.m + n, 1); changeMonth({ y: d.getFullYear(), m: d.getMonth() }); };
  fillMonthSelect();
  monthSel.addEventListener("change", () => { const [y, m] = monthSel.value.split("-").map(Number); changeMonth({ y, m }); });
  $("monthPrev").addEventListener("click", () => shift(-1));
  $("monthNext").addEventListener("click", () => shift(1));
  $("monthReset").addEventListener("click", () => changeMonth(CURRENT));

  /* ---------------- Ventana flotante: desglose por categoría ---------------- */
  const dlg = $("detail");
  let detailId = null;
  let detailChart = null;
  let lastR = null;
  // Enlace directo: index.html#detalle=consumibles abre esa categoría al cargar
  let pendingDetail = (location.hash.match(/detalle=([\w-]+)/) || [])[1] || null;
  const baseName = (s) => norm(String(s).replace(/\(.*?\)/g, "")).replace(/\s+/g, " ").trim();
  const dShort = (d) => d.toLocaleDateString(CFG.locale, { day: "2-digit", month: "short" });

  function openDetail(id) {
    if (!id || !lastR) return;
    detailId = id;
    if (!dlg.open) dlg.showModal(); // abrir antes de dibujar para que el gráfico tome su tamaño real
    renderDetail(lastR);
    $("dBody").scrollTop = 0;
  }

  function renderDetail(R) {
    if (!detailId) return;
    const c = R.cats.find((x) => x.id === detailId);
    if (!c) return;
    const { P } = R;
    const s = STATUS[c.status];

    $("dDot").className = `dot dot--${c.level}`;
    $("dTitle").textContent = c.name;
    $("dSub").textContent = `${c.tx.length} movimientos · Día ${P.day} de ${P.dim}`;
    $("dPill").className = `pill pill--${s.cls}`;
    $("dPill").textContent = s.label;

    // Indicadores
    const avail = c.budget - c.spent;
    $("dStats").innerHTML = [
      ["Presupuesto", fmt0.format(c.budget), ""],
      ["Gastado", fmt0.format(c.spent), c.budget ? pct(c.rSpent) : "—"],
      [P.closed ? "Cierre" : "Proyección", fmt0.format(c.projection), c.budget ? pct(c.rProj) : "—", c.level],
      ["Disponible", fmt0.format(avail), P.daysLeft && avail > 0 ? `${fmt0.format(avail / P.daysLeft)}/día` : "", avail < 0 ? "red" : ""],
    ].map(([l, v, f, lvl]) => `<div class="dstat"><span class="dstat__l">${l}</span><strong class="dstat__v ${lvl ? "t-" + lvl : ""}">${v}</strong><span class="dstat__f muted">${f}</span></div>`).join("");
    const barPct = c.budget ? Math.min(c.rSpent, 1) * 100 : (c.spent ? 100 : 0);
    $("dBar").innerHTML = `<div class="track__fill track__fill--${c.level === "grey" ? "neutral" : c.level}" style="width:${barPct}%"></div>${c.pace !== "fixed" && c.budget ? `<span class="track__mark" style="left:${P.frac * 100}%" title="Esperado a hoy"></span>` : ""}`;

    const a = alertFor(c, P);
    $("dAlert").innerHTML = a ? `<div class="alert alert--${a.lvl}"><span class="dot dot--${a.lvl}"></span><div class="alert__msg">${a.msg}</div></div>` : "";

    // Desglose por concepto (presupuesto vs. gastado)
    const rows = c.concepts.map(([name, budget]) => ({ name, budget, spent: 0, n: 0, key: baseName(name) }));
    const other = { name: "No asociado a un concepto presupuestado", budget: 0, spent: 0, n: 0 };
    for (const t of c.tx) {
      const k = baseName(t.concept || "");
      const r = k && (rows.find((x) => x.key === k) || rows.find((x) => x.key.includes(k) || k.includes(x.key)));
      const tgt = r || other;
      tgt.spent += t.amount; tgt.n++;
    }
    const matched = rows.some((r) => r.n > 0);
    if (other.n && matched) rows.push(other);
    rows.sort((x, y) => y.spent - x.spent || y.budget - x.budget);
    $("dConcepts").innerHTML = !rows.length ? `<p class="muted small">Sin conceptos presupuestados.</p>`
      : !matched ? `
      <table class="dtable">
        <thead><tr><th>Concepto presupuestado</th><th class="num">Ppto. mensual</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${fmt0.format(r.budget)}</td></tr>`).join("")}</tbody>
      </table>
      <p class="muted small">Los conceptos capturados no coinciden con los del presupuesto; se muestran como referencia.</p>` : `
      <table class="dtable">
        <thead><tr><th>Concepto</th><th class="num">Gastado</th><th class="num">Ppto.</th><th class="num">%</th></tr></thead>
        <tbody>${rows.map((r) => {
          const ratio = r.budget ? r.spent / r.budget : null;
          const lvl = ratio == null ? (r.spent ? "amber" : "grey") : ratio >= 1 ? "red" : ratio >= Math.max(P.frac * 1.2, 0.5) ? "amber" : "green";
          const w = ratio == null ? (r.spent ? 100 : 0) : Math.min(ratio, 1) * 100;
          return `<tr>
            <td><div class="dtable__name">${esc(r.name)}</div><div class="track track--thin"><div class="track__fill track__fill--${lvl === "grey" ? "neutral" : lvl}" style="width:${w}%"></div></div><div class="muted small">${r.n} mov.</div></td>
            <td class="num">${fmt0.format(r.spent)}</td>
            <td class="num muted">${r.budget ? fmt0.format(r.budget) : "—"}</td>
            <td class="num"><span class="t-${lvl === "grey" ? "" : lvl}">${ratio == null ? "—" : pct(ratio)}</span></td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;

    // Principales conceptos tal como se capturan (titulo)
    const titles = {};
    for (const t of c.tx) {
      const k = norm(t.concept || "(sin descripción)");
      (titles[k] ||= { name: t.concept || "(sin descripción)", v: 0, n: 0 });
      titles[k].v += t.amount; titles[k].n++;
    }
    const tl = Object.values(titles).sort((x, y) => y.v - x.v).slice(0, 10);
    $("dTitles").innerHTML = tl.length ? tl.map((t) => `
      <div class="wrow"><span title="${esc(t.name)}">${esc(t.name)} <span class="muted small">· ${t.n}</span></span><div class="track track--thin"><div class="track__fill track__fill--neutral" style="width:${(t.v / tl[0].v) * 100}%"></div></div><strong>${fmt0.format(t.v)}</strong></div>`).join("")
      : `<p class="muted small">Sin movimientos.</p>`;

    // Por cartera
    const wallets = {};
    for (const t of c.tx) { const w = t.wallet || "Sin cartera"; wallets[w] = (wallets[w] || 0) + t.amount; }
    const wl = Object.entries(wallets).sort((x, y) => y[1] - x[1]);
    $("dWallets").innerHTML = wl.length ? wl.map(([w, v]) => `
      <div class="wrow"><span>${esc(w)}</span><div class="track track--thin"><div class="track__fill track__fill--neutral" style="width:${(v / c.spent) * 100}%"></div></div><strong>${fmt0.format(v)}</strong></div>`).join("")
      : `<p class="muted small">Sin movimientos.</p>`;

    // Movimientos
    const tx = c.tx.slice().sort((x, y) => y.date - x.date || (y.seq || 0) - (x.seq || 0));
    $("dTxCount").textContent = `(${tx.length})`;
    $("dTx").innerHTML = tx.length ? `
      <table class="dtable dtable--tx">
        <thead><tr><th>Fecha</th><th>Concepto</th><th>Cartera</th><th class="num">Monto</th></tr></thead>
        <tbody>${tx.map((t) => `<tr class="${newIds.has(t.id) ? "new" : ""}"><td>${dShort(t.date)}</td><td>${esc(t.concept || t.category)}</td><td class="muted">${esc(t.wallet || "—")}</td><td class="num">${fmt2.format(t.amount)}</td></tr>`).join("")}</tbody>
      </table>` : `<p class="muted small">Sin movimientos este mes.</p>`;

    renderDetailChart(c, P);
  }

  function renderDetailChart(c, P) {
    if (!window.Chart) return;
    const labels = Array.from({ length: P.day }, (_, i) => i + 1);
    const daily = new Array(P.day).fill(0);
    for (const t of c.tx) { const d = t.date.getDate(); if (d >= 1 && d <= P.day) daily[d - 1] += t.amount; }
    const css = getComputedStyle(document.documentElement);
    const pace = c.pace === "fixed" || !c.budget ? null : c.budget / P.dim;
    const data = {
      labels,
      datasets: [
        { type: "bar", label: "Gasto del día", data: daily, backgroundColor: css.getPropertyValue("--navy-2").trim(), borderRadius: 3, maxBarThickness: 22 },
        ...(pace ? [{ type: "line", label: "Ritmo presupuestado", data: labels.map(() => pace), borderColor: css.getPropertyValue("--red").trim(), borderDash: [4, 3], borderWidth: 1.5, pointRadius: 0 }] : []),
      ],
    };
    if (detailChart) { detailChart.data = data; detailChart.update(); return; }
    detailChart = new Chart($("dChart"), {
      data,
      options: {
        maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { title: (i) => `Día ${i[0].label}`, label: (ctx) => `${ctx.dataset.label}: ${fmt0.format(ctx.raw)}` } } },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => fmtC.format(v) }, grid: { color: "#eef2f7" } }, x: { grid: { display: false } } },
      },
    });
  }

  $("dClose").addEventListener("click", () => dlg.close());
  // Cerrar al tocar el fondo (respaldo para navegadores sin `closedby`)
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { detailId = null; });
  // Al girar el teléfono, el gráfico se ajusta al nuevo tamaño
  window.matchMedia("(orientation: landscape)").addEventListener("change", () => detailChart && detailChart.resize());

  /* ---------------- Eventos ---------------- */
  function bindOpen(container, selector) {
    container.addEventListener("click", (e) => { const el = e.target.closest(selector); if (el) openDetail(el.dataset.id); });
    container.addEventListener("keydown", (e) => {
      const el = e.target.closest(selector);
      if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDetail(el.dataset.id); }
    });
  }
  bindOpen($("catTable"), ".cat-row");
  bindOpen($("alerts"), ".alert--link");
  $("refreshBtn").addEventListener("click", refresh);

  /* ---------------- Conexión (guardada solo en este navegador) ---------------- */
  function getConn() {
    if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) return { url: CFG.SUPABASE_URL, key: CFG.SUPABASE_ANON_KEY, fromConfig: true };
    try {
      const s = JSON.parse(localStorage.getItem(CFG.storageKey) || "null");
      if (s && s.url && s.key) return s;
    } catch { /* almacenamiento no disponible */ }
    return null;
  }
  const setupDlg = $("setup");
  function openSetup() {
    const c = getConn();
    $("setupUrl").value = c ? c.url : "";
    $("setupKey").value = c ? c.key : "";
    $("setupForget").hidden = !(c && !c.fromConfig);
    $("setupError").textContent = "";
    setupDlg.showModal();
  }
  $("setupBtn").addEventListener("click", openSetup);
  $("setupDemo").addEventListener("click", () => setupDlg.close());
  $("setupForget").addEventListener("click", () => {
    localStorage.removeItem(CFG.storageKey);
    location.reload();
  });
  $("setupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = $("setupUrl").value.trim().replace(/\/+$/, "");
    const key = $("setupKey").value.trim();
    const err = $("setupError");
    if (!/^https:\/\/[\w-]+\.supabase\.co$/i.test(url)) { err.textContent = "La URL debe tener la forma https://xxxx.supabase.co"; return; }
    if (!key) { err.textContent = "Ingresa la clave publicable."; return; }
    if (!window.supabase) { err.textContent = "No se pudo cargar la librería de Supabase. Revisa tu conexión a internet."; return; }
    const btn = $("setupSubmit");
    btn.disabled = true; btn.textContent = "Verificando…"; err.textContent = "";
    try {
      const test = window.supabase.createClient(url, key);
      const { error } = await test.from(CFG.table).select(COL.date).limit(1);
      if (error) throw error;
      localStorage.setItem(CFG.storageKey, JSON.stringify({ url, key }));
      location.reload();
    } catch (ex) {
      err.textContent = `No se pudo conectar: ${ex.message || ex}`;
      btn.disabled = false; btn.textContent = "Conectar";
    }
  });

  /* ---------------- App instalable (PWA) ---------------- */
  const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker:", e));
  }
  let installEvt = null;
  const installBtn = $("installBtn");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvt = e;
    if (!isStandalone) installBtn.hidden = false;
  });
  window.addEventListener("appinstalled", () => { installBtn.hidden = true; installEvt = null; });
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS && !isStandalone) installBtn.hidden = false;
  installBtn.addEventListener("click", async () => {
    if (installEvt) {
      installEvt.prompt();
      const { outcome } = await installEvt.userChoice;
      if (outcome === "accepted") installBtn.hidden = true;
      installEvt = null;
    } else if (isIOS) {
      $("iosInstall").showModal();
    }
  });
  $("iosClose").addEventListener("click", () => $("iosInstall").close());

  const conn = getConn();
  if (conn && window.supabase) startLive(conn);
  else {
    startDemo();
    // index.html#demo abre directamente el modo demo sin pedir conexión
    if (!conn && !/demo/.test(location.hash)) openSetup();
  }
})();
