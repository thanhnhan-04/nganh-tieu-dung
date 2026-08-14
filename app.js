const state = {
  data: null,
  live: null,
  selectedTicker: "MCM",
  activeTab: "drivers"
};

const titleMap = {
  drivers: "Key Driver Monitor",
  overview: "Company Snapshot",
  bridge: "Revenue → Margin → Profit",
  catalyst: "Catalyst & Regulatory Calendar",
  sources: "Data Quality & Sources"
};

const CATEGORY_LABEL = {
  "market-live": "LIVE · GIÁ HÀNG HOÁ/FX",
  "operational": "VẬN HÀNH · THEO QUÝ",
  "policy": "CHÍNH SÁCH · KHÔNG LIVE"
};

const STATUS_LABEL = {
  occurred: { text: "ĐÃ XÁC NHẬN", cls: "up" },
  occurred_unverified: { text: "ĐÃ QUA · CẦN XÁC MINH", cls: "warn" },
  upcoming: { text: "SẮP TỚI", cls: "" },
  missing: { text: "THIẾU DỮ LIỆU", cls: "down" }
};

const fmt = {
  money(v) {
    if (v == null || Number.isNaN(v)) return "--";
    return Math.round(v).toLocaleString("vi-VN");
  },
  pct(v, digits = 1) {
    if (v == null || Number.isNaN(v)) return "--";
    return `${(v * 100).toFixed(digits)}%`;
  },
  x(v) {
    if (v == null || Number.isNaN(v)) return "--";
    return `${Number(v).toFixed(1)}x`;
  }
};

async function init() {
  const res = await fetch("dashboard-data.json", { cache: "no-store" });
  state.data = await res.json();
  bindUi();
  renderAll();
  await refreshLive();
  setInterval(refreshLive, 120000);
}

function bindUi() {
  document.querySelectorAll(".nav button").forEach(btn => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      document.querySelectorAll(".nav button").forEach(x => x.classList.toggle("active", x === btn));
      document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.id === state.activeTab));
      document.getElementById("pageTitle").textContent = titleMap[state.activeTab];
      window.scrollTo({ top: 0, behavior: "smooth" });
      renderAll();
    });
  });

  const select = document.getElementById("tickerSelect");
  select.innerHTML = state.data.companies.map(s => `<option value="${s.ticker}">${s.ticker} · ${s.name}</option>`).join("");
  select.value = state.selectedTicker;
  select.addEventListener("change", () => {
    state.selectedTicker = select.value;
    renderAll();
  });

  document.getElementById("refreshBtn").addEventListener("click", refreshLive);
  ["driverSearch", "categoryFilter", "tickerFilter"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderDrivers);
    if (el) el.addEventListener("change", renderDrivers);
  });
}

async function fetchLivePayload() {
  // Local dev: server.py exposes a live on-demand endpoint.
  try {
    const res = await fetch("/api/live", { cache: "no-store" });
    if (res.ok) return { payload: await res.json(), mode: "on-demand" };
  } catch (err) {
    /* no local server — fall through to the static snapshot */
  }
  // Static hosting (GitHub Pages): fall back to the snapshot committed by
  // the GitHub Actions workflow (.github/workflows/refresh-live-data.yml).
  const res2 = await fetch("live-data.json", { cache: "no-store" });
  if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
  return { payload: await res2.json(), mode: "snapshot" };
}

async function refreshLive() {
  const liveState = document.getElementById("liveState");
  liveState.textContent = "Đang refresh";
  try {
    const { payload, mode } = await fetchLivePayload();
    state.live = payload;
    const liveCount = Object.values(state.live.quotes || {}).filter(q => q.status === "live").length;
    const total = state.data.companies.length;
    const suffix = mode === "snapshot" ? " (snapshot ~30p)" : "";
    liveState.textContent = liveCount ? `${liveCount}/${total} quotes live${suffix}` : "Offline fallback";
    document.getElementById("liveTime").textContent = state.live.generatedAt || "--";
  } catch (err) {
    state.live = null;
    liveState.textContent = "Offline fallback";
    document.getElementById("liveTime").textContent = "Dùng dữ liệu model";
  }
  renderAll();
}

