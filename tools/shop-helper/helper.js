/*
 * Shop helper for the CNC Workload page: ticks the boxes of a machine for you, and sends them to the machine.
 * It runs in your own browser tab (paste it in the console, F12) and only clicks what you would click.
 * Nothing is sent anywhere; it needs the three or four columns you copy from the planner's Excel export.
 */
(() => {
  if (window.__cncHelper) {
    window.__cncHelper.open();
    return;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const visible = el => !!el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length) > 0;
  const q = (sel, root = document) => [...root.querySelectorAll(sel)];
  const press = el => {
    el.scrollIntoView({ block: 'center' });
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
  };
  const waitFor = async (fn, ms = 6000, step = 100) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(step);
    }
  };

  /* ------------------------------------------------------------ the page */

  // Two kinds of grid are understood: SlickGrid (div rows, only the visible ones exist) and plain tables.
  let scope = document; // the whole page, or the dialog being worked on
  const slickViewport = () => q('.slick-viewport', scope).filter(visible).sort((x, y) => y.clientHeight * y.clientWidth - x.clientHeight * x.clientWidth)[0] || null;
  const isSlick = () => !!slickViewport();

  /** column names in order (header cells) */
  function headerNames() {
    if (isSlick()) return q('.slick-header-column', scope).filter(visible).map(h => norm((h.querySelector('.slick-column-name') || h).textContent));
    return q('th, [role="columnheader"]', scope).filter(visible).map(h => norm(h.textContent));
  }
  function columnIndex(re) {
    const i = headerNames().findIndex(n => re.test(n));
    return i < 0 ? null : i;
  }
  function cellText(row, index) {
    if (isSlick()) return norm((row.querySelector('.slick-cell.l' + index) || {}).textContent);
    return norm(([...row.children][index] || {}).textContent);
  }
  const TICK_SEL = '.select-item, .check-box, input[type="checkbox"], [role="checkbox"], .e-checkbox-wrapper';
  const checkboxOf = row => row.querySelector(TICK_SEL);
  function isTicked(row) {
    const c = checkboxOf(row);
    if (!c) return false;
    if (c.tagName === 'INPUT') return c.checked;
    return c.getAttribute('aria-checked') === 'true' || /\bchecked\b|e-check/.test(c.className) || /\bselected\b/.test(row.className);
  }
  /** the same row again: grids redraw a row when it is ticked, so the element we hold may be a stale copy */
  function freshRow(row) {
    if (!row.isConnected && isSlick()) {
      const vp = slickViewport();
      return [...vp.querySelectorAll('.slick-row')].find(r => r.style.top === row.style.top) || row;
    }
    return row;
  }
  /** clicks once, then waits for the grid to show the new state (it redraws the row a moment later) */
  async function setTick(row, on) {
    if (isTicked(row) === on) return true;
    const c = checkboxOf(row);
    if (!c) return false;
    press(c);
    for (let i = 0; i < 10; i++) {
      await sleep(100);
      if (isTicked(freshRow(row)) === on) return true;
    }
    return false;
  }

  /** calls fn(row) for every row of the grid once; for SlickGrid it scrolls down the list so every row gets drawn */
  async function scan(fn, keepPlace) {
    if (!isSlick()) {
      for (const r of q('tbody tr, [role="row"]', scope).filter(r => visible(r) && checkboxOf(r) && !r.querySelector('th'))) {
        if (stop) return;
        if ((await fn(r)) === 'done') return;
      }
      return;
    }
    const vp = slickViewport();
    const seen = new Set();
    vp.scrollTop = 0;
    await sleep(200);
    let guard = 0;
    for (;;) {
      if (stop) return;
      for (const r of [...vp.querySelectorAll('.slick-row')]) {
        const key = r.style.top || r.getAttribute('data-row') || r.className;
        if (seen.has(key)) continue;
        seen.add(key);
        if ((await fn(r)) === 'done') {
          if (!keepPlace) vp.scrollTop = 0;
          return;
        }
      }
      if (vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 2 || ++guard > 400) break;
      vp.scrollTop += Math.max(60, vp.clientHeight - 60);
      await sleep(140);
    }
    vp.scrollTop = 0;
    await sleep(100);
  }

  function pageInfo() {
    const m = /showing\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)/i.exec(document.body.innerText);
    return m ? { from: +m[1], to: +m[2], total: +m[3] } : null;
  }
  /** shows every record on one page, when the page offers a size that is big enough */
  async function showAll(log) {
    const info = pageInfo();
    if (!info || info.to - info.from + 1 >= info.total) return true;
    const sel = q('select.slick-pg-size, select').find(s => visible(s) && [...s.options].some(o => +o.value >= 100));
    if (!sel) {
      log('Could not find the page-size list (the "100" at the bottom). Set it to the largest size yourself, then try again.', 'warn');
      return false;
    }
    const opts = [...sel.options].map(o => ({ o, n: +o.value || 0 })).sort((a, b) => b.n - a.n);
    const best = opts.find(x => x.n >= info.total) || opts[0];
    sel.value = best.o.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) window.jQuery(sel).trigger('change');
    await waitFor(() => { const i = pageInfo(); return i && i.to - i.from + 1 >= Math.min(i.total, best.n); }, 20000, 250);
    await sleep(500);
    const after = pageInfo();
    if (!after || after.to - after.from + 1 < info.total) log(`The page shows ${after ? after.to - after.from + 1 : '?'} of ${info.total} rows. Choose a bigger page size, or work in rounds.`, 'warn');
    return true;
  }

  /* ------------------------------------------------------------ the plan text */

  const MACHINE = /^(?:fanuc|haas)\s*-\s*\d$/i;
  /** the rows copied from the planner's Excel export: Machine, Sequence, Box Code, Order Number */
  function parsePlan(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const cells = line.split(/\t|;|,(?=\S)/).map(norm).filter(Boolean);
      if (cells.length < 2) continue;
      const machine = cells.find(c => MACHINE.test(c));
      if (!machine) continue; // header line or something else
      const seq = cells.map(Number).find(n => Number.isInteger(n) && n > 0 && n < 1000);
      const order = cells.find(c => /^\d{9,}$/.test(c));
      const box = cells.find(c => c !== order && /^\d{3,5}$/.test(c) && Number(c) !== seq) || cells.find(c => c !== order && /^\d{3,5}$/.test(c));
      if (!box && !order) continue;
      out.push({ machine: machine.toUpperCase().replace(/\s*-\s*/, ' - '), seq: seq ?? out.length + 1, box: box ? box.padStart(4, '0') : '', order: order || '' });
    }
    return out;
  }

  /* ------------------------------------------------------------ the screen */

  /* ============================================================ Carpenter produce list: refresh every row */

  if (/carpenterproduce/i.test(location.pathname)) {
    carpenterPanel();
    return;
  }

  function carpenterPanel() {
    const KEY = 'cncHelper.carpenter.v1';
    const load = () => {
      try {
        return JSON.parse(localStorage.getItem(KEY) || '{}');
      } catch {
        return {};
      }
    };
    const save = v => {
      try {
        localStorage.setItem(KEY, JSON.stringify(v));
      } catch {
        /* storage blocked */
      }
    };

    // requests the page is waiting for: a refresh is finished when they are all back
    let inflight = 0;
    let lastActivity = 0;
    if (!window.__cncNetHook) {
      window.__cncNetHook = true;
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function () {
        inflightAdd(1);
        this.addEventListener('loadend', () => inflightAdd(-1));
        return send.apply(this, arguments);
      };
      if (window.fetch) {
        const f = window.fetch;
        window.fetch = function () {
          inflightAdd(1);
          return f.apply(this, arguments).finally(() => inflightAdd(-1));
        };
      }
    }
    function inflightAdd(d) {
      inflight = Math.max(0, inflight + d);
      lastActivity = Date.now();
      window.__cncInflight = inflight;
    }
    async function settle(maxMs = 25000) {
      const start = Date.now();
      // give the click a moment to start its request
      await waitFor(() => lastActivity >= start, 1500, 50);
      await waitFor(() => inflight === 0 && Date.now() - lastActivity > 350, maxMs, 100);
      await sleep(150);
    }

    const vp = () => q('.slick-viewport').filter(visible).sort((x, y) => y.clientHeight * y.clientWidth - x.clientHeight * x.clientWidth)[0] || null;
    const headers = () => q('.slick-header-column').filter(visible).map(h => norm((h.querySelector('.slick-column-name') || h).textContent));
    const col = re => headers().findIndex(n => re.test(n));
    const cell = (row, i) => (i < 0 ? null : row.querySelector('.slick-cell.l' + i));
    /** everything that could be "the Refresh button" of a row, from the innermost element out to the cell */
    function refreshCandidates(row) {
      const out = [];
      // the site's own button: <span class="btn btn-app btn-refresh"><i class="fa fa-refresh btn-refresh"></i>Refresh</span>
      const btn = row.querySelector('span.btn-refresh, .btn.btn-refresh, .btn-refresh:not(i)');
      if (btn) out.push(btn);
      const icon = row.querySelector('i.btn-refresh, i.fa-refresh');
      if (icon && !out.includes(icon)) out.push(icon);
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let label = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/^\s*refresh\s*$/i.test(n.nodeValue)) {
        label = n.parentElement;
        break;
      }
      for (let e = label; e && e !== row; e = e.parentElement) {
        if (!out.includes(e)) out.push(e);
        if (e.classList.contains('slick-cell')) break;
      }
      return out;
    }
    let learned = null; // which of the candidates made the page call the server last time
    /** clicks the row's Refresh, and checks that the page really asked the server for something */
    async function clickRefresh(row) {
      const cands = refreshCandidates(row);
      if (!cands.length) return 'none';
      const order = learned !== null && cands[learned] ? [learned, ...cands.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...cands.keys()];
      for (const i of order) {
        const before = lastActivity;
        const el = cands[i];
        press(el);
        if (el.tagName === 'A' || el.tagName === 'BUTTON') el.click();
        const went = await waitFor(() => lastActivity > before, 1500, 50);
        if (went) {
          learned = i;
          return 'ok';
        }
      }
      return 'silent';
    }
    // a file cell holds one link per file (an empty list of files has no links)
    const hasFiles = c => !!c && !!c.querySelector('a[href]:not([href="#"]):not([href^="javascript"]), img');

    const panel = document.createElement('div');
    panel.id = 'cnc-helper';
    panel.style.cssText = 'position:fixed;right:12px;bottom:12px;width:400px;max-height:80vh;z-index:2147483647;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;font:12px system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5);display:flex;flex-direction:column';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #334155"><b>Carpenter list: refresh</b><button data-a="close" style="all:unset;cursor:pointer;padding:0 6px">✕</button></div>
      <div style="padding:10px;display:flex;flex-direction:column;gap:8px">
        <label style="color:#94a3b8"><input type="radio" name="cnc-mode" value="missing" checked> Only rows without PDF / NC files</label>
        <label style="color:#94a3b8"><input type="radio" name="cnc-mode" value="all"> Every row in the list</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button data-a="count" class="cnc-b">Count</button>
          <button data-a="run" class="cnc-b" style="background:#2563eb;border-color:#3b82f6">Refresh them all</button>
          <button data-a="stop" class="cnc-b">Stop</button>
          <button data-a="describe" class="cnc-b" title="Copies the HTML of the first row, for me to fit the script">Describe row</button>
          <button data-a="resume" class="cnc-b" style="display:none;background:#b45309;border-color:#f59e0b">Continue</button>
        </div>
        <pre data-log style="margin:0;white-space:pre-wrap;background:#020617;border:1px solid #1e293b;border-radius:6px;padding:6px;max-height:220px;overflow:auto;font:11px ui-monospace,monospace"></pre>
      </div>`;
    const style = document.createElement('style');
    style.textContent = '#cnc-helper .cnc-b{all:unset;cursor:pointer;padding:5px 9px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#e2e8f0}#cnc-helper .cnc-b[disabled]{opacity:.5}';
    document.head.appendChild(style);
    document.body.appendChild(panel);
    const logEl = panel.querySelector('[data-log]');
    const log = (m, tone) => {
      const d = document.createElement('div');
      d.textContent = m;
      d.style.color = tone === 'warn' ? '#fbbf24' : tone === 'bad' ? '#f87171' : tone === 'ok' ? '#4ade80' : '';
      logEl.appendChild(d);
      logEl.scrollTop = logEl.scrollHeight;
    };
    const mode = () => panel.querySelector('input[name="cnc-mode"]:checked').value;
    let stopNow = false;
    let busy = false;

    function columns() {
      const wo = col(/^work\s*order/i);
      if (wo < 0) throw new Error('Could not find the "Work Order" column.');
      return { wo, pdf: col(/^pdf/i), nc: col(/^nc\s*files?/i) };
    }
    const needs = (row, c, m) => m === 'all' || !(hasFiles(cell(row, c.pdf)) || hasFiles(cell(row, c.nc)));

    /** walks the list from top to bottom; fn(row) may return 'refreshed' when it changed the list */
    async function walk(fn) {
      const v = vp();
      if (!v) throw new Error('Could not find the list.');
      v.scrollTop = 0;
      await sleep(250);
      for (let guard = 0; guard < 5000; guard++) {
        if (stopNow) return;
        const top = v.scrollTop;
        const rows = [...v.querySelectorAll('.slick-row')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
        let changed = false;
        for (const r of rows) {
          const rt = parseFloat(r.style.top);
          if (rt + r.offsetHeight <= top || rt >= top + v.clientHeight) continue; // only rows in view
          if ((await fn(r)) === 'refreshed') {
            changed = true;
            break;
          }
          if (stopNow) return;
        }
        if (changed) {
          // the list may have been redrawn: go back to the same place and read the view again
          await waitFor(() => vp() && vp().querySelector('.slick-row'), 15000, 150);
          const nv = vp();
          if (nv !== v) return walk(fn);
          v.scrollTop = Math.min(top, v.scrollHeight);
          await sleep(200);
          continue;
        }
        if (v.scrollTop + v.clientHeight >= v.scrollHeight - 2) return;
        v.scrollTop = top + Math.max(40, v.clientHeight - 40);
        await sleep(160);
      }
    }

    async function count() {
      const c = columns();
      const m = mode();
      const seen = new Set();
      let need = 0;
      await walk(r => {
        const wo = norm(cell(r, c.wo)?.textContent);
        if (!wo || seen.has(wo)) return;
        seen.add(wo);
        if (needs(r, c, m)) need++;
      });
      log(`${seen.size} rows read, ${need} ${m === 'all' ? 'to refresh' : 'without PDF / NC files'}.`, 'ok');
    }

    async function run(resume) {
      const c = columns();
      const st = resume ? load() : { mode: mode(), done: [] };
      const done = new Set(st.done || []);
      const m = st.mode;
      if (!resume && !confirm(m === 'all' ? 'Press Refresh on every row of the list?' : 'Press Refresh on every row that has no PDF / NC files?')) return log('Cancelled.');
      save({ mode: m, done: [...done], running: true });
      let n = 0;
      let failed = 0;
      const t0 = Date.now();
      await walk(async r => {
        const wo = norm(cell(r, c.wo)?.textContent);
        if (!wo || done.has(wo) || !needs(r, c, m)) return;
        const res = await clickRefresh(r);
        if (res !== 'ok') {
          failed++;
          done.add(wo);
          if (failed <= 3) log(`Row ${wo}: ${res === 'none' ? 'no Refresh button found' : 'pressed Refresh but the page did not react'}.`, 'warn');
          if (failed === 3 && n === 0) {
            stopNow = true;
            log('Stopped: Refresh does not react to the script. Press "Describe row" and send me the text it copies.', 'bad');
          }
          return;
        }
        await settle();
        done.add(wo);
        n++;
        save({ mode: m, done: [...done], running: true });
        if (n % 10 === 0) log(`${n} refreshed (${Math.round((Date.now() - t0) / 1000)} s)`);
        return 'refreshed';
      });
      if (stopNow) {
        log(`Stopped after ${n}. Press "Continue" to go on.`, 'warn');
        panel.querySelector('[data-a=resume]').style.display = '';
        return;
      }
      save({});
      panel.querySelector('[data-a=resume]').style.display = 'none';
      log(`Done: ${n} rows refreshed in ${Math.round((Date.now() - t0) / 1000)} s${failed ? `, ${failed} rows had no Refresh button` : ''}.`, 'ok');
    }

    const guard = async fn => {
      if (busy) return;
      busy = true;
      stopNow = false;
      panel.querySelectorAll('.cnc-b').forEach(b => b.getAttribute('data-a') !== 'stop' && (b.disabled = true));
      try {
        await fn();
      } catch (e) {
        log('Stopped: ' + (e && e.message ? e.message : e), 'bad');
      } finally {
        busy = false;
        panel.querySelectorAll('.cnc-b').forEach(b => (b.disabled = false));
      }
    };
    panel.addEventListener('click', e => {
      const a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'close') {
        panel.remove();
        style.remove();
        delete window.__cncHelper;
      } else if (a === 'count') guard(count);
      else if (a === 'run') guard(() => run(false));
      else if (a === 'resume') guard(() => run(true));
      else if (a === 'stop') stopNow = true;
      else if (a === 'describe') {
        const v = vp();
        const r = v && [...v.querySelectorAll('.slick-row')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top))[0];
        const text = `path: ${location.pathname}\nheaders: ${headers().join(' | ')}\nhints: ${['jQuery', 'Slick', 'Serenity', 'Q'].filter(k => k in window).join(', ')}\nrow: ${r ? r.outerHTML.slice(0, 3500) : 'none'}`;
        try {
          navigator.clipboard.writeText(text);
          log('Row description copied. Paste it to me.', 'ok');
        } catch {
          log(text.slice(0, 1500));
        }
      }
    });
    window.__cncHelper = { open: () => (panel.style.display = 'flex'), stop: () => (stopNow = true) };
    const st = load();
    if (st.running && st.done && st.done.length) {
      panel.querySelector('[data-a=resume]').style.display = '';
      log(`A refresh run was interrupted after ${st.done.length} rows. Press "Continue" to go on with the rest.`, 'warn');
    }
    log('Ready. "Count" shows how many rows need a refresh; "Refresh them all" presses Refresh on each, one after another, waiting for each to finish.');
  }

  const panel = document.createElement('div');
  panel.id = 'cnc-helper';
  panel.style.cssText = 'position:fixed;right:12px;bottom:12px;width:430px;max-height:86vh;z-index:2147483647;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;font:12px system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5);display:flex;flex-direction:column';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #334155;cursor:move" data-drag>
      <b>CNC shop helper</b><span><button data-act="min" style="all:unset;cursor:pointer;padding:0 6px">–</button><button data-act="close" style="all:unset;cursor:pointer;padding:0 6px">✕</button></span>
    </div>
    <div data-body style="padding:10px;display:flex;flex-direction:column;gap:8px;overflow:auto">
      <div style="color:#94a3b8">1. In the planner's Excel export, open sheet <b>Plan_All</b>, select columns <b>A to D</b> (Machine, Sequence, Box Code, Order Number), copy them, and paste here:</div>
      <textarea data-plan rows="5" placeholder="Machine  Sequence  Box Code  Order Number …" style="width:100%;box-sizing:border-box;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;font:11px ui-monospace,monospace"></textarea>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span style="color:#94a3b8">2. Machine:</span><select data-machine style="background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px"></select>
        <label style="color:#94a3b8"><input type="checkbox" data-one> one at a time, in order</label>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button data-act="check" class="cnc-b">Check</button>
        <button data-act="tick" class="cnc-b">Tick the boxes</button>
        <button data-act="send" class="cnc-b" style="background:#2563eb;border-color:#3b82f6">Tick + send to machine</button>
        <button data-act="clear" class="cnc-b">Untick all</button>
        <button data-act="resume" class="cnc-b" style="display:none;background:#b45309;border-color:#f59e0b">Continue interrupted send</button>
        <button data-act="order" class="cnc-b" title="With the Machines workload list open: drags the rows into plan order">Order the open workload list</button>
        <button data-act="record" class="cnc-b" title="Logs what the page sends while you drag one row by hand">Record a drag</button>
        <button data-act="probe" class="cnc-b" title="Copies a description of this page (no clicking)">Describe page</button>
      </div>
      <pre data-log style="margin:0;white-space:pre-wrap;word-break:break-word;background:#020617;border:1px solid #1e293b;border-radius:6px;padding:6px;max-height:240px;overflow:auto;font:11px ui-monospace,monospace"></pre>
    </div>`;
  const style = document.createElement('style');
  style.textContent = '#cnc-helper .cnc-b{all:unset;cursor:pointer;padding:5px 9px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#e2e8f0}#cnc-helper .cnc-b:hover{filter:brightness(1.2)}#cnc-helper .cnc-b[disabled]{opacity:.5;cursor:default}';
  document.head.appendChild(style);
  document.body.appendChild(panel);
  const $ = s => panel.querySelector(s);
  const logEl = $('[data-log]');
  const log = (msg, tone) => {
    const d = document.createElement('div');
    d.textContent = msg;
    if (tone === 'warn') d.style.color = '#fbbf24';
    if (tone === 'bad') d.style.color = '#f87171';
    if (tone === 'ok') d.style.color = '#4ade80';
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  };
  // what you typed survives a page reload (the shop page reloads itself after a send)
  const STORE = 'cncHelper.v1';
  const stored = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || '{}');
    } catch {
      return {};
    }
  };
  const keep = patch => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...stored(), ...patch }));
    } catch {
      /* storage blocked: the helper still works, it just forgets */
    }
  };
  let plan = [];
  let planSource = null;
  const readPlan = () => {
    const text = $('[data-plan]').value;
    if (text === planSource) return plan; // the same entries every time, so they can be compared
    planSource = text;
    plan = parsePlan(text);
    const machines = [...new Set(plan.map(p => p.machine))];
    const sel = $('[data-machine]');
    const keep = sel.value;
    sel.innerHTML = machines.map(m => `<option>${m}</option>`).join('');
    if (machines.includes(keep)) sel.value = keep;
    return plan;
  };
  $('[data-plan]').addEventListener('input', () => {
    keep({ plan: $('[data-plan]').value });
    readPlan();
    logEl.textContent = '';
    const by = {};
    plan.forEach(p => (by[p.machine] = (by[p.machine] || 0) + 1));
    log(plan.length ? `Read ${plan.length} parts: ${Object.entries(by).map(([m, n]) => `${m} ${n}`).join(', ')}.` : 'No parts recognised yet. Paste the columns Machine, Sequence, Box Code, Order Number.', plan.length ? 'ok' : 'warn');
  });

  /* ------------------------------------------------------------ actions */

  let busy = false;
  let stop = false;
  const guard = async fn => {
    if (busy) return;
    busy = true;
    stop = false;
    panel.querySelectorAll('.cnc-b').forEach(b => (b.disabled = true));
    try {
      await fn();
    } catch (e) {
      log('Stopped: ' + (e && e.message ? e.message : e), 'bad');
    } finally {
      busy = false;
      panel.querySelectorAll('.cnc-b').forEach(b => (b.disabled = false));
    }
  };

  /** which columns identify a row */
  function columns() {
    const box = columnIndex(/^box\s*code/i);
    const ord = columnIndex(/^order\s*number/i);
    if (box === null && ord === null) throw new Error('Could not find the "Box Code" or "Order Number" column. Press "Describe page" and send me the result.');
    return { box, ord };
  }
  /** a plan entry is matched to a row by its order number, else by a box code that is unique */
  function matcher(mine, col) {
    const byOrder = new Map(mine.filter(p => p.order).map(p => [p.order, p]));
    const byBox = new Map();
    for (const p of mine) if (p.box) byBox.set(p.box, [...(byBox.get(p.box) || []), p]);
    return row => {
      const o = col.ord !== null ? cellText(row, col.ord) : '';
      if (o && byOrder.has(o)) return byOrder.get(o);
      if (col.box !== null) {
        const b = cellText(row, col.box).padStart(4, '0');
        const c = byBox.get(b);
        if (c && c.length === 1 && (!c[0].order || col.ord === null)) return c[0];
      }
      return null;
    };
  }
  const mineOf = machine => {
    const mine = readPlan().filter(p => p.machine === machine).sort((a, b) => a.seq - b.seq);
    if (!mine.length) throw new Error('Paste the plan first and choose a machine.');
    return mine;
  };

  /** reads the whole list once: which of the machine's boxes are on the page, which are ticked, and which others are ticked */
  async function survey(machine) {
    const mine = mineOf(machine);
    await showAll(log);
    const col = columns();
    const match = matcher(mine, col);
    const found = new Map();
    let others = 0;
    let rows = 0;
    await scan(row => {
      rows++;
      const p = match(row);
      const t = isTicked(row);
      if (p) found.set(p, t);
      else if (t) others++;
    });
    if (!rows) throw new Error('Could not find any table rows. Press "Describe page" and send me the result.');
    const missing = mine.filter(p => !found.has(p));
    return { mine, found, missing, others, rows, col, match };
  }

  async function doCheck() {
    const machine = $('[data-machine]').value;
    const r = await survey(machine);
    log(`${machine}: ${r.mine.length} in the plan, ${r.found.size} found on the page (${r.rows} rows read), ${r.missing.length} not found.`, r.missing.length ? 'warn' : 'ok');
    if (r.missing.length) log('Not found: ' + r.missing.map(m => m.box || m.order).join(', ') + ' (already sent, filtered out, or not in the list)', 'warn');
    const already = [...r.found.values()].filter(Boolean).length;
    if (already) log(`${already} of them are already ticked.`);
    if (r.others) log(`${r.others} other rows are ticked. "Untick all" clears them.`, 'warn');
  }

  async function untickAll() {
    let n = 0;
    await scan(async row => {
      if (isTicked(row) && (await setTick(row, false))) n++;
    });
    log(`Unticked ${n} rows.`);
  }

  async function tickMachine(machine, onlyThese, pre) {
    const r = pre || (await survey(machine));
    if (r.others && !onlyThese) throw new Error(`${r.others} other rows are ticked. Press "Untick all" first.`);
    const want = new Set(onlyThese || r.mine);
    const target = [...want].filter(p => r.found.has(p));
    let pending = new Set(target.filter(p => !r.found.get(p)));
    // click what is not ticked, then read the whole list again to see what really is ticked; repeat for the rest
    for (let round = 1; round <= 4 && pending.size; round++) {
      const clicked = new Set();
      await scan(async row => {
        const p = r.match(row);
        if (!p || !pending.has(p) || clicked.has(p)) return;
        clicked.add(p);
        await setTick(row, true);
        if (clicked.size >= pending.size) return 'done';
      });
      if (stop) break;
      const still = new Set(pending);
      const seen = new Set();
      await scan(row => {
        const p = r.match(row);
        if (!p || !still.has(p)) return;
        seen.add(p);
        if (isTicked(row)) still.delete(p);
        if (seen.size >= pending.size) return 'done';
      });
      pending = still;
      if (pending.size && round < 4) log(`Round ${round}: ${pending.size} not ticked yet, trying again.`, 'warn');
    }
    const ticked = target.length - pending.size;
    log(`${machine}: ticked ${ticked} of ${target.length}${r.missing.length ? `, ${r.missing.length} not found (${r.missing.map(m => m.box || m.order).join(', ')})` : ''}${pending.size ? `, could not tick ${[...pending].map(p => p.box).join(', ')}` : ''}.`, !pending.size && !r.missing.length ? 'ok' : 'warn');
    return { ...r, ticked };
  }

  /** "Send to machine" -> dialog -> pick the machine -> OK */
  async function sendTicked(machine) {
    const btn = [...q('a, button, span, div, li')].filter(visible).find(e => /^send to machine$/i.test(norm(e.textContent)) && e.children.length <= 2);
    if (!btn) throw new Error('Could not find the "Send to machine" button.');
    press(btn);
    const dialog = await waitFor(() => q('.ui-dialog, [role="dialog"], .modal, .e-dialog, .k-window, .dialog').filter(visible).find(d => /choice machine|choose machine/i.test(norm(d.textContent))) || q('div').filter(visible).find(d => /choice machine/i.test(norm(d.textContent)) && d.textContent.length < 300 && d.querySelector('select, input, .select2-container')), 8000);
    if (!dialog) throw new Error('The "Choice Machine" box did not open.');
    const native = dialog.querySelector('select');
    if (native) {
      const o = [...native.options].find(x => norm(x.textContent).toLowerCase() === machine.toLowerCase());
      if (!o) throw new Error(`The list has no machine "${machine}".`);
      native.value = o.value;
      native.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const prefer = ['.select2-choice', '.select2-selection', '.select2-container', '[role="combobox"]', '.e-ddl', '.k-dropdown', '.k-input', '.dropdown', 'input[placeholder]', 'input[type="text"]'];
      let field = null;
      for (const sel of prefer) if ((field = dialog.querySelector(sel))) break;
      field =
        field ||
        [...dialog.querySelectorAll('span, div, a, input')].filter(visible).find(e => /^([-–\s]*(select|choose)[-–\s.]*|(fanuc|haas)\s*-\s*\d)$/i.test(norm(e.textContent || e.value || e.placeholder))) ||
        dialog.querySelector('input, span[class*="select"]');
      if (!field) throw new Error('Could not find the machine list in the box.');
      press(field);
      const typed = dialog.querySelector('input[type="text"], input:not([type])');
      if (typed && typed.getAttribute('readonly') === null) {
        typed.focus();
        typed.value = machine;
        typed.dispatchEvent(new Event('input', { bubbles: true }));
        typed.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      }
      const item = await waitFor(() => q('.select2-result-label, li.select2-result, li, [role="option"], .e-list-item, .select2-results__option, .k-item').filter(visible).find(e => norm(e.textContent).toLowerCase() === machine.toLowerCase()), 5000);
      if (!item) throw new Error(`Could not pick "${machine}" in the list.`);
      press(item);
    }
    await sleep(250);
    const shown = norm(dialog.textContent).toLowerCase();
    if (!shown.includes(machine.toLowerCase()) && !(native && native.options[native.selectedIndex]?.textContent.trim().toLowerCase() === machine.toLowerCase())) throw new Error(`The box does not show "${machine}" after choosing it: not pressing OK.`);
    const ok = q('button, a, input[type="button"], input[type="submit"]', dialog).filter(visible).find(b => /^ok$/i.test(norm(b.textContent || b.value)));
    if (!ok) throw new Error('Could not find OK in the box.');
    press(ok);
    await waitFor(() => !visible(dialog), 8000);
    await sleep(800);
    await waitFor(() => slickViewport() && slickViewport().querySelector('.slick-row') && pageInfo(), 20000, 200);
    await sleep(300);
  }

  const nowText = () => new Date().toLocaleTimeString();
  const keyOf = p => p.order || p.box;
  async function doSend(resume) {
    const queue = resume ? stored().queue : null;
    if (resume && !(queue && queue.remaining && queue.remaining.length)) throw new Error('Nothing to continue.');
    if (resume) $('[data-machine]').value = queue.machine;
    const machine = $('[data-machine]').value;
    const one = resume ? true : $('[data-one]').checked;
    const r = await survey(machine);
    const wanted = resume ? new Set(queue.remaining) : null;
    const list = r.mine.filter(x => r.found.has(x) && (!wanted || wanted.has(keyOf(x))));
    if (!list.length) throw new Error('Nothing to send: no box of this machine is in the list.');
    if (r.others) throw new Error(`${r.others} other rows are ticked. Press "Untick all" first.`);
    if (!confirm(`Send ${list.length} boxes to ${machine}${one ? ', one at a time in plan order' : ''}?${r.missing.length && !resume ? `\n\n${r.missing.length} are not in the list and will be skipped.` : ''}`)) return log('Cancelled.');
    if (!one) {
      const t = await tickMachine(machine, undefined, r);
      if (stop) return;
      if (t.ticked !== list.length) throw new Error(`Only ${t.ticked} of ${list.length} could be ticked: nothing was sent.`);
      // the page may reload as soon as OK is pressed: leave a note for the next run
      keep({ last: { msg: `sent ${list.length} boxes to ${machine}`, at: nowText() }, queue: null });
      await sendTicked(machine);
      log(`Sent ${list.length} boxes to ${machine}. Check the machine's workload.`, 'ok');
      $('[data-act=resume]').style.display = 'none';
      return;
    }
    const total = resume ? queue.total : list.length;
    let n = resume ? total - list.length : 0;
    const left = list.map(keyOf);
    for (const p of list) {
      if (stop) return log('Stopped.');
      const t = await tickMachine(machine, [p], r);
      if (!t.ticked) {
        log(`Box ${p.box} could not be ticked (already sent?): skipped.`, 'warn');
        left.shift();
        continue;
      }
      // if the page reloads after this send, the next run offers to continue with the boxes that are left
      keep({ queue: { machine, total, remaining: [...left] }, last: { msg: `sending ${machine} one by one, ${n} of ${total} done`, at: nowText() } });
      await sendTicked(machine);
      left.shift();
      n++;
      keep({ queue: { machine, total, remaining: [...left] }, last: { msg: `sent ${n} of ${total} boxes to ${machine}`, at: nowText() } });
      log(`${n}/${total} sent: ${p.box}`, 'ok');
    }
    keep({ queue: null });
    $('[data-act=resume]').style.display = 'none';
    log(`Sent ${n} boxes to ${machine} in plan order.`, 'ok');
  }

  /* ------------------------------------------------------------ order the machine workload list */

  const fire = (el, type, x, y, extra = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1, ...extra }));
  const center = el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const workloadDialog = () => q('.ui-dialog, [role="dialog"], .modal').filter(visible).find(d => /machines workload/i.test(norm(d.textContent.slice(0, 400))));

  /** drags one row onto another (the list then says "Move A under B"), scrolling the list while the button is held */
  async function dragUnder(srcRow, boxIdx, findTarget) {
    const grab = srcRow.querySelector('.slick-cell.l' + boxIdx) || srcRow;
    const vp = slickViewport();
    let { x, y } = center(grab);
    fire(grab, 'mousedown', x, y);
    await sleep(60);
    for (const dy of [3, 6, 9]) {
      fire(grab, 'mousemove', x, y + dy);
      fire(document, 'mousemove', x, y + dy);
      await sleep(30);
    }
    const tgt = await findTarget();
    if (!tgt) {
      fire(document, 'mouseup', x, y);
      return false;
    }
    const to = center(tgt.querySelector('.slick-cell.l' + boxIdx) || tgt);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const px = x + ((to.x - x) * i) / steps;
      const py = y + ((to.y - y) * i) / steps;
      const el = document.elementFromPoint(px, py) || tgt;
      fire(el, 'mousemove', px, py);
      fire(document, 'mousemove', px, py);
      await sleep(30);
    }
    const end = document.elementFromPoint(to.x, to.y) || tgt;
    fire(end, 'mousemove', to.x, to.y);
    await sleep(120);
    fire(end, 'mouseup', to.x, to.y);
    await sleep(60);
    fire(end, 'click', to.x, to.y, { buttons: 0 });
    void vp;
    return true;
  }

  async function readWorkload(machine, boxIdx, ordIdx) {
    const mine = mineOf(machine);
    const match = matcher(mine, { box: boxIdx, ord: ordIdx });
    const rows = [];
    await scan(row => {
      const p = match(row);
      rows.push({ p, top: parseFloat(row.style.top) || rows.length, text: boxIdx !== null ? cellText(row, boxIdx) : '' });
    });
    return rows.sort((a, b) => a.top - b.top);
  }

  /** finds a row of the open list by its plan entry and leaves the list scrolled so that the row is in the middle */
  async function rowOf(p, match, keepPlace) {
    let found = null;
    await scan(row => {
      if (match(row) === p) {
        found = row;
        return 'done';
      }
    }, keepPlace);
    if (found && keepPlace) {
      const vp = slickViewport();
      const top = parseFloat(found.style.top);
      if (!isNaN(top)) {
        vp.scrollTop = Math.max(0, top - vp.clientHeight / 2 + found.offsetHeight / 2);
        await sleep(250);
        found = [...vp.querySelectorAll('.slick-row')].find(r => r.style.top === found.style.top) || found;
      }
    }
    return found;
  }

  async function doOrder() {
    const dlg = workloadDialog();
    if (!dlg) throw new Error('Open the "Machines workload" list first (the button next to "Send to machine"), then press this again.');
    const machine = $('[data-machine]').value;
    scope = dlg;
    try {
      const boxIdx = columnIndex(/^box\s*code/i) ?? columnIndex(/^bo/i);
      const ordIdx = columnIndex(/^order\s*number/i);
      if (boxIdx === null && ordIdx === null) throw new Error('The list has no Box Code or Order Number column.');
      let rows = await readWorkload(machine, boxIdx, ordIdx);
      const present = new Set(rows.filter(r => r.p).map(r => r.p));
      log(`List columns: box ${boxIdx}, order ${ordIdx}; ${rows.length} rows read, ${present.size} are ${machine} boxes.`);
      const desired = mineOf(machine).filter(p => present.has(p));
      if (desired.length < 2) throw new Error(`Only ${desired.length} of ${machine}'s boxes are in this list: nothing to order.`);
      log(`${desired.length} of ${machine}'s boxes are in the list (${rows.length} rows). Ordering them like the plan.`);
      const match = matcher(mineOf(machine), { box: boxIdx, ord: ordIdx });
      const orderNow = () => rows.filter(r => r.p).map(r => r.p);
      // the boxes that can stay: the first one in plan order, and the longest run after it that is already in order
      const pos = new Map(orderNow().map((p, i) => [p, i]));
      const first = desired[0];
      const after = desired.slice(1).filter(p => pos.get(p) > pos.get(first));
      const best = [];
      const tails = [];
      after.forEach(p => {
        const v = pos.get(p);
        let lo = 0, hi = tails.length;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (tails[m].v < v) lo = m + 1;
          else hi = m;
        }
        tails[lo] = { v, p, prev: lo ? tails[lo - 1] : null };
      });
      for (let t = tails[tails.length - 1]; t; t = t.prev) best.push(t.p);
      const keep = new Set([first, ...best]);
      const moves = desired.filter((p, i) => i > 0 && !keep.has(p));
      if (!moves.length) return log('The list is already in plan order.', 'ok');
      if (!confirm(`Move ${moves.length} rows in the "${machine}" list to put its ${desired.length} boxes in plan order?`)) return log('Cancelled.');
      let done = 0;
      for (const p of moves) {
        if (stop) return log('Stopped.');
        const prev = desired[desired.indexOf(p) - 1];
        let ok = false;
        for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
          const src = await rowOf(p, match, true);
          if (!src) throw new Error(`Box ${p.box} is no longer in the list.`);
          await dragUnder(src, boxIdx ?? ordIdx, () => rowOf(prev, match, true));
          await sleep(900);
          await waitFor(() => slickViewport() && slickViewport().querySelector('.slick-row'), 8000, 150);
          rows = await readWorkload(machine, boxIdx, ordIdx);
          const o = orderNow();
          ok = o.indexOf(p) === o.indexOf(prev) + 1 || (o.indexOf(p) > o.indexOf(prev) && !o.slice(o.indexOf(prev) + 1, o.indexOf(p)).some(x => desired.includes(x) && desired.indexOf(x) > desired.indexOf(p)));
          if (!ok && attempt === 1) log(`Box ${p.box} did not move yet, trying once more.`, 'warn');
        }
        if (!ok) throw new Error(`Box ${p.box} would not move under ${prev.box}. Press "Record a drag" and do one drag by hand, then send me the result.`);
        done++;
        if (done % 5 === 0) log(`${done}/${moves.length} moved`);
      }
      const o = orderNow();
      const right = desired.every((p, i) => i === 0 || o.indexOf(p) > o.indexOf(desired[i - 1]));
      log(right ? `Done: ${desired.length} boxes of ${machine} are in plan order.` : 'Finished the moves, but the list does not look in plan order. Check it by eye.', right ? 'ok' : 'warn');
    } finally {
      scope = document;
    }
  }

  /** logs the calls the page makes (to learn what a drag sends) */
  let recording = null;
  function toggleRecord() {
    if (recording) {
      const text = JSON.stringify(recording.log, null, 1);
      recording.stop();
      recording = null;
      $('[data-act=record]').textContent = 'Record a drag';
      try {
        navigator.clipboard.writeText(text);
        log('Recording copied. Paste it to me.', 'ok');
      } catch {
        log('Select and copy the text below:', 'warn');
      }
      log(text.slice(0, 1800));
      return;
    }
    const logEntries = [];
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__rec = { method: m, url: String(u) };
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (b) {
      if (this.__rec) logEntries.push({ ...this.__rec, body: typeof b === 'string' ? b.slice(0, 700) : b ? '[binary]' : '' });
      return send.apply(this, arguments);
    };
    const f = window.fetch;
    if (f) window.fetch = function (u, o) {
      logEntries.push({ method: (o && o.method) || 'GET', url: String(u && u.url ? u.url : u), body: o && typeof o.body === 'string' ? o.body.slice(0, 700) : '' });
      return f.apply(this, arguments);
    };
    recording = { log: logEntries, stop: () => { XMLHttpRequest.prototype.open = open; XMLHttpRequest.prototype.send = send; if (f) window.fetch = f; } };
    $('[data-act=record]').textContent = 'Stop recording';
    log('Recording. Now drag ONE row in the Machines workload list by hand, then press "Stop recording".', 'ok');
  }

  function probe() {
    const lines = [];
    const add = (k, v) => lines.push(`${k}: ${v}`);
    add('path', location.pathname);
    add('hints', ['jQuery', 'Slick', 'Serenity', 'Q', 'select2'].filter(k => k in window).join(', ') || 'none');
    add('jquery', window.jQuery ? window.jQuery.fn.jquery : 'none');
    add('pager', JSON.stringify(pageInfo()));
    add('slick viewport', isSlick() ? 'yes' : 'no');
    add('headers', headerNames().join(' | '));
    const vp = slickViewport();
    if (vp) add('viewport', `height ${vp.clientHeight}, content ${vp.scrollHeight}`);
    const row = vp ? vp.querySelector('.slick-row') : q('tbody tr')[0];
    if (row) add('first row html', row.outerHTML.slice(0, 2000));
    add('tick elements', q(TICK_SEL).length);
    const dlg = q('.ui-dialog, [role="dialog"], .modal').filter(visible)[0];
    if (dlg) {
      add('open dialog headers', q('.slick-header-column', dlg).map(h => norm(h.textContent)).join(' | '));
      const r1 = dlg.querySelector('.slick-row');
      if (r1) add('dialog first row html', r1.outerHTML.slice(0, 2200));
      add('dialog html (start)', dlg.outerHTML.slice(0, 2500));
    }
    const text = lines.join('\n');
    try {
      navigator.clipboard.writeText(text);
      log('Page description copied. Paste it to me. (It holds one table row with box and order data.)', 'ok');
    } catch {
      log('Select and copy the text below:', 'warn');
    }
    log(text.slice(0, 1500));
  }

  panel.addEventListener('click', e => {
    const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
    if (!act) return;
    if (act === 'close') {
      panel.remove();
      style.remove();
      delete window.__cncHelper;
    } else if (act === 'min') {
      const b = $('[data-body]');
      b.style.display = b.style.display === 'none' ? 'flex' : 'none';
    } else if (act === 'check') guard(doCheck);
    else if (act === 'tick') guard(() => tickMachine($('[data-machine]').value));
    else if (act === 'clear') guard(untickAll);
    else if (act === 'send') guard(() => doSend(false));
    else if (act === 'resume') guard(() => doSend(true));
    else if (act === 'probe') guard(async () => probe());
    else if (act === 'order') guard(doOrder);
    else if (act === 'record') toggleRecord();
  });
  // drag by the title
  const bar = panel.querySelector('[data-drag]');
  let drag = null;
  bar.addEventListener('mousedown', e => {
    if (e.target !== bar && e.target.tagName !== 'B') return;
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    panel.style.left = e.clientX - drag.dx + 'px';
    panel.style.top = e.clientY - drag.dy + 'px';
  });
  window.addEventListener('mouseup', () => (drag = null));

  window.__cncHelper = { open: () => (panel.style.display = 'flex'), stop: () => (stop = true) };
  $('[data-machine]').addEventListener('change', () => keep({ machine: $('[data-machine]').value }));
  $('[data-one]').addEventListener('change', () => keep({ one: $('[data-one]').checked }));
  const saved = stored();
  if (saved.plan) {
    $('[data-plan]').value = saved.plan;
    readPlan();
    if (saved.machine && [...$('[data-machine]').options].some(o => o.value === saved.machine)) $('[data-machine]').value = saved.machine;
    $('[data-one]').checked = !!saved.one;
    const by = {};
    plan.forEach(p => (by[p.machine] = (by[p.machine] || 0) + 1));
    log(`Your plan from last time is back: ${plan.length} parts (${Object.entries(by).map(([m, n]) => `${m} ${n}`).join(', ')}).`, 'ok');
  }
  if (saved.last) log(`Before the page reloaded: ${saved.last.msg} (${saved.last.at})`, 'ok');
  if (saved.queue && saved.queue.remaining && saved.queue.remaining.length) {
    $('[data-act=resume]').style.display = '';
    log(`A send to ${saved.queue.machine} was interrupted by the page reload: ${saved.queue.remaining.length} of ${saved.queue.total} boxes are left. Press "Continue interrupted send".`, 'warn');
  }
  log(saved.plan ? 'Ready.' : 'Ready. Paste the plan above, pick a machine, press Check.');
})();
