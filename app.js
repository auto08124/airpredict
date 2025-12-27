// =========================
// CONFIG
// =========================
const DATABASE_URL = "https://airpredict-ai-default-rtdb.asia-southeast1.firebasedatabase.app";
const PROVINCES = ["กาฬสินธุ์", "ขอนแก่น", "มหาสารคาม", "ร้อยเอ็ด"];
const DAYS = 7;

// =========================
// Utils
// =========================
function $(id){ return document.getElementById(id); }

function getCssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// =========================
// THEME TOGGLE (Switch) ✅
// =========================
function applyTheme(mode){
  document.documentElement.setAttribute("data-theme", mode);
  localStorage.setItem("theme", mode);

  const isDark = mode === "dark";
  const themeSwitch = $("themeSwitch");
  const toggleLabel = $("toggleLabel");

  if (themeSwitch) themeSwitch.checked = isDark;
  if (toggleLabel) toggleLabel.textContent = isDark ? "Dark" : "Light";

  document.body.classList.remove("theme-fade");
  void document.body.offsetWidth;
  document.body.classList.add("theme-fade");

  updateChartTheme();
}

function initTheme(){
  applyTheme(localStorage.getItem("theme") || "dark");
  const themeSwitch = $("themeSwitch");
  if (themeSwitch){
    themeSwitch.addEventListener("change", () => {
      applyTheme(themeSwitch.checked ? "dark" : "light");
    });
  }
}

// =========================
// AQI Helpers
// =========================
function aqiToCategory(aqi){
  const x = Number(aqi);
  if (!Number.isFinite(x)) return {name:"-", color:"rgba(148,163,184,0.85)", advice:"—"};
  if (x <= 50)  return {name:"Good", color:"rgba(16,185,129,0.85)", advice:"อากาศดี เหมาะกับกิจกรรมกลางแจ้ง"};
  if (x <= 100) return {name:"Moderate", color:"rgba(245,158,11,0.85)", advice:"ปานกลาง คนแพ้ง่ายควรระวัง"};
  if (x <= 150) return {name:"Unhealthy (Sensitive)", color:"rgba(249,115,22,0.85)", advice:"กลุ่มเสี่ยงควรลดกิจกรรมกลางแจ้ง/ใส่หน้ากาก"};
  if (x <= 200) return {name:"Unhealthy", color:"rgba(239,68,68,0.85)", advice:"อากาศแย่ ควรหลีกเลี่ยงกิจกรรมกลางแจ้ง"};
  if (x <= 300) return {name:"Very Unhealthy", color:"rgba(168,85,247,0.85)", advice:"อันตรายมาก ควรอยู่ในอาคาร/ใช้เครื่องฟอก"};
  return {name:"Hazardous", color:"rgba(127,29,29,0.9)", advice:"อันตรายสูงมาก ควรหลีกเลี่ยงออกนอกอาคาร"};
}

function badgeClassByAqi(aqi){
  const x = Number(aqi);
  if (!Number.isFinite(x)) return "";
  if (x <= 50)  return "excellent";
  if (x <= 100) return "moderate";
  if (x <= 150) return "unhealthy-sensitive";
  return "unhealthy";
}

function setLastUpdate(text){
  $("lastUpdatePill").textContent = "● " + text;
}

// =========================
// Firebase REST fetch
// =========================
function fbUrl(path){
  const segs = path.split("/").map(s => encodeURIComponent(s));
  return `${DATABASE_URL}/${segs.join("/")}.json`;
}

async function fetchJson(path){
  const res = await fetch(fbUrl(path), {cache:"no-store"});
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}