function renderAll() {
  if (!state.data) return;
  document.getElementById("tickerSelect").value = state.selectedTicker;
  renderDrivers();
  renderOverview();
  renderBridge();
  renderCatalyst();
  renderSources();
}

function company(ticker = state.selectedTicker) {
  return state.data.companies.find(s => s.ticker === ticker);
}

function quote(ticker) {
  return state.live?.quotes?.[ticker];
}

function commodity(id) {
  return state.live?.commodities?.[id];
}

function livePrice(s) {
  const q = quote(s.ticker);
  if (q?.status === "live") return q.price;
  return s.basePrice ?? null;
}

function driversFor(ticker) {
  return state.data.drivers.filter(d => d.affected.some(a => a.ticker === ticker));
}

/* ---------- Tab 1: Key Driver Monitor ---------- */

function renderDrivers() {
  const liveCards = state.data.drivers.filter(d => d.live);
  document.getElementById("liveStrip").innerHTML = liveCards.map(d => {
    const c = commodity(d.live.symbol);
    const up = (c?.changePct || 0) >= 0;
    const spark = c?.status === "live" && c.history ? sparkline(c.history) : "";
    return `<div class="card">
      <div class="klabel">${d.name}</div>
      <div class="kval ${up ? "up" : "down"}">${c?.status === "live" ? fmt.money(c.price) : "--"}</div>
      <div class="sub">${d.live.label} · ${c?.status === "live" ? fmt.pct(c.changePct) : "offline"} · ${d.affected.map(a => a.ticker).join("/")}</div>
      ${spark}
      <div class="mini" style="margin-top:8px">${d.live.note}</div>
    </div>`;
  }).join("");

  const q = (document.getElementById("driverSearch")?.value || "").toLowerCase();
  const cat = document.getElementById("categoryFilter")?.value || "";
  const tick = document.getElementById("tickerFilter")?.value || "";
  const rows = state.data.drivers.filter(d => {
    const text = `${d.name} ${d.mechanism} ${d.affected.map(a => a.ticker).join(" ")}`.toLowerCase();
    return (!q || text.includes(q)) && (!cat || d.category === cat) && (!tick || d.affected.some(a => a.ticker === tick));
  });

  document.getElementById("driverCards").innerHTML = rows.map((d, idx) => {
    const c = d.live ? commodity(d.live.symbol) : null;
    const liveChip = d.live
      ? `<span class="badge live">${c?.status === "live" ? `${fmt.money(c.price)} ${d.unit.split(" ")[0]}` : "LIVE OFFLINE"}</span>`
      : `<span class="badge ${d.category === "policy" ? "nd" : "estimate"}">${CATEGORY_LABEL[d.category]}</span>`;
    return `<div class="card clickable driver-card">
      <div class="phead">
        <div><div class="pname">${d.name}</div><div class="mini">${d.cadence}</div></div>
        <div>${liveChip}</div>
      </div>
      <div class="mechanism"><span class="klabel">Cơ chế</span><p>${d.mechanism}</p></div>
      <div class="detail ${idx === 0 ? "open" : ""}">
        <hr style="border:0;border-top:1px solid #1c3855">
        ${d.anchors.length ? `<div class="mini"><b>Số liệu tham chiếu:</b></div>` + d.anchors.map(a => `<div class="metric"><span>${a.label}</span><b>${a.value}</b></div>`).join("") : ""}
        <div class="mini" style="margin-top:10px"><b>Ảnh hưởng tới doanh nghiệp:</b></div>
        ${d.affected.map(a => `
          <div class="insight" style="margin-top:7px">
            <b>${a.ticker} · ${a.direction}</b><br>
            ${a.sensitivity}<br>
            <span class="mini">Timing: ${a.timing}</span>
          </div>
        `).join("")}
      </div>
    </div>`;
  }).join("");
  document.querySelectorAll(".driver-card").forEach(card => card.addEventListener("click", () => {
    card.querySelector(".detail").classList.toggle("open");
  }));
}

