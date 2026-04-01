/* ── RTESE Frontend — app.js ────────────────────────── */

"use strict";

// ─── State ──────────────────────────────────────────────
const state = {
  events:      [],
  consumers:   [],
  topicCounts: {},
  eps:         0,
  latency:     0,
  totalEvents: 0,
  totalErrors: 0,
  errRate:     0,
  uptime:      0,
  engineOn:    true,
  epsHistory:  Array(50).fill(0),
  latHistory:  Array(50).fill(0),
  peakEps:     0,
  epsSum:      0,
  epsCnt:      0,
};

const TOPIC_COLORS = {
  "order.created":       "var(--blue)",
  "order.updated":       "var(--cyan)",
  "user.signup":         "var(--green)",
  "payment.processed":   "var(--purple)",
  "inventory.update":    "var(--orange)",
  "notification.push":   "var(--yellow)",
};
const PANEL_LABELS = {
  dashboard:"Dashboard", publish:"Publish Event", consumers:"Consumers",
  eventlog:"Event Log", replay:"Replay", metrics:"Metrics", architecture:"Architecture",
};

// ─── Navigation ─────────────────────────────────────────
function showPanel(id) {
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const panel = document.getElementById("panel-" + id);
  if (panel) panel.classList.add("active");
  document.querySelectorAll(".nav-item").forEach(n => {
    if (n.dataset.panel === id) n.classList.add("active");
  });
  document.getElementById("breadcrumb-label").textContent = PANEL_LABELS[id] || id;
  if (id === "consumers")    renderConsumers();
  if (id === "eventlog")     renderLog();
  if (id === "metrics")      renderTopicStats();
}
document.querySelectorAll(".nav-item[data-panel]").forEach(n => {
  n.addEventListener("click", () => showPanel(n.dataset.panel));
});

// ─── SSE Connection ─────────────────────────────────────
let eventSource = null;

function connectSSE() {
  if (eventSource) { eventSource.close(); }
  eventSource = new EventSource("/stream");

  eventSource.addEventListener("connected", () => {
    setSseBadge("connected");
  });

  eventSource.addEventListener("tick", (e) => {
    const data = JSON.parse(e.data);
    handleTick(data);
  });

  eventSource.addEventListener("published", (e) => {
    const ev = JSON.parse(e.data);
    toast("External event published: " + ev.topic, "blue");
  });

  eventSource.addEventListener("engineState", (e) => {
    const d = JSON.parse(e.data);
    state.engineOn = d.state === "running";
    updateEngineUI();
  });

  eventSource.addEventListener("replay", (e) => {
    const d = JSON.parse(e.data);
    toast(`Replay complete: ${d.count} events → ${d.consumer}`, "cyan");
  });

  eventSource.onerror = () => {
    setSseBadge("disconnected");
    setTimeout(connectSSE, 3000);
  };
}

function setSseBadge(state) {
  const el = document.getElementById("sse-badge");
  if (!el) return;
  const map = {
    connected:    ['<span class="dot green pulse"></span>Live', "green"],
    disconnected: ['<span class="dot red"></span>Reconnecting…', "red"],
    connecting:   ['<span class="dot yellow"></span>Connecting…', "yellow"],
  };
  const [html] = map[state] || map.connecting;
  el.innerHTML = html;
}