// =========================
// PM2.5 -> AQI (fallback)
/// =========================
function pm25ToAqi(pm25){
  const c = Number(pm25);
  if (!Number.isFinite(c)) return null;

  const bp = [
    {c1:0.0,   c2:12.0,   i1:0,   i2:50},
    {c1:12.1,  c2:35.4,   i1:51,  i2:100},
    {c1:35.5,  c2:55.4,   i1:101, i2:150},
    {c1:55.5,  c2:150.4,  i1:151, i2:200},
    {c1:150.5, c2:250.4,  i1:201, i2:300},
    {c1:250.5, c2:350.4,  i1:301, i2:400},
    {c1:350.5, c2:500.4,  i1:401, i2:500},
  ];

  const row = bp.find(r => c >= r.c1 && c <= r.c2);
  if (!row) return c < 0 ? null : 500;

  return Math.round(((row.i2-row.i1)/(row.c2-row.c1))*(c-row.c1)+row.i1);
}

// =========================
// Time helpers (daily average)
// =========================
function toLocalDateKey(d){
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseTimeFromKeyOrValue(k, v){
  if (v && v.ts){
    const dt = new Date(v.ts);
    if (!isNaN(dt.getTime())) return dt;
  }
  const d1 = new Date(k);
  if (!isNaN(d1.getTime())) return d1;

  const d2 = new Date(String(k).replace(" ", "T"));
  if (!isNaN(d2.getTime())) return d2;

  return null;
}

function lastNDaysDateKeys(n){
  const keys = [];
  const today = new Date();
  today.setHours(0,0,0,0);
  for (let i = n-1; i >= 0; i--){
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    keys.push(toLocalDateKey(d));
  }
  return keys;
}

function dailyAverageFromHistory(historyObj){
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - (DAYS-1));
  start.setHours(0,0,0,0);

  const buckets = new Map();

  for (const [k,v] of Object.entries(historyObj || {})){
    const t = parseTimeFromKeyOrValue(k, v);
    if (!t) continue;
    if (t < start) continue;

    const pm25 = Number(v?.pm25 ?? v?.PM25);
    let aqi = Number(v?.aqi ?? v?.AQI);
    if (!Number.isFinite(aqi)) aqi = pm25ToAqi(pm25);

    if (!Number.isFinite(pm25) && !Number.isFinite(aqi)) continue;

    const dayKey = toLocalDateKey(t);
    if (!buckets.has(dayKey)){
      buckets.set(dayKey, {sumPm25:0,sumAqi:0,cPm25:0,cAqi:0});
    }
    const b = buckets.get(dayKey);

    if (Number.isFinite(pm25)){ b.sumPm25 += pm25; b.cPm25++; }
    if (Number.isFinite(aqi)){  b.sumAqi  += aqi;  b.cAqi++; }
  }

  return lastNDaysDateKeys(DAYS).map(dayKey => {
    const b = buckets.get(dayKey);
    return {
      dayKey,
      avgPm25: b && b.cPm25 ? (b.sumPm25 / b.cPm25) : null,
      avgAqi : b && b.cAqi  ? (b.sumAqi  / b.cAqi)  : null
    };
  });
}

// =========================
// Chart
// =========================
function updateChartTheme(){
  if(!window.chart) return;

  window.chart.options.plugins.legend.labels.color = getCssVar("--text");
  window.chart.options.scales.x.ticks.color = getCssVar("--muted");
  window.chart.options.scales.y.ticks.color = getCssVar("--muted");
  window.chart.options.scales.y2.ticks.color = getCssVar("--muted");

  window.chart.update();
}

// ===== 1) Linear Regression Prediction (ง่าย + ดูเป็น AI) =====
function linearRegressionPredictNext(y){
  const n = y.length;
  if(n < 2) return y[n-1] ?? 0;

  let sumX=0, sumY=0, sumXY=0, sumXX=0;
  for(let i=0;i<n;i++){
    sumX += i;
    sumY += y[i];
    sumXY += i*y[i];
    sumXX += i*i;
  }
  const denom = (n*sumXX - sumX*sumX) || 1e-9;
  const m = (n*sumXY - sumX*sumY) / denom;
  const b = (sumY - m*sumX) / n;

  const nextX = n;
  return m*nextX + b;
}