function sparkline(history) {
  const closes = history.map(h => h.close).filter(v => v != null);
  if (closes.length < 2) return "";
  const min = Math.min(...closes), max = Math.max(...closes);
  const range = max - min || 1;
  const pts = closes.map((v, i) => `${(i / (closes.length - 1)) * 100},${28 - ((v - min) / range) * 26 - 1}`).join(" ");
  return `<svg viewBox="0 0 100 28" class="spark" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6"></polyline></svg>`;
}

/* ---------- Tab 2: Company Snapshot ---------- */

function renderOverview() {
  const items = state.data.companies;
  const selected = company();
  const price = livePrice(selected);
  const upside = selected.targetPrice && price ? selected.targetPrice / price - 1 : null;
  const liveQuotes = Object.values(state.live?.quotes || {}).filter(q => q.status === "live").length;

  document.getElementById("overviewCards").innerHTML = [
    ["Selected ticker", selected.ticker, `${selected.name} · ${selected.sector}`, ""],
    ["Live quote coverage", `${liveQuotes}/${items.length}`, "QNS không có mã Yahoo (UPCoM)", liveQuotes >= 3 ? "up" : "warn"],
    ["Upside to target", fmt.pct(upside), `${fmt.money(price)} → ${selected.targetPrice ? fmt.money(selected.targetPrice) : "--"}`, upside > 0.2 ? "up" : "warn"],
    ["Forward P/E", fmt.x(selected.forwardPe), "Tại thời điểm nguồn — không phải live", ""],
    ["Dividend yield", fmt.pct(selected.dividendYield), "Income support nếu có", selected.dividendYield > 0.06 ? "up" : ""]
  ].map(([label, value, sub, tone]) => `<div class="card"><div class="klabel">${label}</div><div class="kval ${tone}">${value}</div><div class="sub">${sub}</div></div>`).join("");

  document.getElementById("companyCards").innerHTML = items.map(s => {
    const dq = state.data.dataQualityNotes.find(n => n.ticker === s.ticker);
    const drv = driversFor(s.ticker);
    const q = quote(s.ticker);
    const chg = q?.status === "live" ? fmt.pct(q.changePct) : "model";
    const stale = /⚠/.test(s.dataAsOf) ? `<span class="badge nd">DỮ LIỆU CŨ</span>` : "";
    return `<div class="card clickable" data-select="${s.ticker}">
      <div class="phead"><div><div class="pname">${s.ticker} · ${s.name}</div><div class="mini">${s.subsector}</div></div><div class="score">${chg}</div></div>
      <div class="metric"><span>Driver liên quan</span><b>${drv.length}</b></div>
      <div class="metric"><span>Vấn đề data quality</span><b>${dq ? dq.issues.length : 0}</b></div>
      <div class="metric"><span>Độ mới dữ liệu</span>${stale}</div>
      <div class="insight ${s.ticker === state.selectedTicker ? "g" : ""}" style="margin-top:9px">${s.thesis[0]}</div>
    </div>`;
  }).join("");
  document.querySelectorAll("[data-select]").forEach(card => card.addEventListener("click", () => {
    state.selectedTicker = card.dataset.select;
    renderAll();
  }));

  document.getElementById("selectedSummary").innerHTML = `
    <div class="phead"><div><div class="pname">${selected.ticker} · ${selected.name}</div><div class="mini">${selected.exchange} · ${selected.subsector}</div></div></div>
    <div class="metric"><span>Price / Target</span><b>${fmt.money(price)} / ${selected.targetPrice ? fmt.money(selected.targetPrice) : "--"}</b></div>
    <div class="metric"><span>P/E forward</span><b>${fmt.x(selected.forwardPe)}</b></div>
    <div class="metric"><span>Dividend yield</span><b>${fmt.pct(selected.dividendYield)}</b></div>
    <div class="mini" style="margin-top:8px"><b>Độ mới dữ liệu:</b> ${selected.dataAsOf}</div>
    ${selected.targetPriceNote ? `<div class="mini" style="margin-top:6px"><b>Lưu ý target price:</b> ${selected.targetPriceNote}</div>` : ""}
    <div class="sec">${selected.thesis.map(t => `<div class="insight" style="margin-top:7px">${t}</div>`).join("")}</div>
  `;

  document.getElementById("readThrough").innerHTML = driversFor(selected.ticker).map(d => {
    const a = d.affected.find(x => x.ticker === selected.ticker);
    return `
    <div class="metric"><span>${d.name}</span><b>${a.direction}</b></div>
    <div class="mini" style="margin-bottom:8px">${a.timing}</div>
  `;
  }).join("") || `<div class="mini">Không có driver nào map tới mã này.</div>`;
}

