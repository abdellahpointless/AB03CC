/** Builds the self-contained HTML page that shows the reference plan next to the app's plan. */

export interface ScheduleView {
  /** [machineIndex, jobIndex, start, end, setupBefore, moduleIndex, closesModule(0|1), measured(0|1), qty] */
  jobs: number[][];
}

export interface ModuleRow {
  id: string;
  customer: string;
  parts: number;
  work: number;
  appEnd: number;
  bestEnd: number;
}

export interface ReportData {
  title: string;
  subtitle: string;
  source: string;
  machines: string[];
  jobBoxes: string[];
  jobMaterials: string[];
  jobMatnr: string[];
  modules: ModuleRow[];
  perfect: ScheduleView;
  app: ScheduleView;
  dayLen: number;
  shiftStartHour: number;
  dayLabels: string[];
  /** disruptions both schedules had to work around: [machineIndex, startMinute, endMinute] */
  downtime: number[][];
  summary: {
    app: Summary;
    perfect: Summary;
    lowerBound: number;
  };
  notes: string[];
}

export interface Summary {
  sumC: number;
  avgC: number;
  medianC: number;
  makespan: number;
  setupTotal: number;
  busyPercent: number;
  /** parts that finish after their production date */
  lateParts: number;
  /** modules finished by the end of working day 1..N */
  byDay: number[];
  /** minute by which 25 / 50 / 75 / 100 percent of the modules are finished */
  quartiles: number[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildReportHtml(data: ReportData): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<title>Perfect Timeline Comparison</title>
<style>
:root {
  color-scheme: dark;
  --bg: #0b1120;
  --surface: #111a2e;
  --surface-2: #17223a;
  --line: #243049;
  --grid: #1c2740;
  --fg: #e6ebf5;
  --fg-2: #a8b3c9;
  --fg-3: #7685a3;
  --accent: #5aa0ff;
  --accent-2: #f0b04a;
  --good: #3fb68b;
  --bad: #ef6b6b;
  --ramp-early: #c4dcff;
  --ramp-late: #2f6cba;
  --block-ink: #07101f;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
    --bg: #f4f6fb; --surface: #ffffff; --surface-2: #eef2fa; --line: #d5dcec; --grid: #e6ebf6;
    --fg: #14213d; --fg-2: #4a5878; --fg-3: #6f7d9c; --accent: #1d63d6; --accent-2: #b5710a;
    --good: #12805c; --bad: #c43d3d; --ramp-early: #174fa8; --ramp-late: #8fb4ee; --block-ink: #ffffff;
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f4f6fb; --surface: #ffffff; --surface-2: #eef2fa; --line: #d5dcec; --grid: #e6ebf6;
  --fg: #14213d; --fg-2: #4a5878; --fg-3: #6f7d9c; --accent: #1d63d6; --accent-2: #b5710a;
  --good: #12805c; --bad: #c43d3d; --ramp-early: #174fa8; --ramp-late: #8fb4ee; --block-ink: #ffffff;
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font: 14px/1.5 var(--sans); padding-inline: 16px; padding-block: 20px 48px; }
.wrap { max-width: 1440px; margin-inline: auto; display: grid; gap: 18px; }
h1 { font-size: 22px; line-height: 1.2; margin: 0; letter-spacing: -0.01em; text-wrap: balance; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-2); margin: 0 0 10px; }
p { margin: 0; }
.sub { color: var(--fg-2); max-width: 78ch; margin-top: 6px; }
.src { color: var(--fg-3); font-size: 12px; margin-top: 4px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px; min-width: 0; }
.verdict { font-size: 15px; max-width: 86ch; }
.verdict b { color: var(--accent); font-weight: 650; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; min-width: 0; }
.tile .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--fg-3); }
.tile .v { font-size: 26px; font-weight: 650; margin-top: 4px; font-variant-numeric: tabular-nums; }
.tile .v small { font-size: 13px; font-weight: 500; color: var(--fg-2); margin-left: 4px; }
.tile .cmp { display: flex; gap: 14px; margin-top: 6px; font-size: 12px; color: var(--fg-2); flex-wrap: wrap; }
.tile .cmp span b { color: var(--fg); font-weight: 600; font-variant-numeric: tabular-nums; }
.delta-good { color: var(--good); font-weight: 600; }
.delta-bad { color: var(--bad); font-weight: 600; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--fg-2); margin-bottom: 8px; }
.legend i { display: inline-block; width: 18px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 6px; }
svg text { fill: var(--fg-3); font: 11px var(--sans); }
#curve { width: 100%; height: auto; display: block; }
.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.toolbar button { background: var(--surface-2); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; font: inherit; cursor: pointer; }
.toolbar button:hover { border-color: var(--accent); }
.toolbar .hint { color: var(--fg-3); font-size: 12px; margin-left: auto; }
.gantt-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
.gantt { position: relative; min-width: 100%; }
.axis { position: relative; height: 40px; border-bottom: 1px solid var(--line); background: var(--surface); }
.axis .t { position: absolute; bottom: 0; height: 20px; border-left: 1px solid var(--grid); padding: 4px 0 0 4px; font-size: 10px; color: var(--fg-3); white-space: nowrap; }
.axis .d { position: absolute; top: 0; height: 20px; border-left: 1px solid var(--fg-3); padding: 3px 0 0 5px; font-size: 11px; font-weight: 600; color: var(--fg-2); white-space: nowrap; }
.lane { position: relative; height: 46px; border-bottom: 1px solid var(--grid); }
.lane .name { position: sticky; left: 0; z-index: 3; display: inline-flex; align-items: center; height: 100%; width: 104px; padding-left: 10px; font-size: 12px; font-weight: 600; background: linear-gradient(90deg, var(--bg) 78%, transparent); color: var(--fg-2); }
.lane .day-line { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--grid); }
.blk { position: absolute; top: 6px; height: 34px; border-radius: 4px; overflow: hidden; cursor: default; color: var(--block-ink); font-size: 10px; line-height: 34px; padding-inline: 4px; white-space: nowrap; border: 1px solid transparent; transition: opacity 0.12s; }
.blk.close { border-color: var(--fg); box-shadow: 0 0 0 1px var(--bg) inset; }
.blk.est::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 5px; height: 5px; border-radius: 50%; border: 1px solid var(--block-ink); opacity: 0.55; }
.blk.mea::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--block-ink); opacity: 0.55; }
.down { position: absolute; top: 0; bottom: 0; z-index: 2; pointer-events: none; border-inline: 1px solid var(--bad); background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--bad) 60%, transparent) 0 3px, transparent 3px 7px); }
.setup { position: absolute; top: 14px; height: 18px; background: repeating-linear-gradient(45deg, var(--fg-3) 0 2px, transparent 2px 5px); opacity: 0.45; border-radius: 3px; }
.gantt.dim .blk:not(.hl) { opacity: 0.22; }
.flag { position: absolute; top: 1px; height: 11px; line-height: 11px; font-size: 9px; padding-inline: 3px; border-radius: 3px; background: var(--fg); color: var(--bg); z-index: 2; pointer-events: none; font-variant-numeric: tabular-nums; }
.tip { position: fixed; z-index: 20; pointer-events: none; max-width: 300px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.tip b { font-size: 13px; }
.tip dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 6px 0 0; color: var(--fg-2); }
.tip dd { margin: 0; color: var(--fg); font-variant-numeric: tabular-nums; }
.tablewrap { overflow: auto; max-height: 440px; border: 1px solid var(--line); border-radius: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 640px; }
th { position: sticky; top: 0; background: var(--surface-2); text-align: left; padding: 7px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-2); }
td { padding: 6px 10px; border-top: 1px solid var(--grid); font-variant-numeric: tabular-nums; }
tr:hover td { background: var(--surface-2); }
td.num, th.num { text-align: right; }
.notes { color: var(--fg-2); font-size: 12px; display: grid; gap: 4px; }
.mono { font-family: var(--mono); }
@media (max-width: 640px) { .tile .v { font-size: 22px; } }
</style>
<div class="wrap">
  <header>
    <h1>${esc(data.title)}</h1>
    <p class="sub">${esc(data.subtitle)}</p>
    <p class="src">${esc(data.source)}</p>
  </header>
  <section class="card"><p class="verdict" id="verdict"></p></section>
  <section class="tiles" id="tiles"></section>
  <section class="card">
    <h2>Master orders finished over time</h2>
    <div class="legend"><span><i style="background:var(--accent)"></i>Perfect timeline</span><span><i style="background:var(--accent-2)"></i>What the app planned</span></div>
    <svg id="curve" viewBox="0 0 1000 330" role="img" aria-label="Cumulative master orders finished, perfect timeline versus app plan"></svg>
  </section>
  <section class="card">
    <h2>Perfect timeline</h2>
    <div class="toolbar"><button data-z="out" aria-label="Zoom out">−</button><button data-z="in" aria-label="Zoom in">+</button><button data-z="fit">Fit width</button><span class="hint">Colour = when the box's master order finishes (light = early). Outlined box = the one that closes its order. Hatched red = a disruption both plans had to work around. Hover to follow an order.</span></div>
    <div class="gantt-scroll" id="scrollA"><div class="gantt" id="ganttA"></div></div>
  </section>
  <section class="card">
    <h2>What the app planned (same scale)</h2>
    <div class="gantt-scroll" id="scrollB"><div class="gantt" id="ganttB"></div></div>
  </section>
  <section class="card">
    <h2>Every master order</h2>
    <div class="tablewrap"><table id="mods"><thead><tr><th>Master order</th><th>Customer</th><th class="num">Parts</th><th class="num">Work (min)</th><th class="num">Perfect done</th><th class="num">App done</th><th class="num">App later by</th></tr></thead><tbody></tbody></table></div>
  </section>
  <section class="card notes" id="notes"></section>