// ─── Handle Tick from SSE ────────────────────────────────
function handleTick(data) {
  // Store events
  if (data.events && data.events.length) {
    state.events.unshift(...data.events);
    if (state.events.length > 1000) state.events.length = 1000;

    // Update live stream panel
    const activePanel = document.querySelector(".panel.active");
    if (activePanel && activePanel.id === "panel-dashboard") {
      data.events.slice(0, 3).forEach(ev => addToStream(ev));
    }

    // Update log if visible
    if (activePanel && activePanel.id === "panel-eventlog") renderLog();
  }

  // Metrics
  state.eps         = data.eps         || 0;
  state.latency     = data.latency     || 0;
  state.totalEvents = data.totalEvents || 0;
  state.totalErrors = data.totalErrors || 0;
  state.errRate     = data.errRate     || 0;
  state.uptime      = data.uptime      || 0;
  state.topicCounts = data.topicCounts || {};

  if (data.consumers) {
    state.consumers = data.consumers.list || [];
  }

  // EPS history
  state.epsHistory.push(state.eps);
  state.latHistory.push(state.latency);
  if (state.epsHistory.length > 50) state.epsHistory.shift();
  if (state.latHistory.length > 50) state.latHistory.shift();
  if (state.eps > state.peakEps) state.peakEps = state.eps;
  state.epsSum += state.eps; state.epsCnt++;

  updateHeaderStats();
  updateDashboardKPIs();
  updateMiniChart();
  renderTopicBars();
  renderDashConsumers();
  updateMetricsKPIs();
  updateCharts();

  // Badges
  document.getElementById("nb-log").textContent = state.events.length;
  document.getElementById("nb-consumers").textContent = state.consumers.length;

  // Uptime
  const h = String(Math.floor(state.uptime / 3600)).padStart(2,"0");
  const m = String(Math.floor(state.uptime % 3600 / 60)).padStart(2,"0");
  const s = String(state.uptime % 60).padStart(2,"0");
  document.getElementById("h-uptime").textContent = `${h}:${m}:${s}`;
}

// ─── Header Stats ────────────────────────────────────────
function updateHeaderStats() {
  setText("h-eps", state.eps.toLocaleString());
  setText("h-lat", state.latency.toFixed(1) + " ms");
  const active = state.consumers.filter(c => c.status !== "offline").length;
  setText("h-cons", active);
}

// ─── Dashboard KPIs ──────────────────────────────────────
function updateDashboardKPIs() {
  const prev = state.epsHistory[state.epsHistory.length - 2] || state.eps;
  const pct  = prev > 0 ? Math.round((state.eps - prev) / prev * 100) : 0;
  setText("kpi-eps", state.eps.toLocaleString());
  const delta = document.getElementById("kpi-eps-delta");
  if (delta) {
    delta.textContent = (pct >= 0 ? "↑" : "↓") + Math.abs(pct) + "%";
    delta.style.color = pct >= 0 ? "var(--green)" : "var(--red)";
  }
  setText("kpi-lat",   state.latency.toFixed(1) + " ms");
  setText("kpi-lat-sub","p99: " + (state.latency + Math.random() * 0.8).toFixed(1) + "ms");

  const active  = state.consumers.filter(c => c.status === "active").length;
  const lagging = state.consumers.filter(c => c.status === "lagging").length;
  setText("kpi-cons",    active + lagging);
  setText("kpi-lag-sub", lagging + " lagging");
  setText("kpi-total",   state.totalEvents.toLocaleString());

  const errEl = document.getElementById("kpi-err");
  if (errEl) {
    errEl.textContent = state.errRate.toFixed(2) + "%";
    errEl.style.color = state.errRate > 2 ? "var(--red)" : "var(--green)";
  }

  // Consumer badge
  setText("cons-online-badge", (active + lagging) + " online");
}

// ─── Mini Chart ──────────────────────────────────────────
function updateMiniChart() {
  const el = document.getElementById("mini-chart"); if (!el) return;
  const data = state.epsHistory.slice(-20);
  const max  = Math.max(...data, 1);
  el.innerHTML = data.map(v =>
    `<div class="mc-bar" style="height:${Math.round(v / max * 100)}%"></div>`
  ).join("");
}

// ─── Topic Bars ──────────────────────────────────────────
function renderTopicBars() {
  const el = document.getElementById("topic-bars"); if (!el) return;
  const counts = state.topicCounts;
  const total  = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(counts).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]);
  el.innerHTML = sorted.map(([topic, cnt]) => {
    const pct  = Math.round(cnt / total * 100);
    const col  = TOPIC_COLORS[topic] || "var(--text)";
    return `<div class="topic-row">
      <div class="topic-row-head">
        <span style="color:${col}">${topic}</span>
        <span style="color:var(--muted)">${cnt.toLocaleString()} (${pct}%)</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${pct}%;background:${col}"></div>
      </div>
    </div>`;
  }).join("");
}

