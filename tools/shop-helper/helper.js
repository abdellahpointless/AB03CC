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

  // also timed by the work window when there is one: this tab may sit behind it, where the browser slows its timers down
  const sleep = ms =>
    new Promise(r => {
      setTimeout(r, ms);
      try {
        if (WIN !== window && !WIN.closed) WIN.setTimeout(r, ms);
      } catch {}
    });
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const visible = el => !!el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length) > 0;
  // the page the helper works on: this tab's page, or the same page in a second window (so its reloads do not stop us)
  let DOC = document;
  let WIN = window;
  const q = (sel, root = DOC) => [...root.querySelectorAll(sel)];
  const press = el => {
    el.scrollIntoView({ block: 'center' });
    const V = (el.ownerDocument && el.ownerDocument.defaultView) || WIN;
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new V.MouseEvent(t, { bubbles: true, cancelable: true, view: V }));
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
  let scope = DOC; // the whole page, or the dialog being worked on
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
    const m = /showing\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)/i.exec(DOC.body ? DOC.body.innerText : '');
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
    sel.dispatchEvent(new WIN.Event('change', { bubbles: true }));
    if (WIN.jQuery) WIN.jQuery(sel).trigger('change');
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
    // the counters live on window: a second run of the helper (same page) shares the hook installed by the first
    const net = (window.__cncNet = window.__cncNet || { inflight: 0, last: 0, hooked: false });
    if (!net.hooked) {
      net.hooked = true;
      const bump = d => {
        net.inflight = Math.max(0, net.inflight + d);
        net.last = Date.now();
      };
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function () {
        bump(1);
        this.addEventListener('loadend', () => bump(-1));
        return send.apply(this, arguments);
      };
      if (window.fetch) {
        const f = window.fetch;
        window.fetch = function () {
          bump(1);
          return f.apply(this, arguments).finally(() => bump(-1));
        };
      }
    }
    async function settle(maxMs = 25000) {
      const start = Date.now();
      // give the click a moment to start its request
      await waitFor(() => net.last >= start, 1500, 50);
      await waitFor(() => net.inflight === 0 && Date.now() - net.last > 350, maxMs, 100);
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
      const wo = woOf(row);
      const top = row.style.top;
      // the page reacted if it asked the server for something, or if this row was redrawn or moved away
      const reacted = before => net.last > before || !row.isConnected || woOf(row) !== wo || (vp() && ![...vp().querySelectorAll('.slick-row')].some(r => r.style.top === top && woOf(r) === wo));
      for (const i of order) {
        const before = net.last;
        const el = cands[i];
        press(el);
        if (el.tagName === 'A' || el.tagName === 'BUTTON') el.click();
        const went = await waitFor(() => reacted(before), 2500, 50);
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
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #334155"><b>Carpenter list</b><button data-a="close" style="all:unset;cursor:pointer;padding:0 6px">✕</button></div>
      <div style="padding:10px;display:flex;flex-direction:column;gap:8px">
        <label style="color:#94a3b8"><input type="radio" name="cnc-mode" value="missing" checked> Only rows with no PDF and no NC file (refreshed again, up to 3 times, until one of them is there)</label>
        <label style="color:#94a3b8"><input type="radio" name="cnc-mode" value="all"> Every row in the list</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button data-a="count" class="cnc-b">Count</button>
          <button data-a="run" class="cnc-b" style="background:#2563eb;border-color:#3b82f6">Refresh them all</button>
          <button data-a="stop" class="cnc-b">Stop</button>
          <button data-a="describe" class="cnc-b" title="Copies the HTML of the first row, for me to fit the script">Describe row</button>
          <button data-a="resume" class="cnc-b" style="display:none;background:#b45309;border-color:#f59e0b">Continue</button>
        </div>
        <div style="border-top:1px solid #334155;padding-top:8px"><b>Scan the cut parts</b> <span style="color:#94a3b8">in the planner's order (Carpenter tab → "Scan the cut parts" → copy the scan order)</span></div>
        <textarea data-scan rows="3" placeholder="Paste the scan order here (Work Order and MaterialNr on each line)" style="width:100%;box-sizing:border-box;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;font:11px ui-monospace,monospace"></textarea>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button data-a="scan" class="cnc-b" style="background:#15803d;border-color:#22c55e;font-weight:600">Start scanning</button>
          <button data-a="scanresume" class="cnc-b" style="display:none;background:#b45309;border-color:#f59e0b">Continue scanning</button>
          <button data-a="again" class="cnc-b" style="display:none">Open it again</button>
          <button data-a="skip" class="cnc-b" style="display:none">Skip this part</button>
        </div>
        <div data-now style="display:none;background:#1e3a8a;border:1px solid #3b82f6;border-radius:8px;padding:8px 10px;font-size:13px;line-height:1.4"></div>
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

    let woCol = -1;
    const woOf = r => norm(cell(r, woCol)?.textContent);
    function columns() {
      const wo = col(/^work\s*order/i);
      woCol = wo;
      if (wo < 0) throw new Error('Could not find the "Work Order" column.');
      return { wo, pdf: col(/^pdf/i), nc: col(/^nc\s*files?/i) };
    }
    const missing = (row, c) => [!hasFiles(cell(row, c.pdf)) && 'PDF', !hasFiles(cell(row, c.nc)) && 'NC'].filter(Boolean);
    // a row with a PDF or an NC file counts as good: only rows with neither are refreshed
    const needs = (row, c, m) => m === 'all' || missing(row, c).length === 2;

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
      log(`${seen.size} rows read, ${need} ${m === 'all' ? 'to refresh' : 'with no PDF and no NC file'}.`, 'ok');
    }

    const MAX_TRIES = 3;
    async function run(resume) {
      const c = columns();
      const st = resume ? load() : { mode: mode(), tries: {} };
      const tries = st.tries || {};
      const m = st.mode;
      if (!resume && !confirm(m === 'all' ? 'Press Refresh on every row of the list?' : 'Press Refresh on every row that has no PDF and no NC file?')) return log('Cancelled.');
      save({ mode: m, tries, running: true });
      let n = 0;
      let silent = 0;
      const t0 = Date.now();
      // a refreshed row can move anywhere in the list, so the list is walked again until a pass changes nothing
      for (let pass = 1; pass <= MAX_TRIES + 1 && !stopNow; pass++) {
        let changed = 0;
        await walk(async r => {
          const wo = woOf(r);
          if (!wo) return;
          const t = tries[wo] || 0;
          if (m === 'all' ? t >= 1 : t >= MAX_TRIES || !needs(r, c, m)) return;
          if (t > 0) await sleep(1200); // give the server a moment before asking the same row again
          const res = await clickRefresh(r);
          tries[wo] = t + 1;
          if (res !== 'ok') {
            silent++;
            if (silent <= 3) log(`Row ${wo}: ${res === 'none' ? 'no Refresh button found' : 'pressed Refresh but nothing happened'}.`, 'warn');
            if (silent >= 5 && n === 0) {
              stopNow = true;
              log('Stopped: Refresh does not react to the script. Press "Describe row" and send me the text it copies.', 'bad');
            }
            return;
          }
          await settle();
          n++;
          changed++;
          save({ mode: m, tries, running: true });
          if (n % 10 === 0) log(`${n} refreshes done (${Math.round((Date.now() - t0) / 1000)} s)`);
          return 'refreshed';
        });
        if (!changed || m === 'all') break;
        if (!stopNow) log(`Pass ${pass} done: ${changed} refreshes. Checking the list again for rows that still have no file.`);
      }
      if (stopNow) {
        log(`Stopped after ${n} refreshes. Press "Continue" to go on.`, 'warn');
        panel.querySelector('[data-a=resume]').style.display = '';
        return;
      }
      // what is still incomplete after the retries
      const left = [];
      if (m !== 'all') await walk(r => {
        const wo = woOf(r);
        const miss = missing(r, c);
        if (wo && miss.length === 2 && !left.some(x => x.wo === wo)) left.push({ wo, miss });
      });
      save({});
      panel.querySelector('[data-a=resume]').style.display = 'none';
      log(`Done: ${n} refreshes in ${Math.round((Date.now() - t0) / 1000)} s.`, 'ok');
      if (left.length) log(`${left.length} rows still have no PDF and no NC file after ${MAX_TRIES} tries (probably not uploaded yet): ${left.slice(0, 25).map(x => x.wo).join(', ')}${left.length > 25 ? ' …' : ''}`, 'warn');
    }

    /* ---------- scanning: Finish each part in the planner's order; the carpenter types the box code ---------- */
    const SCAN_KEY = 'cncHelper.scan.v1';
    const loadScan = () => {
      try {
        return JSON.parse(localStorage.getItem(SCAN_KEY) || 'null');
      } catch {
        return null;
      }
    };
    const saveScan = v => {
      try {
        if (v) localStorage.setItem(SCAN_KEY, JSON.stringify(v));
        else localStorage.removeItem(SCAN_KEY);
      } catch {
        /* storage blocked */
      }
    };
    /** lines of "Work Order, MaterialNr, …" (the planner's scan order, or rows of its Cut_Line sheet) */
    function parseScan(text) {
      const out = [];
      for (const line of text.split(/\r?\n/)) {
        const cells = line.split(/\t|;/).map(norm).filter(Boolean);
        const wo = cells.find(c => /^[136]\d{11}$/.test(c));
        if (!wo || out.some(x => x.wo === wo)) continue;
        const mat = [...cells].reverse().find(c => c !== wo && /^\d{6,9}$/.test(c)) || '';
        out.push({ wo, mat, label: cells.filter(c => c !== wo && c !== mat).join(' · ').slice(0, 90) });
      }
      return out;
    }
    const nowEl = panel.querySelector('[data-now]');
    const showNow = html => {
      nowEl.style.display = html ? '' : 'none';
      nowEl.innerHTML = html || '';
    };
    const show = (a, on) => (panel.querySelector(`[data-a=${a}]`).style.display = on ? '' : 'none');
    /** the list's own search box (not the menu search on the left) */
    function searchBox() {
      const ins = q('input').filter(visible).filter(i => !i.closest('#cnc-helper, .ui-dialog, aside, nav, .main-sidebar, .sidebar') && /^(text|search|)$/i.test(i.type || ''));
      const quick = ins.find(i => /quicksearch/i.test(i.className));
      if (quick) return quick;
      const grid = vp();
      const gy = grid ? grid.getBoundingClientRect().top : 0;
      const searchy = ins.filter(i => /search/i.test(i.placeholder || '') && i.getBoundingClientRect().top <= gy);
      return searchy.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0] || null;
    }
    async function setSearch(text) {
      const box = searchBox();
      if (!box) throw new Error('Could not find the search box above the list.');
      box.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, text);
      for (const t of ['input', 'keydown', 'keyup', 'change']) box.dispatchEvent(t.startsWith('key') ? new KeyboardEvent(t, { bubbles: true, key: 'Enter' }) : new Event(t, { bubbles: true }));
      await settle(20000);
    }
    /** the row of a work order, scrolling the (filtered) list if needed */
    async function findRow(wo) {
      const v = vp();
      if (!v) return null;
      v.scrollTop = 0;
      await sleep(120);
      for (let i = 0; i < 200; i++) {
        const r = [...v.querySelectorAll('.slick-row')].find(x => woOf(x) === wo);
        if (r) return r;
        if (v.scrollTop + v.clientHeight >= v.scrollHeight - 2) return null;
        v.scrollTop += Math.max(40, v.clientHeight - 40);
        await sleep(120);
      }
      return null;
    }
    const finishOf = row => row.querySelector('span.btn-finish, .btn.btn-finish, .btn-finish:not(i)') || row.querySelector('i.btn-finish, i.fa-check');
    const choiceBox = () => q('.ui-dialog, [role="dialog"], .modal').filter(visible).find(d => /choice\s*box|box\s*code/i.test(norm(d.textContent).slice(0, 300)));
    let scanChoice = null;

    async function scan(resume) {
      columns();
      let st = resume ? loadScan() : null;
      if (!st) {
        const list = parseScan(panel.querySelector('[data-scan]').value);
        if (!list.length) throw new Error('Paste the scan order first (from the planner: Carpenter tab → Scan the cut parts).');
        st = { list, i: 0, done: [], skipped: [] };
        log(`Scanning ${list.length} parts in the planner's order. For each one: type the box code in the "Choice Box" and press OK.`, 'ok');
      }
      saveScan(st);
      show('scanresume', false);
      while (st.i < st.list.length && !stopNow) {
        const p = st.list[st.i];
        const head = `<div style="font-size:11px;color:#bfdbfe">Part ${st.i + 1} of ${st.list.length}</div><div><b style="font-size:15px">${p.wo}</b>${p.mat ? ` · ${p.mat}` : ''}</div><div style="color:#cbd5e1">${p.label}</div>`;
        showNow(head + '<div style="color:#93c5fd">Finding it in the list…</div>');
        await setSearch(p.mat || p.wo);
        let row = await waitFor(() => vp() && [...vp().querySelectorAll('.slick-row')].find(x => woOf(x) === p.wo), 4000, 150);
        if (!row) row = await findRow(p.wo);
        if (!row) {
          log(`${p.wo}: not in the list (already scanned?), skipped.`, 'warn');
          st.skipped.push(p.wo);
          st.i++;
          saveScan(st);
          continue;
        }
        const fin = finishOf(row);
        if (!fin) throw new Error(`No Finish button on the row of ${p.wo}. Press "Describe row" and send me the text.`);
        press(row.querySelector('.slick-cell.l' + woCol) || row);
        await sleep(150);
        press(finishOf(row.isConnected ? row : (await findRow(p.wo)) || row));
        const dlg = await waitFor(choiceBox, 8000, 100);
        if (!dlg) throw new Error(`Pressed Finish for ${p.wo} but no "Choice Box" opened.`);
        // what the carpenter does in the box: OK / Enter = scanned, Cancel / ✕ / Escape = not
        const input = q('input', dlg).filter(visible).find(i => /^(text|)$/i.test(i.type || ''));
        let typed = '';
        let action = null;
        const onClick = e => {
          const b = e.target.closest('button, a, input[type="button"], input[type="submit"], .ui-dialog-titlebar-close');
          if (!b) return;
          const t = norm(b.textContent || b.value || b.title);
          if (/^ok$/i.test(t)) {
            action = 'ok';
            if (input) typed = input.value;
          }
          else if (/cancel|close|×|✕/i.test(t) || b.classList.contains('ui-dialog-titlebar-close')) action = 'cancel';
        };
        const onKey = e => {
          if (e.key === 'Enter') {
            action = 'ok';
            if (input) typed = input.value;
          }
          else if (e.key === 'Escape') action = 'cancel';
        };
        dlg.addEventListener('click', onClick, true);
        dlg.addEventListener('keydown', onKey, true);
        const note = document.createElement('div');
        note.id = 'cnc-scan-note';
        note.style.cssText = 'margin:6px 8px;padding:6px 8px;border-radius:6px;background:#dbeafe;color:#1e3a8a;font:12px system-ui,sans-serif';
        note.textContent = `Part ${st.i + 1}/${st.list.length} · ${p.wo} · ${p.label} → type the box code, then OK`;
        (dlg.querySelector('.ui-dialog-content') || dlg.querySelector('.ui-dialog-titlebar')?.nextElementSibling || dlg).prepend(note);
        if (input) input.focus();
        showNow(head + '<div style="margin-top:4px;font-size:14px;color:#fde68a"><b>Type the box code in the box and press OK</b></div>');
        while (dlg.isConnected && visible(dlg) && !stopNow) {
          if (input && input.value) typed = input.value;
          await sleep(200);
        }
        if (input && input.isConnected && input.value) typed = input.value;
        dlg.removeEventListener('click', onClick, true);
        dlg.removeEventListener('keydown', onKey, true);
        note.remove();
        if (stopNow) break;
        if (action === 'ok' || (!action && typed.trim())) {
          st.done.push({ wo: p.wo, box: typed.trim() });
          log(`✓ ${p.wo} → box ${typed.trim() || '?'}`, 'ok');
          st.i++;
          saveScan(st);
          showNow(head + '<div style="color:#86efac">Saved. Next part…</div>');
          await settle(20000);
          continue;
        }
        // closed without OK: ask what to do
        log(`${p.wo}: the box was closed without OK.`, 'warn');
        showNow(head + '<div style="margin-top:4px;color:#fde68a">The box was closed without OK. Open it again, or skip this part?</div>');
        scanChoice = null;
        show('again', true);
        show('skip', true);
        while (!scanChoice && !stopNow) await sleep(150);
        show('again', false);
        show('skip', false);
        if (scanChoice === 'skip') {
          st.skipped.push(p.wo);
          st.i++;
          saveScan(st);
        }
      }
      if (stopNow) {
        showNow('');
        show('scanresume', true);
        return log(`Scanning paused at part ${st.i + 1} of ${st.list.length}. Press "Continue scanning" to go on.`, 'warn');
      }
      await setSearch('');
      showNow('');
      saveScan(null);
      log(`Scanning done: ${st.done.length} parts scanned${st.skipped.length ? `, ${st.skipped.length} skipped (${st.skipped.slice(0, 10).join(', ')}${st.skipped.length > 10 ? ' …' : ''})` : ''}.`, 'ok');
    }

    const guard = async fn => {
      if (busy) return;
      busy = true;
      stopNow = false;
      panel.querySelectorAll('.cnc-b').forEach(b => !['stop', 'again', 'skip'].includes(b.getAttribute('data-a')) && (b.disabled = true));
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
      else if (a === 'scan') guard(() => scan(false));
      else if (a === 'scanresume') guard(() => scan(true));
      else if (a === 'again' || a === 'skip') scanChoice = a;
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
    if (st.running && st.tries && Object.keys(st.tries).length) {
      panel.querySelector('[data-a=resume]').style.display = '';
      log(`A refresh run was interrupted after ${Object.keys(st.tries).length} rows. Press "Continue" to go on with the rest.`, 'warn');
    }
    const sc = loadScan();
    if (sc && sc.list && sc.i < sc.list.length) {
      show('scanresume', true);
      log(`Scanning was paused at part ${sc.i + 1} of ${sc.list.length}. Press "Continue scanning" to go on.`, 'warn');
    }
    log('Ready. Refresh: "Count" shows how many rows need a refresh, "Refresh them all" presses Refresh on each. Scan: paste the scan order and press "Start scanning".');
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
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button data-act="all" class="cnc-b" style="background:#15803d;border-color:#22c55e;font-weight:600">Do everything: send all machines + order</button>
        <button data-act="autoresume" class="cnc-b" style="display:none;background:#b45309;border-color:#f59e0b">Continue the full run</button>
        <button data-act="stop" class="cnc-b">Stop</button>
      </div>
      <div style="color:#94a3b8">Or one machine at a time:</div>
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
    panel.querySelectorAll('.cnc-b').forEach(b => b.getAttribute('data-act') !== 'stop' && (b.disabled = true));
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
      native.dispatchEvent(new WIN.Event('change', { bubbles: true }));
      if (WIN.jQuery) WIN.jQuery(native).trigger('change');
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
        typed.dispatchEvent(new WIN.Event('input', { bubbles: true }));
        typed.dispatchEvent(new WIN.KeyboardEvent('keyup', { bubbles: true }));
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
    const before = DOC;
    const reloaded = () => !!work && popDoc() !== before;
    press(ok);
    await waitFor(() => !visible(dialog) || reloaded(), 10000);
    // the page reloads itself a moment after OK: in the work window we wait for it and carry on
    if (work) {
      if (await waitFor(reloaded, 8000, 100)) await workReady();
    }
    await sleep(800);
    await waitFor(() => slickViewport() && slickViewport().querySelector('.slick-row') && pageInfo(), 30000, 200);
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
    if (!auto && !confirm(`Send ${list.length} boxes to ${machine}${one ? ', one at a time in plan order' : ''}?${r.missing.length && !resume ? `\n\n${r.missing.length} are not in the list and will be skipped.` : ''}`)) return log('Cancelled.');
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

  const fire = (el, type, x, y, extra = {}) => el.dispatchEvent(new WIN.MouseEvent(type, { bubbles: true, cancelable: true, view: WIN, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1, ...extra }));
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
      fire(DOC, 'mousemove', x, y + dy);
      await sleep(30);
    }
    const tgt = await findTarget();
    if (!tgt) {
      fire(DOC, 'mouseup', x, y);
      return false;
    }
    const to = center(tgt.querySelector('.slick-cell.l' + boxIdx) || tgt);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const px = x + ((to.x - x) * i) / steps;
      const py = y + ((to.y - y) * i) / steps;
      const el = DOC.elementFromPoint(px, py) || tgt;
      fire(el, 'mousemove', px, py);
      fire(DOC, 'mousemove', px, py);
      await sleep(30);
    }
    const end = DOC.elementFromPoint(to.x, to.y) || tgt;
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

  async function doOrder(machineArg) {
    const dlg = workloadDialog();
    if (!dlg) throw new Error('Open the "Machines workload" list first (the button next to "Send to machine"), then press this again.');
    const machine = machineArg || $('[data-machine]').value;
    scope = dlg;
    try {
      const boxIdx = columnIndex(/^box\s*code/i) ?? columnIndex(/^bo/i);
      const ordIdx = columnIndex(/^order\s*number/i);
      if (boxIdx === null && ordIdx === null) throw new Error('The list has no Box Code or Order Number column.');
      let rows = await readWorkload(machine, boxIdx, ordIdx);
      const present = new Set(rows.filter(r => r.p).map(r => r.p));
      log(`List columns: box ${boxIdx}, order ${ordIdx}; ${rows.length} rows read, ${present.size} are ${machine} boxes.`);
      const desired = mineOf(machine).filter(p => present.has(p));
      if (desired.length < 2) {
        if (auto) return log(`${machine}: ${desired.length} of its boxes in the list, nothing to order.`);
        throw new Error(`Only ${desired.length} of ${machine}'s boxes are in this list: nothing to order.`);
      }
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
      if (!auto && !confirm(`Move ${moves.length} rows in the "${machine}" list to put its ${desired.length} boxes in plan order?`)) return log('Cancelled.');
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
      scope = DOC;
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

  /* ------------------------------------------------------------ everything at once */

  let auto = false;
  let work = null; // the second window the full run works in
  const popDoc = () => {
    try {
      return work && !work.closed ? work.document : null;
    } catch {
      return null;
    }
  };
  const workDocReady = () => {
    const d = popDoc();
    return d && d.readyState === 'complete' && d.querySelector('.slick-viewport .slick-row') ? d : null;
  };
  async function workReady() {
    const d = await waitFor(workDocReady, 60000, 250);
    if (!d) throw new Error(work && work.closed ? 'The work window was closed.' : 'The page in the work window did not load.');
    DOC = d;
    WIN = work;
    scope = DOC;
    await sleep(600);
  }
  /**
   * The same page in a second window, which this tab drives: when that page reloads after a send, the helper keeps
   * running here. It must be opened straight from a click, or the browser blocks it. It leaves the right side of the
   * screen free, so this panel stays in view.
   */
  function openWork() {
    if (work && !work.closed) return true;
    const w = Math.max(700, screen.availWidth - 470);
    try {
      work = window.open(location.href, 'cncHelperWork', `popup=yes,left=0,top=0,width=${w},height=${screen.availHeight}`);
    } catch {
      work = null;
    }
    return !!work;
  }
  function leaveWork(close) {
    if (close && work && !work.closed) work.close();
    work = null;
    DOC = document;
    WIN = window;
    scope = DOC;
  }
  const DIALOGS = '.ui-dialog, [role="dialog"], .modal';
  const machineName = t => norm(t).toUpperCase().replace(/\s*-\s*/, ' - ');
  /** the "Machine Staus" list that the "Machines workload" button opens: one row per machine, with its number of boxes */
  const statusDialog = () => q(DIALOGS).filter(visible).find(d => d !== workloadDialog() && /machine\s*sta/i.test(norm(d.textContent).slice(0, 80)) && d.querySelector('.slick-row'));
  const listOpen = () => {
    const d = workloadDialog();
    return d && d.querySelector('.slick-row') ? d : null;
  };
  /** opens the parts list of one machine: "Machines workload", then that machine in the "Machine Staus" list */
  async function openWorkload(machine) {
    if (workloadDialog()) {
      closeWorkload();
      await waitFor(() => !workloadDialog(), 4000, 100);
      await sleep(300);
    }
    let st = statusDialog();
    if (!st) {
      const btn = q('a, button, span, div, li').filter(visible).find(e => /^machines workload$/i.test(norm(e.textContent)) && e.children.length <= 2);
      if (!btn) throw new Error('Could not find the "Machines workload" button.');
      press(btn);
      await waitFor(() => statusDialog() || listOpen(), 20000, 200);
      st = statusDialog();
      if (!st) {
        if (listOpen()) return listOpen(); // a site that opens the parts list straight away
        throw new Error('After "Machines workload", neither the "Machine Staus" list nor a parts list opened.');
      }
      await sleep(400);
    }
    const row = await waitFor(() => q('.slick-row', st).find(r => q('.slick-cell', r).some(c => machineName(c.textContent) === machine)), 8000, 200);
    if (!row) throw new Error(`${machine} is not in the "Machine Staus" list.`);
    const cells = q('.slick-cell', row);
    const nameCell = cells.find(c => machineName(c.textContent) === machine);
    const heads = q('.slick-header-column', st).filter(visible).map(h => norm(h.textContent));
    const at = re => {
      const i = heads.findIndex(h => re.test(h));
      return i < 0 ? null : row.querySelector('.slick-cell.l' + i);
    };
    const boxCell = at(/total\s*box/i);
    const timeCell = at(/total\s*time/i);
    const dbl = el => {
      const V = el.ownerDocument.defaultView;
      el.dispatchEvent(new V.MouseEvent('dblclick', { bubbles: true, cancelable: true, view: V }));
    };
    // what opens a machine's list is not known for sure: the most likely first, and anything else that pops up is closed again
    const tries = [
      ['its Total Box number', boxCell && (boxCell.querySelector('a') || boxCell), press],
      ['its Total Time number', timeCell && (timeCell.querySelector('a') || timeCell), press],
      ['its name', nameCell && (nameCell.querySelector('a') || nameCell), press],
      ['a double click on its row', nameCell, dbl],
    ];
    for (const [what, el, act] of tries) {
      if (!el) continue;
      const before = new Set(q(DIALOGS).filter(visible));
      act(el);
      const d = await waitFor(listOpen, 5000, 150);
      if (d) {
        log(`${machine}: its list opened from ${what} in "Machine Staus".`);
        await sleep(500);
        return d;
      }
      for (const x of q(DIALOGS).filter(visible)) {
        if (before.has(x) || x === st) continue;
        const close = x.querySelector('.ui-dialog-titlebar-close') || q('button', x).find(b => /^(cancel|close)$/i.test(norm(b.textContent)));
        if (close) press(close);
      }
      await sleep(400);
    }
    throw new Error(`Could not open the list of ${machine} from "Machine Staus". Open it by hand once and tell me what you click.`);
  }
  function closeWorkload() {
    const d = workloadDialog();
    if (!d) return;
    const x = d.querySelector('.ui-dialog-titlebar-close') || q('button', d).find(b => /^(cancel|close)$/i.test(norm(b.textContent)));
    if (x) press(x);
  }
  function closeStatus() {
    const d = statusDialog();
    const x = d && (d.querySelector('.ui-dialog-titlebar-close') || q('button', d).find(b => /^(cancel|close)$/i.test(norm(b.textContent))));
    if (x) press(x);
  }

  /** a click on "Do everything" or "Continue the full run": the work window has to be opened inside the click */
  let armed = 0;
  function startAll(resume) {
    if (busy) return;
    if (!resume) {
      const machines = [...new Set(readPlan().map(p => p.machine))];
      if (!machines.length) return log('Paste the plan first (columns A to D of Plan_All).', 'warn');
      const btn = $('[data-act=all]');
      if (Date.now() - armed > 10000) {
        armed = Date.now();
        btn.textContent = `Press again to start: ${plan.length} parts to ${machines.join(', ')}`;
        setTimeout(() => (btn.textContent = 'Do everything: send all machines + order'), 10000);
        return;
      }
      armed = 0;
      btn.textContent = 'Do everything: send all machines + order';
    }
    if (!openWork()) {
      return log('The browser blocked the work window. Click the blocked pop-up sign at the right end of the address bar, choose "Always allow pop-ups" for this site, then press the button again.', 'err');
    }
    guard(() => runAll(resume));
  }

  async function runAll(resume) {
    const machines = [...new Set(readPlan().map(p => p.machine))];
    if (!machines.length) throw new Error('Paste the plan first (columns A to D of Plan_All).');
    let st = resume ? stored().auto : null;
    if (!st) st = { phase: 'send', i: 0, machines };
    auto = true;
    keep({ auto: st });
    $('[data-act=autoresume]').style.display = 'none';
    try {
      if (work) {
        log('Working in the second window. Leave it alone until I say done; its reloads do not stop me.', 'ok');
        await workReady();
      } else log('Working in this tab: when it reloads, run the helper again and it carries on by itself.', 'warn');
      while (st.phase === 'send' && st.i < st.machines.length) {
        if (stop) return log('Stopped. Press "Continue the full run" to go on.', 'warn');
        const m = st.machines[st.i];
        let r = await survey(m);
        if (r.others) {
          await untickAll();
          r = await survey(m);
        }
        const list = r.mine.filter(x => r.found.has(x));
        st = { ...st, i: st.i + 1 };
        if (!list.length) {
          log(`${m}: nothing to send (already sent, or not in the list).`);
          keep({ auto: st });
          continue;
        }
        const t = await tickMachine(m, undefined, r);
        if (!t.ticked) {
          log(`${m}: nothing could be ticked, skipped.`, 'warn');
          keep({ auto: st });
          continue;
        }
        // written before OK: if this tab reloads, the next run goes on with the next machine
        keep({ auto: st, last: { msg: `full run: sent ${t.ticked} boxes to ${m}`, at: nowText() } });
        log(`${m}: sending ${t.ticked} boxes…`);
        await sendTicked(m);
        log(`${m}: sent ${t.ticked} boxes.`, 'ok');
      }
      if (st.phase === 'send') {
        st = { ...st, phase: 'order', i: 0 };
        keep({ auto: st });
      }
      while (st.phase === 'order' && st.i < st.machines.length) {
        if (stop) return log('Stopped. Press "Continue the full run" to go on.', 'warn');
        const m = st.machines[st.i];
        for (let attempt = 1; ; attempt++) {
          try {
            await openWorkload(m);
            log(`${m}: putting its list in plan order…`);
            await doOrder(m);
            break;
          } catch (e) {
            if (attempt >= 3 || stop) throw e;
            log(`${m}: ${e && e.message ? e.message : e} Trying again.`, 'warn');
            if (work) await workReady();
            await sleep(1000);
          }
        }
        st = { ...st, i: st.i + 1 };
        keep({ auto: st });
      }
      closeWorkload();
      await sleep(400);
      closeStatus();
      keep({ auto: null, last: { msg: 'full run finished', at: nowText() } });
      log(`All done: every machine got its parts and its list is in plan order.${work ? ' You can close the second window.' : ''}`, 'ok');
      leaveWork(false);
    } catch (e) {
      $('[data-act=autoresume]').style.display = '';
      throw e;
    } finally {
      auto = false;
      // the other buttons work on this tab again; "Continue the full run" picks the second window up again
      DOC = document;
      WIN = window;
      scope = DOC;
    }
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
      leaveWork(true);
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
    else if (act === 'all') startAll(false);
    else if (act === 'autoresume') startAll(true);
    else if (act === 'stop') stop = true;
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
  if (saved.auto && saved.auto.machines) {
    $('[data-act=autoresume]').style.display = '';
    const where = saved.auto.phase === 'send' ? `sending, ${saved.auto.i} of ${saved.auto.machines.length} machines done` : `ordering, ${saved.auto.i} of ${saved.auto.machines.length} machines done`;
    log(`A full run was interrupted (${where}). It carries on in 5 seconds; press Stop to cancel.`, 'warn');
    setTimeout(() => {
      if (!stop && !busy) guard(() => runAll(true));
      else keep({ auto: null });
    }, 5000);
  }
  log(saved.plan ? 'Ready. "Do everything" sends every machine its parts and then orders every list.' : 'Ready. Paste the plan above, then press "Do everything" (or work one machine at a time).');
})();