// ===== 2) RMSE แบบ backtest ง่ายๆ =====
function backtestRMSE(y){
  const n = y.length;
  if(n < 4) return null;

  const preds = [];
  const trues = [];
  for(let i=2;i<n;i++){
    const hist = y.slice(0,i);
    const p = linearRegressionPredictNext(hist);
    preds.push(p);
    trues.push(y[i]);
  }

  let mse = 0;
  for(let i=0;i<preds.length;i++){
    const e = preds[i] - trues[i];
    mse += e*e;
  }
  mse /= preds.length;
  return Math.sqrt(mse);
}

// ===== 3) Confidence =====
function rmseToConfidence(rmse, y){
  if(rmse == null) return null;
  const mean = y.reduce((a,b)=>a+b,0)/y.length;
  const ratio = rmse / Math.max(mean, 1);
  const conf = Math.max(0, Math.min(100, 100 * (1 - ratio)));
  return conf;
}

// ===== 4) Trend text =====
function trendText(pred, last){
  const diff = pred - last;
  if(Math.abs(diff) < 1.0) return "แนวโน้มทรงตัว";
  return diff > 0 ? "แนวโน้มเพิ่มขึ้น" : "แนวโน้มลดลง";
}

// ===== 5) Health advice by AQI =====
function aqiAdvice(aqi){
  if(aqi <= 50) return { cls:"advice-good", text:"🟢 Good: ออกกำลังกายกลางแจ้งได้ตามปกติ" };
  if(aqi <= 100) return { cls:"advice-moderate", text:"🟡 Moderate: เด็ก/ผู้สูงอายุ/ผู้ป่วย ควรลดกิจกรรมกลางแจ้ง และสังเกตอาการ" };
  if(aqi <= 150) return { cls:"advice-unhealthy", text:"🔴 Unhealthy: ควรหลีกเลี่ยงกิจกรรมกลางแจ้ง ใส่หน้ากาก N95 หากจำเป็นต้องออกนอกบ้าน" };
  return { cls:"advice-unhealthy", text:"🔴 Very Unhealthy: ควรอยู่ในอาคาร ปิดช่องลม ใช้เครื่องฟอกอากาศถ้ามี และใส่ N95 เมื่อต้องออกไป" };
}

// ===== 6) Highlight PM2.5 vs WHO/Thai =====
const WHO_24H = 15;
const THAI_24H = 37;

function applyPm25Highlight(pm25){
  const el = document.getElementById("latestPm25");
  if(!el) return;

  el.classList.remove("value-ok","value-who","value-thai");
  if(pm25 >= THAI_24H) el.classList.add("value-thai");
  else if(pm25 >= WHO_24H) el.classList.add("value-who");
  else el.classList.add("value-ok");
}

function buildThresholdLineDataset(labels, value, label){
  return {
    type: "line",
    label,
    data: labels.map(()=>value),
    borderWidth: 2,
    pointRadius: 0,
    borderDash: [6,6],
    yAxisID: "y",
    tension: 0
  };
}

function updateAIAndAdvice(labels, pm25Series, aqiSeries){
  const lastPM = pm25Series[pm25Series.length-1] ?? 0;
  const lastAQI = aqiSeries[aqiSeries.length-1] ?? 0;

  const pred = linearRegressionPredictNext(pm25Series);
  const predClamped = Math.max(0, pred);

  const rmse = backtestRMSE(pm25Series);
  const conf = rmseToConfidence(rmse, pm25Series);

  $("ai_pred_pm25").textContent = `${predClamped.toFixed(1)} µg/m³`;
  $("ai_pred_note").textContent =
    `AI คาดการณ์พรุ่งนี้: ${predClamped.toFixed(1)} µg/m³ (${trendText(predClamped, lastPM)})`;

  $("ai_rmse").textContent = rmse == null ? "--" : rmse.toFixed(2);
  $("ai_conf").textContent = conf == null ? "--" : `${conf.toFixed(0)}%`;

  const adv = aqiAdvice(lastAQI);
  const advEl = $("health_advice");
  advEl.className = adv.cls;
  advEl.textContent = adv.text;

  applyPm25Highlight(lastPM);
}