// ─── Live Stream ─────────────────────────────────────────
function addToStream(ev) {
  const el = document.getElementById("live-stream"); if (!el) return;
  const typeClass = ev.topic.split(".")[0];
  const latColor  = parseFloat(ev.latency) > 2.5 ? "var(--orange)" : "var(--green)";
  const item = document.createElement("div");
  item.className = `stream-item ${typeClass}`;
  item.innerHTML = `
    <span class="ev-time">${ev.timestamp.slice(0,12)}</span>
    <span class="ev-id">${ev.id}</span>
    <span class="ev-topic" style="color:${TOPIC_COLORS[ev.topic]||"var(--text)"}">${ev.topic}</span>
    <span class="ev-msg">${ev.producer} → ${ev.consumers} consumers</span>
    <span class="ev-lat" style="color:${latColor}">${ev.latency}ms</span>
    <span class="badge ${ev.status==="ACK"?"green":"red"}" style="font-size:10px">${ev.status}</span>
  `;
  el.prepend(item);
  while (el.children.length > 50) el.removeChild(el.lastChild);
}

// ─── Dashboard Consumer Table ────────────────────────────
function renderDashConsumers() {
  const tb = document.getElementById("dash-cons-table"); if (!tb) return;
  tb.innerHTML = state.consumers.map(c => `<tr>
    <td style="font-family:monospace;color:var(--cyan);font-size:11px">${c.id}</td>
    <td>${c.service}</td>
    <td>${protoBadge(c.proto)}</td>
    <td style="font-size:11px;color:var(--muted)">${c.topics}</td>
    <td>${statusBadge(c.status)}</td>
    <td>
      <div class="lag-wrap">
        <div class="lag-track">
          <div class="lag-fill" style="width:${Math.min(c.lag,250)/250*100}%;background:${c.lag>50?"var(--red)":c.lag>10?"var(--orange)":"var(--green)"}"></div>
        </div>
        <span class="lag-val">${c.lag}</span>
      </div>
    </td>
    <td style="color:var(--muted)">${c.delivered.toLocaleString()}</td>
  </tr>`).join("");
}

// ─── Consumers Panel ────────────────────────────────────
function renderConsumers() {
  const filter = (document.getElementById("filter-proto") || {}).value || "";
  const list   = filter ? state.consumers.filter(c => c.proto === filter) : state.consumers;

  setText("c-active",  state.consumers.filter(c => c.status === "active").length);
  setText("c-lagging", state.consumers.filter(c => c.status === "lagging").length);
  setText("c-offline", state.consumers.filter(c => c.status === "offline").length);

  const tb = document.getElementById("cons-table"); if (!tb) return;
  tb.innerHTML = list.map(c => `<tr>
    <td style="font-family:monospace;color:var(--cyan);font-size:11px">${c.id}</td>
    <td>${c.service}</td>
    <td style="font-size:11px;color:var(--muted)">${c.topics}</td>
    <td>${protoBadge(c.proto)}</td>
    <td>${statusBadge(c.status)}</td>
    <td>
      <div class="lag-wrap">
        <div class="lag-track">
          <div class="lag-fill" style="width:${Math.min(c.lag,250)/250*100}%;background:${c.lag>50?"var(--red)":c.lag>10?"var(--orange)":"var(--green)"}"></div>
        </div>
        <span class="lag-val">${c.lag}</span>
      </div>
    </td>
    <td style="color:var(--muted)">${c.delivered.toLocaleString()}</td>
    <td><button class="btn danger" style="padding:3px 8px;font-size:11px" onclick="disconnectConsumer('${c.id}')">Disconnect</button></td>
  </tr>`).join("");
}

async function disconnectConsumer(id) {
  const res = await fetch(`/api/consumers/${id}`, { method: "DELETE" });
  if (res.ok) {
    toast(`Consumer ${id} disconnected`, "red");
    renderConsumers();
  }
}

function addConsumerModal() {
  document.getElementById("modal-overlay").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}
async function submitConsumer() {
  const body = {
    service: document.getElementById("m-service").value,
    topics:  document.getElementById("m-topics").value,
    proto:   document.getElementById("m-proto").value,
  };
  const res  = await fetch("/api/consumers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const c = await res.json();
    toast(`Consumer ${c.id} registered`, "green");
    closeModal();
    renderConsumers();
  }
}