/* ---------- Tab 3: Bridge ---------- */

function renderBridge() {
  const s = company();
  drawMultiLine(document.getElementById("trendChart"), buildRows(s));
  renderMixChart(s);
  renderGuidanceGap(s);
  renderBridgeTable(s);
}

function buildRows(s) {
  const rev = s.financials.revenue || [];
  const profit = s.financials.profit || [];
  const gpm = s.financials.gpm || [];
  const periods = [...new Set([...rev, ...profit, ...gpm].map(d => d.period))];
  return periods.map(period => ({
    period,
    revenue: rev.find(d => d.period === period)?.value ?? null,
    profit: profit.find(d => d.period === period)?.value ?? null,
    gpm: gpm.find(d => d.period === period)?.value ?? null
  }));
}

function renderMixChart(s) {
  let rows = [];
  let title = "Driver mix";
  if (s.ticker === "VNM") {
    rows = s.financials.revenueMix2026.map(d => ({ label: d.label, value: d.value, kind: "rev" }));
    title = "VNM 2026F revenue mix";
  } else if (s.ticker === "MCM") {
    rows = s.financials.segments.filter(d => d.period === "2026F").map(d => ({ label: d.label, value: d.value, kind: d.label === "MCC" ? "margin" : "rev" }));
    title = "MCM 2026F segment bridge";
  } else if (s.ticker === "QNS") {
    rows = s.financials.segments2026.map(d => ({ label: d.label, value: d.revenue, kind: d.gpm > .3 ? "margin" : "rev" }));
    title = "QNS 2026F segment revenue";
  } else {
    rows = s.financials.valuation.map(d => ({ label: d.period, value: d.pe, kind: "cost" }));
    title = "SAB P/E compression";
  }
  document.getElementById("mixTitle").textContent = title;
  drawBars(document.getElementById("mixChart"), rows);
}

function renderGuidanceGap(s) {
  const g = s.financials.companyGuidance2026 || s.financials.companyGuidance2025 || s.financials.modelBaseCaseAlt;
  const el = document.getElementById("guidanceGap");
  if (!g) { el.innerHTML = ""; return; }
  const label = s.financials.companyGuidance2026 ? "Kế hoạch chính thức 2026 (ban lãnh đạo)" :
    s.financials.companyGuidance2025 ? "Kế hoạch chính thức 2025 (ban lãnh đạo)" : "Kịch bản Base case khác trong model";
  const rev = g.revenue != null ? fmt.money(g.revenue) : "--";
  const profit = g.profit != null ? fmt.money(g.profit) : "--";
  const target = g.targetPrice != null ? fmt.money(g.targetPrice) : null;
  el.innerHTML = `<div class="card"><div class="klabel">${label} — so với số model dùng cho dashboard</div>
    <div class="metric"><span>Doanh thu</span><b>${rev}</b></div>
    ${g.profit != null ? `<div class="metric"><span>Lợi nhuận</span><b>${profit}</b></div>` : ""}
    ${target ? `<div class="metric"><span>Target price</span><b>${target}</b></div>` : ""}
    <div class="mini" style="margin-top:8px">${g.note || ""}</div>
  </div>`;
}

