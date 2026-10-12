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
  const slickViewport = () => q('.slick-viewport').filter(visible).sort((x, y) => y.clientHeight * y.clientWidth - x.clientHeight * x.clientWidth)[0] || null;
  const isSlick = () => !!slickViewport();

  /** column names in order (header cells) */
  function headerNames() {
    if (isSlick()) return q('.slick-header-column').filter(visible).map(h => norm((h.querySelector('.slick-column-name') || h).textContent));
    return q('th, [role="columnheader"]').filter(visible).map(h => norm(h.textContent));
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
  async function setTick(row, on) {
    if (isTicked(row) === on) return true;
    const c = checkboxOf(row);
    if (!c) return false;
    press(c);
    await sleep(80);
    let now = freshRow(row);
    if (isTicked(now) !== on && c.tagName === 'INPUT') {
      press(c.closest('label, .e-checkbox-wrapper, td') || c);
      await sleep(80);
      now = freshRow(row);
    }
    return isTicked(now) === on;
  }

  /** calls fn(row) for every row of the grid once; for SlickGrid it scrolls down the list so every row gets drawn */
  async function scan(fn) {
    if (!isSlick()) {
      for (const r of q('tbody tr, [role="row"]').filter(r => visible(r) && checkboxOf(r) && !r.querySelector('th'))) {
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
          vp.scrollTop = 0;
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
  let plan = [];
  const readPlan = () => {
    plan = parsePlan($('[data-plan]').value);
    const machines = [...new Set(plan.map(p => p.machine))];
    const sel = $('[data-machine]');
    const keep = sel.value;
    sel.innerHTML = machines.map(m => `<option>${m}</option>`).join('');
    if (machines.includes(keep)) sel.value = keep;
    return plan;
  };
  $('[data-plan]').addEventListener('input', () => {
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
    let ok = 0;
    const failed = [];
    const done = new Set();
    const target = [...want].filter(p => r.found.has(p)).length;
    await scan(async row => {
      const p = r.match(row);
      if (!p || !want.has(p)) return;
      if (await setTick(row, true)) ok++;
      else failed.push(p.box);
      done.add(p);
      if (done.size >= target) return 'done'; // everything wanted is ticked: no need to read the rest of the list
    });
    log(`${machine}: ticked ${ok} of ${target}${r.missing.length ? `, ${r.missing.length} not found (${r.missing.map(m => m.box || m.order).join(', ')})` : ''}${failed.length ? `, could not tick ${failed.join(', ')}` : ''}.`, ok === target && !r.missing.length ? 'ok' : 'warn');
    return { ...r, ticked: ok };
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
    await sleep(600);
  }

  async function doSend() {
    const machine = $('[data-machine]').value;
    const one = $('[data-one]').checked;
    const r = await survey(machine);
    if (!r.found.size) throw new Error('Nothing to send: no box of this machine is in the list.');
    if (r.others) throw new Error(`${r.others} other rows are ticked. Press "Untick all" first.`);
    if (!confirm(`Send ${r.found.size} boxes to ${machine}${one ? ', one at a time in plan order' : ''}?${r.missing.length ? `\n\n${r.missing.length} are not in the list and will be skipped.` : ''}`)) return log('Cancelled.');
    if (!one) {
      const t = await tickMachine(machine, undefined, r);
      if (stop) return;
      if (t.ticked !== r.found.size) throw new Error(`Only ${t.ticked} of ${r.found.size} could be ticked: nothing was sent.`);
      await sendTicked(machine);
      log(`Sent ${r.found.size} boxes to ${machine}. Check the machine's workload.`, 'ok');
      return;
    }
    let n = 0;
    for (const p of r.mine.filter(x => r.found.has(x))) {
      if (stop) return log('Stopped.');
      const t = await tickMachine(machine, [p], r);
      if (!t.ticked) {
        log(`Box ${p.box} could not be ticked (already sent?): skipped.`, 'warn');
        continue;
      }
      await sendTicked(machine);
      n++;
      log(`${n}/${r.found.size} sent: ${p.box}`, 'ok');
    }
    log(`Sent ${n} boxes to ${machine} in plan order.`, 'ok');
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
    if (dlg) add('open dialog html', dlg.outerHTML.slice(0, 3000));
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
    else if (act === 'send') guard(doSend);
    else if (act === 'probe') guard(async () => probe());
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
  log('Ready. Paste the plan above, pick a machine, press Check.');
})();