</div>
<div class="tip" id="tip" hidden></div>
<script>
const D = ${json};
const $ = s => document.querySelector(s);
const fmtInt = n => Math.round(n).toLocaleString('en-US');
const hours = m => (m / 60).toFixed(1) + ' h';
function clock(min, asEnd) {
  let day = Math.floor(min / D.dayLen), within = min - day * D.dayLen;
  if (asEnd && within === 0 && day > 0) { day -= 1; within = D.dayLen; }
  const h = D.shiftStartHour + Math.floor(within / 60), m = Math.round(within % 60);
  return (D.dayLabels[day] || 'Day ' + (day + 1)) + ' ' + String(h % 24).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
const S = D.summary;
const pct = (a, b) => ((a - b) / b * 100);
function good(x) { return '<span class="delta-good">' + x + '</span>'; }

/* ---------- headline ---------- */
(function head() {
  const imp = pct(S.app.avgC, S.perfect.avgC);
  const gain = (S.app.sumC - S.perfect.sumC) / S.app.sumC * 100;
  const d2 = S.perfect.byDay[1] - S.app.byDay[1];
  $('#verdict').innerHTML = 'The perfect timeline finishes the average master order in <b>' + hours(S.perfect.avgC) + '</b> instead of <b>' + hours(S.app.avgC) + '</b> (' + gain.toFixed(1) + '% sooner). After two working days it has <b>' + S.perfect.byDay[1] + '</b> orders done against ' + S.app.byDay[1] + (d2 > 0 ? ' (+' + d2 + ')' : '') + '. Changeover time is ' + fmtInt(S.perfect.setupTotal) + ' min against ' + fmtInt(S.app.setupTotal) + ' min, and the last machine finishes at ' + hours(S.perfect.makespan) + ' against ' + hours(S.app.makespan) + '.';
  const tiles = [
    ['Average master order finished at', hours(S.perfect.avgC), hours(S.app.avgC), gain, 'sooner'],
    ['Orders finished after day 2', S.perfect.byDay[1], S.app.byDay[1], S.perfect.byDay[1] - S.app.byDay[1], 'count'],
    ['Half of all orders finished by', hours(S.perfect.quartiles[1]), hours(S.app.quartiles[1]), (S.app.quartiles[1] - S.perfect.quartiles[1]) / S.app.quartiles[1] * 100, 'sooner'],
    ['Total changeover time', fmtInt(S.perfect.setupTotal) + ' min', fmtInt(S.app.setupTotal) + ' min', (S.app.setupTotal - S.perfect.setupTotal) / S.app.setupTotal * 100, 'less'],
    ['Last machine finishes', hours(S.perfect.makespan), hours(S.app.makespan), (S.app.makespan - S.perfect.makespan) / S.app.makespan * 100, 'sooner'],
    ['Parts finishing after their production date', S.perfect.lateParts, S.app.lateParts, S.app.lateParts - S.perfect.lateParts, 'late'],
  ];
  $('#tiles').innerHTML = tiles.map(t => {
    const better = t[4] === 'count' || t[4] === 'late' ? t[3] > 0 : t[3] > 0.05;
    const label = t[4] === 'late' ? (t[3] > 0 ? t[3] + ' fewer than the app' : t[3] < 0 ? '<span class="delta-bad">' + (-t[3]) + ' more than the app</span>' : 'same as the app') : !better ? 'same as the app' : t[4] === 'count' ? '+' + t[3] + ' orders more than the app' : t[3].toFixed(1) + '% ' + t[4] + ' than the app';
    return '<div class="tile"><div class="k">' + t[0] + '</div><div class="v">' + t[1] + '</div><div class="cmp"><span>App <b>' + t[2] + '</b></span><span>' + (better ? good(label) : label.indexOf('delta-bad') > 0 ? label : '<span>' + label + '</span>') + '</span></div></div>';
  }).join('');
})();

/* ---------- cumulative curve ---------- */
(function curve() {
  const svg = $('#curve'), W = 1000, H = 330, L = 44, R = 18, T = 14, B = 34;
  const M = D.modules.length;
  const tmax = Math.ceil(Math.max(S.app.makespan, S.perfect.makespan) / 60 / 4) * 4 * 60;
  const x = t => L + t / tmax * (W - L - R), y = c => T + (1 - c / M) * (H - T - B);
  const ends = k => D.modules.map(m => m[k]).sort((a, b) => a - b);
  const path = k => {
    const e = ends(k); let d = 'M' + x(0) + ' ' + y(0);
    e.forEach((t, i) => { d += 'L' + x(t) + ' ' + y(i) + 'L' + x(t) + ' ' + y(i + 1); });
    return d + 'L' + x(tmax) + ' ' + y(M);
  };
  let g = '';
  for (let c = 0; c <= M; c += (M > 60 ? 10 : 5)) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(c) + '" y2="' + y(c) + '" stroke="var(--grid)"/><text x="' + (L - 8) + '" y="' + (y(c) + 4) + '" text-anchor="end">' + c + '</text>';
  for (let t = 0; t <= tmax; t += D.dayLen) { const di = t / D.dayLen; g += '<line x1="' + x(t) + '" x2="' + x(t) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--grid)"/><text x="' + (x(t) + 4) + '" y="' + (H - 14) + '">' + (D.dayLabels[di] || '') + '</text>'; }
  g += '<path d="' + path('appEnd') + '" fill="none" stroke="var(--accent-2)" stroke-width="2" stroke-linejoin="round"/>';
  g += '<path d="' + path('bestEnd') + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>';
  g += '<line id="cross" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--fg-3)" visibility="hidden"/><g id="crossTxt"></g><rect id="hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent"/>';
  svg.innerHTML = g;
  const count = (k, t) => D.modules.filter(m => m[k] <= t + 1e-9).length;
  const hit = $('#hit'), cross = $('#cross'), tip = $('#tip');
  hit.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
    const t = Math.max(0, Math.min(tmax, (px - L) / (W - L - R) * tmax));
    cross.setAttribute('x1', x(t)); cross.setAttribute('x2', x(t)); cross.setAttribute('visibility', 'visible');
    const a = count('appEnd', t), b = count('bestEnd', t);
    tip.hidden = false;
    tip.innerHTML = '<b>' + clock(Math.round(t)) + '</b><dl><dt>Perfect</dt><dd>' + b + ' orders done</dd><dt>App</dt><dd>' + a + ' orders done</dd><dt>Difference</dt><dd>' + (b - a >= 0 ? '+' : '') + (b - a) + '</dd></dl>';
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - 320) + 'px'; tip.style.top = (ev.clientY + 14) + 'px';
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
})();