function renderBridgeTable(s) {
  const actualRev = lastActual(s.financials.revenue);
  const nextRev = firstForecast(s.financials.revenue) || actualRev;
  const actualProfit = lastActual(s.financials.profit);
  const nextProfit = firstForecast(s.financials.profit) || actualProfit;
  const actualGpm = lastActual(s.financials.gpm);
  const nextGpm = firstForecast(s.financials.gpm) || actualGpm;
  const explanations = {
    VNM: ["Nội địa mature, tăng trưởng đến từ quốc tế và category mới.", "EPS phụ thuộc BLNG hồi phục + chi phí tài chính.", "Giá sữa bột nhập khẩu và mix quốc tế quyết định margin."],
    MCM: ["Legacy + MCC scale-up tạo nền doanh thu mới.", "LNST hồi phục nếu BLNG và SG&A không ăn hết premium mix.", "MCC và Sơn La là hai biến số nâng BLNG."],
    QNS: ["Đường + sữa đậu nành cùng kéo doanh thu, nhưng biên rất khác nhau.", "LNST model cao hơn hẳn kế hoạch công ty — xem cảnh báo phía trên.", "BLNG 2026F giảm do giả định đường thận trọng hơn."],
    SAB: ["Doanh thu nội địa là driver chính, không có export buffer.", "Không có số liệu FY2025 thực tế trong nguồn — chỉ có kế hoạch.", "BLNG phải xác nhận hiệu quả giá nhôm/hợp đồng dài hạn."]
  }[s.ticker];
  document.getElementById("bridgeBody").innerHTML = [
    ["Doanh thu", actualRev, nextRev, explanations[0], false],
    ["LNST / profit", actualProfit, nextProfit, explanations[1], false],
    ["BLNG", actualGpm, nextGpm, explanations[2], true]
  ].map(([label, actual, next, text, pct]) => {
    const delta = actual && next ? next.value / actual.value - 1 : null;
    return `<tr><td><b>${label}</b></td><td>${actual ? (pct ? fmt.pct(actual.value) : fmt.money(actual.value)) : "--"}<br><span class="mini">${actual?.period || ""}</span></td><td>${next ? (pct ? fmt.pct(next.value) : fmt.money(next.value)) : "--"}<br><span class="mini">${next?.period || ""}</span></td><td>${fmt.pct(delta)}</td><td>${text}</td></tr>`;
  }).join("");
}

function lastActual(arr = []) {
  return arr.filter(d => !String(d.period).includes("F") && !String(d.period).includes("Q")).at(-1);
}

function firstForecast(arr = []) {
  return arr.find(d => String(d.period).includes("2026F"));
}

/* ---------- Tab 4: Catalyst & Regulatory Calendar ---------- */

function renderCatalyst() {
  const items = state.data.companies.flatMap(s => s.catalysts.map(c => ({ ticker: s.ticker, ...c })));
  document.getElementById("timeline").innerHTML = items.map(c => {
    const st = STATUS_LABEL[c.status] || STATUS_LABEL.upcoming;
    return `<div class="card">
      <div class="phead"><div><div class="pname">${c.ticker}</div><div class="mini">${c.date}</div></div><span class="badge ${st.cls || "estimate"}">${st.text}</span></div>
      <div class="insight" style="margin-top:9px">${c.event}</div>
    </div>`;
  }).join("");
}

/* ---------- Tab 5: Sources & Data Quality ---------- */

function renderSources() {
  document.getElementById("dataQualityCards").innerHTML = state.data.dataQualityNotes.map(n => `
    <div class="card">
      <div class="phead"><div><div class="pname">${n.ticker}</div><div class="mini">${n.issues.length} vấn đề tìm thấy</div></div></div>
      ${n.issues.map(i => `<div class="insight r" style="margin-top:8px">${i}</div>`).join("")}
    </div>
  `).join("");

  document.getElementById("sourceBody").innerHTML = state.data.companies.flatMap(s => s.sourceFiles.map(file => ({ ticker: s.ticker, file }))).map(row => {
    const quality = row.file.endsWith(".xlsx") ? "model" : row.file.endsWith(".pdf") || row.file.endsWith(".docx") || row.file.endsWith(".pptx") ? "verified" : "estimate";
    const use = row.file.endsWith(".xlsx") ? "Financial actual, forecast, valuation, segment bridge" : "Thesis, catalyst, management commentary, qualitative driver";
    const labels = { verified: "ĐÃ XÁC MINH", model: "MODEL", estimate: "ƯỚC TÍNH" };
    return `<tr><td><b>${row.ticker}</b></td><td>${row.file}</td><td>${use}</td><td><span class="badge ${quality}">${labels[quality]}</span></td></tr>`;
  }).join("");
}