// ─── Event Log ──────────────────────────────────────────
function renderLog() {
  const search = (document.getElementById("log-search")  || {}).value || "";
  const topic  = (document.getElementById("log-topic")   || {}).value || "";
  const status = (document.getElementById("log-status")  || {}).value || "";
  const q = search.toLowerCase();

  let list = state.events;
  if (topic)  list = list.filter(e => e.topic === topic);
  if (status) list = list.filter(e => e.status === status);
  if (q)      list = list.filter(e =>
    (e.id + e.topic + e.producer).toLowerCase().includes(q));

  const tb = document.getElementById("log-table"); if (!tb) return;
  tb.innerHTML = list.slice(0, 300).map(e => {
    const pri = e.priority === "HIGH"   ? "red"
              : e.priority === "MEDIUM" ? "orange" : "gray";
    const latColor = parseFloat(e.latency) > 2.5 ? "var(--orange)" : "var(--green)";
    return `<tr>
      <td style="font-family:monospace;color:var(--muted)">${e.seqId}</td>
      <td style="font-family:monospace;color:var(--cyan);font-size:10px">${e.id}</td>
      <td><span style="color:${TOPIC_COLORS[e.topic]||"var(--text)"}">${e.topic}</span></td>
      <td style="color:var(--muted)">${e.producer}</td>
      <td style="font-family:monospace;color:var(--muted);font-size:11px">${e.timestamp}</td>
      <td><span class="badge ${pri}" style="font-size:10px">${e.priority}</span></td>
      <td><span class="badge ${e.status==="ACK"?"green":"red"}" style="font-size:10px">${e.status}</span></td>
      <td style="color:${latColor}">${e.latency}ms</td>
      <td style="color:var(--muted)">${e.consumers}</td>
    </tr>`;
  }).join("");

  setText("log-count-badge", list.length.toLocaleString() + " events");
}
function clearLog() {
  state.events = [];
  renderLog();
  toast("Event log cleared", "blue");
}

// ─── Publish ────────────────────────────────────────────
async function publishEvent() {
  const topic    = document.getElementById("pub-topic").value;
  const type     = document.getElementById("pub-type").value;
  const priority = document.getElementById("pub-priority").value;
  const producer = document.getElementById("pub-producer").value;
  const rawPay   = document.getElementById("pub-payload").value;

  let payload;
  try { payload = JSON.parse(rawPay); }
  catch { toast("Invalid JSON payload", "red"); return; }

  const res = await fetch("/api/events", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ topic, priority, producer, payload }),
  });
  const data = await res.json();

  // Show response
  const respEl = document.getElementById("pub-response");
  if (respEl) respEl.innerHTML = syntaxHighlight(JSON.stringify(data, null, 2));

  // History
  const hist = document.getElementById("pub-history");
  if (hist) {
    const item = document.createElement("div");
    item.className = "pub-hist-item";
    item.innerHTML = `
      <span class="badge ${res.status === 201 ? "green":"red"}" style="font-size:10px">${res.status}</span>
      <span style="font-family:monospace;color:var(--cyan);font-size:10px">${data.eventId||"—"}</span>
      <span style="color:${TOPIC_COLORS[topic]||"var(--text)"}">${topic}</span>
      <span style="color:var(--muted);margin-left:auto">${data.latency_ms||"—"}ms</span>
    `;
    hist.prepend(item);
    while (hist.children.length > 30) hist.removeChild(hist.lastChild);
  }

  toast(`Event published to ${topic}`, "green");
}

const AUTO_PAYLOADS = {
  "order.created":      () => ({ orderId: "ORD-"+rnd(10000,99999), amount: +rnd(100,9999).toFixed(2), currency:"INR", customerId:"cust_"+rnd(100,999) }),
  "user.signup":        () => ({ userId: "usr_"+rnd(1000,9999), email:"user@example.com", plan: pick(["BASIC","PRO"]) }),
  "payment.processed":  () => ({ paymentId:"PAY-"+rnd(10000,99999), amount:+rnd(500,50000).toFixed(2), method:"UPI", status:"SUCCESS" }),
  "inventory.update":   () => ({ productId:"SKU-"+rnd(1000,9999), stock:rnd(0,1000), warehouse:"WH-CHENNAI" }),
  "notification.push":  () => ({ userId:"usr_"+rnd(1000,9999), message:"You have a new update", channel:"PUSH" }),
  "order.updated":      () => ({ orderId:"ORD-"+rnd(10000,99999), status: pick(["SHIPPED","DELIVERED","CANCELLED"]) }),
};
function autoFill() {
  const topic = document.getElementById("pub-topic").value;
  const gen   = AUTO_PAYLOADS[topic] || (() => ({ event: topic, data: "payload" }));
  document.getElementById("pub-payload").value = JSON.stringify(gen(), null, 2);
}