/* ---------- gantt ---------- */
const modOrder = (k) => { const idx = D.modules.map((m, i) => i).sort((a, b) => D.modules[a][k] - D.modules[b][k]); const rank = new Array(idx.length); idx.forEach((m, r) => rank[m] = r); return rank; };
function hex(c) { const s = getComputedStyle(document.documentElement).getPropertyValue(c).trim(); return [1, 3, 5].map(i => parseInt(s.substr(i, 2), 16)); }
function ramp(p) { const a = hex('--ramp-early'), b = hex('--ramp-late'); return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(',') + ')'; }
const ganttState = { scale: 0.3 };
const tmaxG = Math.ceil((Math.max(S.app.makespan, S.perfect.makespan) + 120) / 60) * 60;
function renderGantt(el, view, endKey) {
  const sc = ganttState.scale, rank = modOrder(endKey), M = D.modules.length;
  const width = Math.ceil(tmaxG * sc) + 112;
  let h = '<div style="width:' + width + 'px"><div class="axis">';
  const step = sc >= 0.55 ? 60 : sc >= 0.28 ? 120 : 240;
  for (let t = 0; t <= tmaxG; t += D.dayLen) h += '<div class="d" style="left:' + (112 + t * sc) + 'px">' + (D.dayLabels[t / D.dayLen] || '') + '</div>';
  for (let t = 0; t <= tmaxG; t += step) h += '<div class="t" style="left:' + (112 + t * sc) + 'px">' + String(D.shiftStartHour + Math.floor((t % D.dayLen) / 60)).padStart(2, '0') + '</div>';
  h += '</div>';
  D.machines.forEach((name, k) => {
    h += '<div class="lane"><span class="name">' + name + '</span>';
    for (let t = 0; t <= tmaxG; t += D.dayLen) h += '<div class="day-line" style="left:' + (112 + t * sc) + 'px"></div>';
    D.downtime.filter(d => d[0] === k).forEach(d => h += '<div class="down" title="Disruption ' + clock(d[1]) + ' to ' + clock(d[2], true) + '" style="left:' + (112 + d[1] * sc) + 'px;width:' + Math.max(2, (d[2] - d[1]) * sc) + 'px"></div>');
    view.jobs.filter(j => j[0] === k).forEach(j => {
      const [, ji, s, e, su, m, closes, meas] = j;
      if (su > 0) h += '<div class="setup" style="left:' + (112 + (s - su) * sc) + 'px;width:' + su * sc + 'px"></div>';
      const w = Math.max(2, (e - s) * sc);
      h += '<div class="blk' + (closes ? ' close' : '') + (meas ? ' mea' : ' est') + '" data-m="' + m + '" data-j="' + ji + '" data-s="' + s + '" data-e="' + e + '" data-su="' + su + '" data-k="' + k + '" style="left:' + (112 + s * sc) + 'px;width:' + w + 'px;background:' + ramp(rank[m] / Math.max(1, M - 1)) + '">' + (w > 34 ? D.jobBoxes[ji] : '') + '</div>';
      if (closes && w > 18) h += '<div class="flag" style="left:' + (112 + e * sc - 14) + 'px">' + (rank[m] + 1) + '</div>';
    });
    h += '</div>';
  });
  el.innerHTML = h + '</div>';
}
function wire(el) {
  const tip = $('#tip');
  el.addEventListener('pointerover', ev => {
    const b = ev.target.closest('.blk'); if (!b) return;
    const m = +b.dataset.m; el.classList.add('dim');
    document.querySelectorAll('.gantt .blk').forEach(x => x.classList.toggle('hl', +x.dataset.m === m));
    const ji = +b.dataset.j, mod = D.modules[m];
    tip.hidden = false;
    tip.innerHTML = '<b>Box ' + D.jobBoxes[ji] + '</b> · ' + D.jobMaterials[ji] + '<dl><dt>Machine</dt><dd>' + D.machines[+b.dataset.k] + '</dd><dt>Runs</dt><dd>' + clock(+b.dataset.s) + ' → ' + clock(+b.dataset.e, true) + '</dd><dt>Length</dt><dd>' + (+b.dataset.e - +b.dataset.s) + ' min' + (+b.dataset.su ? ' (+' + b.dataset.su + ' changeover)' : '') + '</dd><dt>Order</dt><dd class="mono">' + mod.id + '</dd><dt>Order done</dt><dd>' + clock(mod.bestEnd, true) + ' (perfect) · ' + clock(mod.appEnd, true) + ' (app)</dd></dl>';
  });
  el.addEventListener('pointermove', ev => { tip.style.left = Math.min(ev.clientX + 14, innerWidth - 320) + 'px'; tip.style.top = Math.min(ev.clientY + 14, innerHeight - 200) + 'px'; });
  el.addEventListener('pointerout', ev => { if (ev.target.closest('.blk')) { document.querySelectorAll('.gantt').forEach(g => g.classList.remove('dim')); tip.hidden = true; } });
}
function drawAll() { renderGantt($('#ganttA'), D.perfect, 'bestEnd'); renderGantt($('#ganttB'), D.app, 'appEnd'); }
drawAll(); wire($('#ganttA')); wire($('#ganttB'));
document.querySelectorAll('.toolbar button').forEach(b => b.addEventListener('click', () => {
  const z = b.dataset.z;
  if (z === 'in') ganttState.scale = Math.min(2, ganttState.scale * 1.3);
  else if (z === 'out') ganttState.scale = Math.max(0.08, ganttState.scale / 1.3);
  else ganttState.scale = Math.max(0.08, ($('#scrollA').clientWidth - 130) / tmaxG);
  drawAll();
}));
matchMedia('(prefers-color-scheme: light)').addEventListener('change', drawAll);

/* ---------- table + notes ---------- */
(function table() {
  const rows = D.modules.map((m, i) => [m, i]).sort((a, b) => a[0].bestEnd - b[0].bestEnd);
  $('#mods tbody').innerHTML = rows.map(([m]) => {
    const d = m.appEnd - m.bestEnd;
    return '<tr><td class="mono">' + m.id + '</td><td>' + m.customer + '</td><td class="num">' + m.parts + '</td><td class="num">' + fmtInt(m.work) + '</td><td class="num">' + clock(m.bestEnd, true) + '</td><td class="num">' + clock(m.appEnd, true) + '</td><td class="num">' + (d > 0 ? '<span class="delta-good">' + fmtInt(d) + ' min</span>' : d < 0 ? '<span class="delta-bad">' + fmtInt(-d) + ' min sooner</span>' : '—') + '</td></tr>';
  }).join('');
  $('#notes').innerHTML = D.notes.map(n => '<p>' + n + '</p>').join('');
})();
</script>`;
}