/* ---------- Charts ---------- */

function drawMultiLine(container, rows) {
  const width = container.clientWidth || 720;
  const height = container.clientHeight || 380;
  const pad = { top: 22, right: 58, bottom: 42, left: 64 };
  const maxLeft = Math.max(...rows.flatMap(d => [d.revenue, d.profit]).filter(v => v != null), 1);
  const maxGpm = Math.max(...rows.map(d => d.gpm || 0), 0.5);
  const x = i => pad.left + (i * (width - pad.left - pad.right)) / Math.max(rows.length - 1, 1);
  const yLeft = v => height - pad.bottom - (v / maxLeft) * (height - pad.top - pad.bottom);
  const yRight = v => height - pad.bottom - (v / maxGpm) * (height - pad.top - pad.bottom);
  const line = (field, yfn) => {
    let started = false;
    return rows.map((d, i) => {
      if (d[field] == null) {
        started = false;
        return null;
      }
      const cmd = started ? "L" : "M";
      started = true;
      return `${cmd}${x(i)},${yfn(d[field])}`;
    }).filter(Boolean).join(" ");
  };

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Revenue profit and gross margin">
      ${[0, .25, .5, .75, 1].map(t => {
        const y = pad.top + t * (height - pad.top - pad.bottom);
        return `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}"></line>`;
      }).join("")}
      <path class="line-revenue" d="${line("revenue", yLeft)}"></path>
      <path class="line-profit" d="${line("profit", yLeft)}"></path>
      <path class="line-gpm" d="${line("gpm", yRight)}"></path>
      ${rows.map((d, i) => `
        <text class="chart-label" x="${x(i)}" y="${height - 15}" text-anchor="middle">${d.period}</text>
        ${d.revenue != null ? `<circle class="axis-dot" cx="${x(i)}" cy="${yLeft(d.revenue)}" r="4" fill="var(--b)"><title>${d.period} revenue ${fmt.money(d.revenue)}</title></circle>` : ""}
        ${d.profit != null ? `<circle class="axis-dot" cx="${x(i)}" cy="${yLeft(d.profit)}" r="4" fill="var(--g)"><title>${d.period} profit ${fmt.money(d.profit)}</title></circle>` : ""}
        ${d.gpm != null ? `<circle class="axis-dot" cx="${x(i)}" cy="${yRight(d.gpm)}" r="4" fill="var(--y)"><title>${d.period} BLNG ${fmt.pct(d.gpm)}</title></circle>` : ""}
      `).join("")}
      <text class="chart-label" x="${pad.left}" y="14">Tỷ VND</text>
      <text class="chart-label" x="${width - pad.right}" y="14" text-anchor="end">BLNG</text>
      <g transform="translate(${pad.left},${height - 36})">
        <rect width="10" height="10" fill="var(--b)"></rect><text class="chart-label" x="16" y="10">Doanh thu</text>
        <rect x="100" width="10" height="10" fill="var(--g)"></rect><text class="chart-label" x="116" y="10">LNST</text>
        <rect x="180" width="10" height="10" fill="var(--y)"></rect><text class="chart-label" x="196" y="10">BLNG</text>
      </g>
    </svg>
  `;
}

function drawBars(container, rows) {
  const max = Math.max(...rows.map(d => Math.abs(d.value)), 1);
  container.innerHTML = rows.map(d => `
    <div class="barrow">
      <span>${d.label}</span>
      <div class="barbg"><div class="bar ${d.kind || ""}" style="width:${Math.max(2, Math.abs(d.value) / max * 100)}%"></div></div>
      <b>${fmt.money(d.value)}</b>
    </div>
  `).join("");
}

window.addEventListener("resize", () => {
  if (state.data) renderBridge();
});

init();