// ─── Replay ─────────────────────────────────────────────
let rpTimer = null, rpRunning = false, rpStart = 0, rpCur = 0, rpEnd = 0, rpErrors = 0;

function startReplay() {
  if (rpRunning) return;
  const from  = parseInt(document.getElementById("rp-from").value) || 0;
  const to    = parseInt(document.getElementById("rp-to").value)   || 100;
  const topic = document.getElementById("rp-topic").value;
  const speed = parseInt(document.getElementById("rp-speed").value) || 1;
  if (from >= to) { toast("Invalid range: from must be < to", "red"); return; }

  rpRunning = true; rpCur = from; rpEnd = to; rpStart = Date.now(); rpErrors = 0;
  setText("rp-count", 0); setText("rp-errors", 0); setText("rp-status", "Replaying…");
  document.getElementById("rp-start").disabled = true;
  document.getElementById("rp-stop").disabled  = false;
  document.getElementById("rp-log").innerHTML  = "";

  const interval = Math.max(30, 250 / speed);
  rpTimer = setInterval(() => {
    if (!rpRunning || rpCur > rpEnd) { stopReplay(); return; }
    const ok  = Math.random() > 0.015;
    if (!ok) rpErrors++;
    const topicVal = topic || ["order.created","user.signup","payment.processed"][rnd(0,2)];
    const log  = document.getElementById("rp-log");
    const item = document.createElement("div");
    item.className = "stream-item " + topicVal.split(".")[0];
    item.innerHTML = `
      <span class="ev-time" style="color:var(--muted);font-family:monospace">${rpCur}</span>
      <span class="ev-id">evt_${Math.random().toString(36).slice(2,10)}</span>
      <span class="ev-topic" style="color:${TOPIC_COLORS[topicVal]||"var(--text)"}">${topicVal}</span>
      <span class="badge ${ok?"green":"red"}" style="font-size:10px;margin-left:auto">${ok?"✓ OK":"✗ NACK"}</span>
    `;
    log.prepend(item);
    if (log.children.length > 60) log.removeChild(log.lastChild);

    const done  = rpCur - from + 1;
    const total = rpEnd - from + 1;
    const pct   = Math.round(done / total * 100);
    document.getElementById("rp-progress").style.width = pct + "%";
    setText("rp-done",    done + " / " + total);
    setText("rp-count",   done);
    setText("rp-errors",  rpErrors);
    setText("rp-elapsed", ((Date.now() - rpStart) / 1000).toFixed(1) + "s");
    rpCur++;
  }, interval);
}

function stopReplay() {
  rpRunning = false;
  if (rpTimer) { clearInterval(rpTimer); rpTimer = null; }
  setText("rp-status", "Complete");
  document.getElementById("rp-start").disabled = false;
  document.getElementById("rp-stop").disabled  = true;
  toast("Replay complete", "green");
}

// ─── Metrics ────────────────────────────────────────────
function updateMetricsKPIs() {
  setText("m-peak",   state.peakEps.toLocaleString());
  setText("m-total",  state.totalEvents.toLocaleString());
  setText("m-failed", state.totalErrors);
  setText("m-avg",    state.epsCnt > 0 ? Math.round(state.epsSum / state.epsCnt).toLocaleString() : 0);
}

