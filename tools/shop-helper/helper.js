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

  const HEADER_SEL = 'th, [role="columnheader"], .e-headercell, .k-header, .dx-header-row td';
  const ROW_SEL = 'tbody tr, [role="row"]';

  function headerCells() {
    return q(HEADER_SEL).filter(visible);
  }
  /** index of a column among its row's cells, by header text */
  function columnIndex(re) {
    const h = headerCells().find(c => re.test(norm(c.textContent)));
    if (!h) return null;
    const row = h.parentElement;
    const cells = [...row.children];
    return { header: h, index: cells.indexOf(h), count: cells.length };
  }
  function dataRows() {
    return q(ROW_SEL).filter(r => visible(r) && !r.querySelector('th, [role="columnheader"]') && r.querySelector('input[type="checkbox"], [role="checkbox"], .e-checkbox-wrapper'));
  }
  const cellOf = (row, index) => [...row.children][index];
  function checkboxOf(row) {
    return row.querySelector('input[type="checkbox"]') || row.querySelector('[role="checkbox"]') || row.querySelector('.e-checkbox-wrapper, .e-frame');
  }
  function isTicked(row) {
    const c = checkboxOf(row);
    if (!c) return false;
    if (c.tagName === 'INPUT') return c.checked;
    return c.getAttribute('aria-checked') === 'true' || /checked|e-check/.test(c.className) || row.getAttribute('aria-selected') === 'true';
  }
  async function setTick(row, on) {
    if (isTicked(row) === on) return true;
    const c = checkboxOf(row);
    if (!c) return false;
    press(c);
    await sleep(40);
    if (isTicked(row) !== on && c.tagName === 'INPUT') {
      // some grids listen on the wrapper
      press(c.closest('label, .e-checkbox-wrapper, td') || c);
      await sleep(40);
    }
    return isTicked(row) === on;
  }

  function pageInfo() {
    const m = /showing\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)/i.exec(document.body.innerText);
    return m ? { from: +m[1], to: +m[2], total: +m[3] } : null;
  }
  /** shows every record on one page, when the page offers a size that is big enough */
  async function showAll(log) {
    const info = pageInfo();
    if (!info || info.to - info.from + 1 >= info.total) return true;
    const sel = q('select').find(s => visible(s) && [...s.options].some(o => +o.value >= 100 || +norm(o.textContent) >= 100));
    if (!sel) {
      log('Could not find the page-size list (the "100" at the bottom). Set it to the largest size yourself, then try again.', 'warn');
      return false;
    }
    const opts = [...sel.options].map(o => ({ o, n: +o.value || +norm(o.textContent) || 0 })).sort((a, b) => b.n - a.n);
    const best = opts.find(x => x.n >= info.total) || opts[0];
    sel.value = best.o.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const ok = await waitFor(() => dataRows().length >= Math.min(info.total, best.n), 15000, 250);
    await sleep(300);
    const after = pageInfo();
    if (!ok || !after || after.to - after.from + 1 < info.total) log(`The page shows ${dataRows().length} of ${info.total} rows. Choose a bigger page size, or work in rounds.`, 'warn');
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

  /** the rows of this page that belong to the chosen machine, in plan order; reports what it could not find */
  async function locate(machine) {
    const mine = readPlan().filter(p => p.machine === machine).sort((a, b) => a.seq - b.seq);
    if (!mine.length) throw new Error('Paste the plan first and choose a machine.');
    await showAll(log);
    const boxCol = columnIndex(/^box\s*code/i);
    const ordCol = columnIndex(/^order\s*number/i);
    if (!boxCol && !ordCol) throw new Error('Could not find the "Box Code" or "Order Number" column. Press "Describe page" and send me the result.');
    const rows = dataRows();
    if (!rows.length) throw new Error('Could not find the table rows. Press "Describe page" and send me the result.');
    const byOrder = new Map();
    const byBox = new Map();
    for (const r of rows) {
      if (ordCol) byOrder.set(norm(cellOf(r, ordCol.index)?.textContent), r);
      if (boxCol) {
        const b = norm(cellOf(r, boxCol.index)?.textContent).padStart(4, '0');
        byBox.set(b, [...(byBox.get(b) || []), r]);
      }
    }
    const found = [];
    const missing = [];
    for (const p of mine) {
      let row = p.order ? byOrder.get(p.order) : undefined;
      if (!row && p.box) {
        const c = byBox.get(p.box) || [];
        if (c.length === 1) row = c[0];
        else if (c.length > 1) log(`Box ${p.box} appears ${c.length} times on the page and the order number was not copied: skipped.`, 'warn');
      }
      if (row) found.push({ p, row });
      else missing.push(p);
    }
    return { mine, found, missing, rows };
  }

  async function doCheck() {
    const machine = $('[data-machine]').value;
    const { mine, found, missing, rows } = await locate(machine);
    log(`${machine}: ${mine.length} in the plan, ${found.length} found on this page (${rows.length} rows shown), ${missing.length} not found.`, missing.length ? 'warn' : 'ok');
    if (missing.length) log('Not found: ' + missing.map(m => m.box || m.order).join(', ') + ' (already sent, filtered out, or on another page)', 'warn');
    const already = found.filter(f => isTicked(f.row)).length;
    if (already) log(`${already} of them are already ticked.`);
    const others = rows.filter(r => isTicked(r) && !found.some(f => f.row === r)).length;
    if (others) log(`${others} other rows are ticked. "Untick all" clears them.`, 'warn');
  }

  async function untickAll() {
    let n = 0;
    for (const r of dataRows()) if (isTicked(r)) {
      if (await setTick(r, false)) n++;
    }
    log(`Unticked ${n} rows.`);
  }

  async function tickMachine(machine, allowedOthers = false) {
    const { found, missing, rows } = await locate(machine);
    const others = rows.filter(r => isTicked(r) && !found.some(f => f.row === r));
    if (others.length && !allowedOthers) throw new Error(`${others.length} other rows are ticked. Press "Untick all" first.`);
    let ok = 0;
    for (const f of found) {
      if (stop) break;
      if (await setTick(f.row, true)) ok++;
      else log(`Could not tick box ${f.p.box}.`, 'warn');
    }
    log(`${machine}: ticked ${ok} of ${found.length}${missing.length ? `, ${missing.length} not found (${missing.map(m => m.box || m.order).join(', ')})` : ''}.`, ok === found.length && !missing.length ? 'ok' : 'warn');
    return { found, missing, ticked: ok };
  }

  /** "Send to machine" -> dialog -> pick the machine -> OK */
  async function sendTicked(machine) {
    const btn = [...q('a, button, span, div, li')].filter(visible).find(e => /^send to machine$/i.test(norm(e.textContent)) && e.children.length <= 2);
    if (!btn) throw new Error('Could not find the "Send to machine" button.');
    press(btn);
    const dialog = await waitFor(() => q('[role="dialog"], .modal, .e-dialog, .k-window, .ui-dialog, .dialog, div').filter(visible).find(d => /choice machine|choose machine/i.test(norm(d.firstElementChild?.textContent || '')) || (/choice machine/i.test(norm(d.textContent)) && d.textContent.length < 300)), 8000);
    if (!dialog) throw new Error('The "Choice Machine" box did not open.');
    const native = dialog.querySelector('select');
    if (native) {
      const o = [...native.options].find(x => norm(x.textContent).toLowerCase() === machine.toLowerCase());
      if (!o) throw new Error(`The list has no machine "${machine}".`);
      native.value = o.value;
      native.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const field =
        dialog.querySelector('[role="combobox"], .e-ddl, .select2-selection, .k-dropdown, .k-input, .dropdown, input[placeholder], input[type="text"]') ||
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
      const item = await waitFor(() => q('li, [role="option"], .e-list-item, .select2-results__option, .k-item').filter(visible).find(e => norm(e.textContent).toLowerCase() === machine.toLowerCase()), 5000);
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
    const { mine, found, missing } = await locate(machine);
    if (!found.length) throw new Error('Nothing to send: no box of this machine is on the page.');
    if (!confirm(`Send ${found.length} boxes to ${machine}${one ? ', one at a time in plan order' : ''}?${missing.length ? `\n\n${missing.length} are not on this page and will be skipped.` : ''}`)) return log('Cancelled.');
    if (!one) {
      await tickMachine(machine);
      if (stop) return;
      await sendTicked(machine);
      log(`Sent ${found.length} boxes to ${machine}. Check the machine's workload.`, 'ok');
      return;
    }
    let n = 0;
    for (const f of found) {
      if (stop) return log('Stopped.');
      await untickAll();
      const fresh = (await locate(machine)).found.find(x => x.p === f.p || (x.p.order && x.p.order === f.p.order) || (x.p.box && x.p.box === f.p.box));
      if (!fresh) {
        log(`Box ${f.p.box} is no longer listed (already sent?): skipped.`, 'warn');
        continue;
      }
      if (!(await setTick(fresh.row, true))) throw new Error(`Could not tick box ${f.p.box}.`);
      await sendTicked(machine);
      n++;
      log(`${n}/${found.length} sent: ${f.p.box}`);
    }
    log(`Sent ${n} boxes to ${machine} in plan order.`, 'ok');
  }

  function probe() {
    const lines = [];
    const add = (k, v) => lines.push(`${k}: ${v}`);
    add('path', location.pathname);
    add('hints', ['jQuery', 'ej', 'kendo', 'DevExpress', 'Vue', 'angular', 'React', 'DataTable', 'Tabulator', 'agGrid'].filter(k => k in window).join(', ') || 'none');
    add('pager', JSON.stringify(pageInfo()));
    add('headers', headerCells().map(c => norm(c.textContent) || '(empty)').join(' | '));
    const rows = dataRows();
    add('data rows seen', rows.length);
    if (rows[0]) add('first row html', rows[0].outerHTML.slice(0, 1800));
    add('toolbar', [...q('a, button')].filter(visible).map(e => norm(e.textContent)).filter(t => t && t.length < 30).slice(0, 40).join(' | '));
    add('selects', q('select').filter(visible).map(s => s.outerHTML.slice(0, 300)).join('\n'));
    const d = q('[role="dialog"], .modal, .e-dialog, .k-window, .ui-dialog').filter(visible)[0];
    if (d) add('open dialog html', d.outerHTML.slice(0, 2500));
    const text = lines.join('\n');
    try {
      navigator.clipboard.writeText(text);
      log('Page description copied. Paste it to me. (It contains one table row with box and order data.)', 'ok');
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