function drawDailyChart(series){
  const labels = series.map(x => x.dayKey.slice(5)); // MM-DD
  const pm25Vals = series.map(x => (Number.isFinite(x.avgPm25) ? Number(x.avgPm25.toFixed(1)) : null));
  const aqiVals  = series.map(x => (Number.isFinite(x.avgAqi)  ? Number(x.avgAqi.toFixed(0))  : null));
  const colors = series.map(x => aqiToCategory(x.avgAqi).color);

  const ctx = $("pm25Chart").getContext("2d");

  const data = {
    labels,
    datasets: [
      { type:"bar",  label:"PM2.5 (Avg/day)", data: pm25Vals, borderWidth:0, backgroundColor: colors },
      { type:"line", label:"AQI (Avg/day)",  data: aqiVals,  yAxisID:"y2", tension:0.25, pointRadius:3, borderWidth:2,
        borderColor: getCssVar("--line") || "rgba(148,163,184,0.9)" },

      buildThresholdLineDataset(labels, WHO_24H, "WHO 24h (15)"),
      buildThresholdLineDataset(labels, THAI_24H, "TH Standard (37)")
    ]
  };

  const options = {
    responsive: true,
    animation: false,
    plugins: {
      legend: { labels: { color: getCssVar("--text") } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const v = ctx.parsed.y;
            const name = ctx.dataset.label || "";
            if(name.includes("PM2.5")) return `${name}: ${v?.toFixed?.(1) ?? v} µg/m³`;
            if(name.includes("AQI"))   return `${name}: ${Math.round(v)}`;
            if(name.includes("WHO") || name.includes("TH")) return `${name}: ${v} µg/m³`;
            return `${name}: ${v}`;
          }
        }
      }
    },
    scales: {
      x: { ticks: { color: getCssVar("--muted") } },
      y: { title: { display:true, text:"PM2.5 (µg/m³)" }, ticks: { color: getCssVar("--muted") } },
      y2:{ position:"right", grid:{ drawOnChartArea:false }, title:{ display:true, text:"AQI" }, ticks:{ color: getCssVar("--muted") } }
    }
  };

  if (!window.chart){
    window.chart = new Chart(ctx, { data, options });
  } else {
    window.chart.data = data;
    window.chart.options = options;
    window.chart.update("none");
  }
}

// =========================
// UI update
// =========================
function renderLatest(province, latest){
  const pm25 = latest?.pm25 ?? latest?.PM25;
  let aqi = latest?.aqi ?? latest?.AQI;
  if (!Number.isFinite(Number(aqi))) aqi = pm25ToAqi(pm25);

  const ts = latest?.ts;

  $("metaProvince").textContent = province || "-";
  $("metaLevel").textContent = latest?.level ?? latest?.Level ?? "-";

  $("latestPm25").textContent = Number.isFinite(Number(pm25)) ? Number(pm25).toFixed(1) : "-";
  $("latestAqi").textContent  = Number.isFinite(Number(aqi))  ? Number(aqi).toFixed(0)  : "-";
  $("latestTime").textContent = ts ? new Date(ts).toLocaleString() : "-";

  const cat = aqiToCategory(aqi);
  const badge = $("levelBadge");
  badge.className = "badge " + (badgeClassByAqi(aqi) || "");
  badge.innerHTML = `<span class="dot" style="color:${cat.color}"></span><span>${cat.name}</span>`;
  $("adviceText").textContent = cat.advice;
}

// =========================
// Main load
// =========================
async function loadProvince(pv){
  try{
    setLastUpdate("กำลังโหลด…");

    const [latest, history] = await Promise.all([
      fetchJson(`airpredict/provinces/${pv}/latest`),
      fetchJson(`airpredict/provinces/${pv}/history`)
    ]);

    renderLatest(pv, latest || {});
    const series = dailyAverageFromHistory(history || {});
    drawDailyChart(series);

    const pm25Series = series.map(x => (Number.isFinite(x.avgPm25) ? x.avgPm25 : null)).filter(v => v != null);
    const aqiSeries  = series.map(x => (Number.isFinite(x.avgAqi)  ? x.avgAqi  : null)).filter(v => v != null);
    updateAIAndAdvice(series.map(x=>x.dayKey), pm25Series, aqiSeries);

    setLastUpdate("โหลดล่าสุด: " + new Date().toLocaleTimeString());
  }catch(err){
    console.error(err);
    setLastUpdate("โหลดไม่สำเร็จ (เช็ค Rules/Path)");
    alert("โหลดข้อมูลไม่ได้: " + err.message + "\n\nเช็คว่า Firebase Rules อนุญาตอ่าน และ Path ถูกต้อง");
  }
}