function renderTopicStats() {
  const tb = document.getElementById("topic-stats-table"); if (!tb) return;
  const active = state.consumers.filter(c => c.status !== "offline").length;
  const counts = state.topicCounts;
  const rows = Object.entries(counts).map(([t, cnt]) => {
    const avgLat = (1.2 + Math.random() * 1.5).toFixed(1);
    const errs   = Math.round(cnt * 0.012);
    const errPct = cnt > 0 ? (errs / cnt * 100).toFixed(2) : "0.00";
    return `<tr>
      <td><span style="color:${TOPIC_COLORS[t]||"var(--text)"}">${t}</span></td>
      <td style="font-family:monospace">${cnt.toLocaleString()}</td>
      <td>${active}</td>
      <td style="color:${parseFloat(avgLat)>2.5?"var(--orange)":"var(--green)"}">${avgLat}ms</td>
      <td style="color:var(--red)">${errs}</td>
      <td style="color:${parseFloat(errPct)>1?"var(--red)":"var(--green)"}">${errPct}%</td>
    </tr>`;
  });
  tb.innerHTML = rows.join("");
}

// ─── Charts ─────────────────────────────────────────────
let epsChart = null, latChart = null;

function initCharts() {
  const chartDefaults = (data, color, label) => ({
    type: "line",
    data: {
      labels: Array(50).fill(""),
      datasets: [{
        data, label,
        borderColor:     color,
        borderWidth:     1.5,
        pointRadius:     0,
        fill:            true,
        backgroundColor: color.replace(")", ", 0.08)").replace("rgb", "rgba"),
        tension:         0.4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          grid:  { color: "rgba(255,255,255,0.04)" },
          ticks: { color: "#8b949e", font: { size: 10 } },
        },
      },
    },
  });
  const ec = document.getElementById("eps-chart");
  const lc = document.getElementById("lat-chart");
  if (ec) epsChart = new Chart(ec, chartDefaults([...state.epsHistory], "rgb(57,208,216)", "EPS"));
  if (lc) latChart = new Chart(lc, chartDefaults([...state.latHistory], "rgb(88,166,255)", "Latency"));
}

function updateCharts() {
  if (epsChart) {
    epsChart.data.datasets[0].data = [...state.epsHistory];
    epsChart.update("none");
  }
  if (latChart) {
    latChart.data.datasets[0].data = [...state.latHistory];
    latChart.update("none");
  }
}

// ─── Engine Toggle ───────────────────────────────────────
async function toggleEngine() {
  const res  = await fetch("/api/engine/toggle", { method: "POST" });
  const data = await res.json();
  state.engineOn = data.state === "running";
  updateEngineUI();
  toast(state.engineOn ? "Engine resumed" : "Engine paused", state.engineOn ? "green" : "orange");
}

function updateEngineUI() {
  const btn = document.getElementById("engine-toggle-btn");
  if (btn) btn.textContent = state.engineOn ? "⏸ Pause Engine" : "▶ Resume Engine";
  const hState = document.getElementById("h-engine-state");
  if (hState) hState.textContent = state.engineOn ? "Online" : "Paused";
}

// ─── Helpers ────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function statusBadge(s) {
  if (s === "active")  return '<span class="badge green"><span class="dot"></span>Active</span>';
  if (s === "lagging") return '<span class="badge orange"><span class="dot"></span>Lagging</span>';
  return '<span class="badge red"><span class="dot"></span>Offline</span>';
}
function protoBadge(p) {
  const map = { WebSocket: "blue", "REST Poll": "purple", Webhook: "gray" };
  return `<span class="badge ${map[p]||"gray"}">${p}</span>`;
}

function syntaxHighlight(json) {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    match => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) return `<span class="key">${match}</span>`;
        return `<span class="str">${match}</span>`;
      }
      if (/true|false/.test(match)) return `<span class="kw">${match}</span>`;
      return `<span class="num">${match}</span>`;
    }
  );
}

function toast(msg, type = "blue") {
  const colors = { green:"var(--green)", red:"var(--red)", blue:"var(--blue)", orange:"var(--orange)", cyan:"var(--cyan)" };
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<div style="width:6px;height:6px;border-radius:50%;background:${colors[type]||colors.blue};flex-shrink:0"></div>${msg}`;
  document.getElementById("toast-container").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 350); }, 3000);
}

// ─── Init ────────────────────────────────────────────────
setTimeout(initCharts, 200);
connectSSE();
// Auto-fill payload on topic change
document.getElementById("pub-topic").addEventListener("change", autoFill);