// =========================
// REALTIME PMS5003 (Firebase SDK) ✅ เพิ่มใหม่
// =========================
let lastRealtimeMs = 0;
const OFFLINE_MS = 8000; // ถ้าไม่อัปเดตเกิน 10 วิ → ถือว่าไม่ได้ต่อบอร์ด
let realtimeTimer = null;

function showRealtimeBox(show){
  const box = $("realtimeBox");
  if (!box) return;
  box.style.display = show ? "" : "none"; // "" = ใช้ค่าเดิมจาก CSS
}

function setRealtimeOffline(){
  $("rtPm25").textContent = "--";
  $("rtTime").textContent = "อัปเดต: --";
  showRealtimeBox(false); // ✅ offline แล้วซ่อน
}

function listenRealtimePMS5003(){
  // ต้องมี Firebase จาก index.html ก่อน
  if (!window.__fb){
    console.warn("Firebase not ready yet");
    return;
  }

  const { db, ref, onValue } = window.__fb;

  // ✅ ดึง realtime จาก  Firebase
  const rtRef = ref(db, "airpredict/pms5003/latest");

  // เริ่มต้นให้ซ่อนไว้ก่อน จนกว่าจะมีข้อมูล
  setRealtimeOffline();

  onValue(rtRef, (snap) => {
    const v = snap.val();
    if (!v){
      setRealtimeOffline();
      return;
    }

    // รองรับหลายชื่อ field
    const pm25 = Number(v.pm25 ?? v.PM25 ?? v.pm2_5 ?? v.PM2_5);

    // ts จาก Arduino เป็น ISO string (เช่น 2025-12-27T16:20:10)
    const tsRaw = v.ts ?? v.timestamp ?? null;
    const tsMs = tsRaw ? new Date(tsRaw).getTime() : Date.now();

    if (Number.isFinite(pm25)){
      $("rtPm25").textContent = pm25.toFixed(1);
      $("rtTime").textContent = "อัปเดต: " + new Date(tsMs).toLocaleTimeString("th-TH");
      showRealtimeBox(true); // ✅ online แล้วแสดง
      lastRealtimeMs = Date.now();
    } else {
      // ถ้า field ไม่ใช่ตัวเลขก็ถือว่า offline
      setRealtimeOffline();
    }
  });

  // ✅ ตรวจ offline ทุก 5 วิ
  if (realtimeTimer) clearInterval(realtimeTimer);
  realtimeTimer = setInterval(() => {
    if (!lastRealtimeMs) return;
    if (Date.now() - lastRealtimeMs > OFFLINE_MS){
      setRealtimeOffline();
    }
  }, 3000);
}

// =========================
// init
// =========================
function init(){
  // theme
  initTheme();

  // provinces
  const provinceSelect = $("provinceSelect");
  PROVINCES.forEach(pv=>{
    const opt = document.createElement("option");
    opt.value = pv; opt.textContent = pv;
    provinceSelect.appendChild(opt);
  });

  provinceSelect.addEventListener("change", () => loadProvince(provinceSelect.value));
  $("refreshBtn").addEventListener("click", () => loadProvince(provinceSelect.value));

  loadProvince(PROVINCES[0]);

  // ✅ realtime ต้องรอ firebase-ready (มาจาก index.html)
  window.addEventListener("firebase-ready", () => {
    listenRealtimePMS5003();
  });

  // เผื่อบางครั้ง firebase-ready มาก่อน DOM โหลด
  if (window.__fb){
    listenRealtimePMS5003();
  }
}

document.addEventListener("DOMContentLoaded", init);
