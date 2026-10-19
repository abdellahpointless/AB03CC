/*
 * Carpenter material chooser (temporary). Page: Digitalisation/CarpenterProduceList.
 * Press F12, open Console, paste this script, press Enter.
 *
 * Step 1 "Read the window": it opens the Change Material window of the first row, opens the Type list, and for every
 *   Type opens the Size list; for every Size it notes the Material the window fills in. Then it closes the window
 *   WITHOUT saving. Nothing is changed on the website.
 * Step 2 "Your choices": for every material the parts in the list use today, you choose: keep it, or change it to a
 *   Type + Size from the window. Your choices are kept in this browser; "Download" gives them as an Excel file, which
 *   is what the next script (the one that really changes the materials) will follow.
 */
(async function carpenterMaterialChooser() {
  const KEY_CAT = 'cnc-matcat.catalog';
  const KEY_CH = 'cnc-matcat.choices';
  const $ = window.jQuery;
  if (!$ || !$.fn || !$.fn.select2) {
    alert('Open the Carpenter Cutting List page of the website first, then run this again.');
    return;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 8000, step = 100) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      let v = null;
      try { v = fn(); } catch (e) { /* not yet */ }
      if (v) return v;
      await sleep(step);
    }
    return null;
  };
  const txt = (el) => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window */ } };
  const refOf = (t) => (String(t || '').match(/^\s*(\d{5,})/) || [])[1] || '';

  /* ------------------------------------------------------------------ panel */
  const old = document.getElementById('cnc-matcat');
  if (old) old.remove();
  const panel = document.createElement('div');
  panel.id = 'cnc-matcat';
  panel.style.cssText = 'position:fixed;top:12px;right:12px;bottom:12px;width:760px;max-width:calc(100vw - 24px);z-index:2147483647;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;font:13px system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5);display:flex;flex-direction:column';
  panel.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #334155"><b style="font-size:14px">Carpenter materials</b><span data-tabs style="display:flex;gap:4px;margin-left:12px"></span><button data-x style="margin-left:auto" class="cm-b">✕</button></div><div data-body style="flex:1;overflow:auto;padding:12px"></div>';
  const style = document.createElement('style');
  style.textContent = '#cnc-matcat .cm-b{all:unset;cursor:pointer;padding:5px 10px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#e2e8f0}#cnc-matcat .cm-b.on{background:#2563eb;border-color:#3b82f6}#cnc-matcat .cm-b.go{background:#15803d;border-color:#22c55e;font-weight:600}#cnc-matcat select,#cnc-matcat input{background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px;font:12px system-ui}#cnc-matcat table{border-collapse:collapse;width:100%}#cnc-matcat td,#cnc-matcat th{border-bottom:1px solid #1e293b;padding:6px 4px;text-align:left;vertical-align:top}#cnc-matcat th{color:#94a3b8;font-weight:600;position:sticky;top:-12px;background:#0f172a}#cnc-matcat .mut{color:#94a3b8;font-size:11px}';
  panel.appendChild(style);
  document.body.appendChild(panel);
  const body = panel.querySelector('[data-body]');
  const tabs = panel.querySelector('[data-tabs]');
  let stopped = false;
  panel.querySelector('[data-x]').onclick = () => { stopped = true; panel.remove(); };

  let catalog = load(KEY_CAT, null);
  let choices = load(KEY_CH, {});

  function setTabs(active) {
    tabs.innerHTML = '';
    for (const [id, label] of [['read', '1. Read the window'], ['list', 'Types and sizes'], ['choose', '2. Your choices']]) {
      const b = document.createElement('button');
      b.className = 'cm-b' + (id === active ? ' on' : '');
      b.textContent = label;
      if (id !== 'read' && !catalog) b.style.opacity = '.4';
      b.onclick = () => (id === 'read' ? showRead() : catalog ? (id === 'list' ? showList() : showChoose()) : null);
      tabs.appendChild(b);
    }
  }

  /* ------------------------------------------------------------------ step 1: read the window */
  const visibleDialog = () => [...document.querySelectorAll('.s-CarpenterChangeMaterialsDialog')]
    .filter((d) => d.offsetParent !== null && d.querySelector('input[name="Type"]')).pop();
  const chosenOf = (input) => { const c = document.getElementById('s2id_' + input.id); return c ? c.querySelector('.select2-chosen') : null; };

  async function openList(input) {
    $(input).select2('open');
    // this field's own drop-down (another field's closed list can still look "active")
    const own = () => { const s = $(input).data('select2'); return s && s.dropdown && s.dropdown[0]; };
    const drop = await waitFor(() => {
      const d = own() || document.querySelector('.select2-drop-active');
      return d && d.offsetParent !== null && !d.querySelector('.select2-searching') ? d : null;
    });
    if (!drop) return { drop: null, items: [] };
    // load every page of the list (long lists show more when scrolled to the end)
    let last = -1;
    for (let k = 0; k < 60; k++) {
      const ul = drop.querySelector('.select2-results');
      const more = drop.querySelector('.select2-more-results');
      const n = drop.querySelectorAll('li.select2-result-selectable').length;
      if (!more && n === last && k > 2) break;
      if (more && ul) { ul.scrollTop = ul.scrollHeight; ul.dispatchEvent(new Event('scroll')); }
      last = n;
      await sleep(150);
    }
    const items = [...drop.querySelectorAll('li.select2-result-selectable')].map((li) => ({ li, text: txt(li.querySelector('.select2-result-label') || li) }));
    return { drop, items };
  }
  const closeList = (input) => { try { $(input).select2('close'); } catch (e) { /* closed */ } };

  async function readOptions(input) {
    const { items } = await openList(input);
    closeList(input);
    return items.map((i) => i.text).filter(Boolean);
  }

  async function choose(input, text) {
    const { items } = await openList(input);
    const hit = items.find((i) => i.text === text);
    if (hit) {
      const lab = hit.li.querySelector('.select2-result-label') || hit.li;
      lab.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      lab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      let ok = await waitFor(() => txt(chosenOf(input)) === text, 1500);
      if (!ok) {
        const data = $(hit.li).data('select2-data');
        if (data) { $(input).select2('data', data, true); ok = await waitFor(() => txt(chosenOf(input)) === text, 1500); }
      }
      closeList(input);
      return Boolean(ok);
    }
    closeList(input);
    return false;
  }

  async function readWindow(log) {
    const btn = document.querySelector('.btn-change-mat');
    let dlg = visibleDialog();
    if (!dlg) {
      if (!btn) throw new Error('No "Change Material" button on this page. Open the Carpenter Cutting List with at least one row.');
      btn.click();
      dlg = await waitFor(visibleDialog, 10000);
    }
    if (!dlg) throw new Error('The Change Material window did not open. Open it once by hand, leave it open, and press Start again.');
    const inp = (n) => dlg.querySelector('input[name="' + n + '"]');
    const typeIn = inp('Type');
    const sizeIn = inp('Size');
    const matIn = inp('MaterialId');
    const types = await readOptions(typeIn);
    log('Found ' + types.length + ' types: ' + types.join(', '));
    const rows = [];
    for (let t = 0; t < types.length && !stopped; t++) {
      const type = types[t];
      if (!(await choose(typeIn, type))) { log('⚠ could not choose type ' + type); rows.push({ type, size: '', material: '', note: 'could not choose this type' }); continue; }
      await sleep(400);
      const sizes = await readOptions(sizeIn);
      log('(' + (t + 1) + '/' + types.length + ') ' + type + ': ' + (sizes.length ? sizes.join(', ') : 'no sizes'));
      if (!sizes.length) rows.push({ type, size: '', material: '', note: 'no sizes' });
      for (const size of sizes) {
        if (stopped) break;
        const before = matIn ? txt(chosenOf(matIn)) : '';
        if (!(await choose(sizeIn, size))) { rows.push({ type, size, material: '', note: 'could not choose this size' }); continue; }
        // the window fills the material by itself: wait until it changes (or 4 s)
        await waitFor(() => matIn && txt(chosenOf(matIn)) !== before && txt(chosenOf(matIn)) !== '--select--', 4000);
        await sleep(250);
        let material = matIn ? txt(chosenOf(matIn)) : '';
        if (material === '--select--') material = '';
        const comp = inp('Component');
        rows.push({ type, size, material, component: comp ? comp.value : '', note: material ? '' : 'no material filled in' });
      }
    }
    // close WITHOUT saving
    const wrap = dlg.closest('.ui-dialog') || dlg;
    const x = wrap.querySelector('.ui-dialog-titlebar-close');
    if (x) x.click();
    return rows;
  }

  function showRead() {
    setTabs('read');
    body.innerHTML = '<p>The script opens the <b>Change Material</b> window of the first row, goes through every <b>Type</b> and every <b>Size</b>, and notes the <b>Material</b> the window fills in. Then it closes the window <b>without saving</b>: nothing changes on the website.</p>'
      + '<p class="mut">It takes a few minutes. Please do not click on the page while it runs.' + (catalog ? ' Last read: ' + esc(catalog.when) + ', ' + catalog.rows.length + ' choices.' : '') + '</p>'
      + '<div style="display:flex;gap:6px;margin:10px 0"><button data-go class="cm-b go">Start</button><button data-stop class="cm-b">Stop</button></div>'
      + '<pre data-log style="white-space:pre-wrap;background:#020617;border:1px solid #1e293b;border-radius:6px;padding:8px;font:11px ui-monospace,monospace;max-height:60vh;overflow:auto"></pre>';
    const pre = body.querySelector('[data-log]');
    const log = (m) => { pre.textContent += m + '\n'; pre.scrollTop = pre.scrollHeight; };
    body.querySelector('[data-stop]').onclick = () => { stopped = true; log('Stopping…'); };
    body.querySelector('[data-go]').onclick = async () => {
      stopped = false;
      pre.textContent = '';
      try {
        const rows = await readWindow(log);
        if (!rows.length) { log('Nothing read.'); return; }
        catalog = { when: new Date().toLocaleString(), rows, partial: stopped };
        save(KEY_CAT, catalog);
        log((stopped ? 'Stopped. Kept what was read: ' : 'Done: ') + rows.length + ' Type + Size choices.');
        setTimeout(showList, 800);
      } catch (e) {
        log('✗ ' + (e && e.message || e));
      }
    };
  }

  /* ------------------------------------------------------------------ types and sizes */
  const byType = () => {
    const m = new Map();
    for (const r of catalog.rows) { if (!m.has(r.type)) m.set(r.type, []); m.get(r.type).push(r); }
    return m;
  };
  function showList() {
    setTabs('list');
    const m = byType();
    let h = '<p class="mut">' + m.size + ' types, ' + catalog.rows.length + ' Type + Size choices (read ' + esc(catalog.when) + (catalog.partial ? ', stopped before the end' : '') + ').</p><table><tr><th>Type</th><th>Size</th><th>Material the window fills in</th></tr>';
    for (const [type, rows] of m) {
      rows.forEach((r, i) => {
        h += '<tr><td>' + (i ? '' : '<b>' + esc(type) + '</b>') + '</td><td>' + esc(r.size || '—') + '</td><td>' + esc(r.material || '') + (r.note ? ' <span class="mut">(' + esc(r.note) + ')</span>' : '') + '</td></tr>';
      });
    }
    body.innerHTML = h + '</table>';
  }

  /* ------------------------------------------------------------------ step 2: your choices */
  async function materialsInUse() {
    const S = window.Serenity;
    const gridEl = document.querySelector('.s-DataGrid');
    let grid = null;
    try { grid = S && $(gridEl).getWidget(S.DataGrid); } catch (e) { grid = null; }
    let rows = [];
    let columns = [];
    if (grid) {
      const slick = (grid.getGrid && grid.getGrid()) || grid.slickGrid;
      columns = (slick && slick.getColumns && slick.getColumns()) || [];
      const view = (grid.getView && grid.getView()) || grid.view;
      rows = (grid.getItems && grid.getItems()) || (view && view.getItems && view.getItems()) || [];
      const total = view && (view.totalCount || (view.get_totalCount && view.get_totalCount())) || 0;
      if (view && view.url && window.Q && (!total || total > rows.length)) {
        try {
          const request = Object.assign({}, view.params || {}, { Skip: 0, Take: 0 });
          const resp = await new Promise((res, rej) => window.Q.serviceCall({ url: view.url, request, onSuccess: res, onError: rej, blockUI: true }));
          if (resp && Array.isArray(resp.Entities) && resp.Entities.length > rows.length) rows = resp.Entities;
        } catch (e) { /* keep the rows on screen */ }
      }
    }
    const col = (re) => { const c = columns.find((x) => re.test(String(x.name || '').replace(/<[^>]*>/g, '').trim()) || re.test(String(x.field || ''))); return c && c.field; };
    const f = { board: col(/^description\s*de$/i) || col(/description/i), type: col(/^materialtype$/i), name: col(/^m\.?\s*text$/i), qty: col(/^qty$/i) };
    const groups = new Map();
    for (const r of rows) {
      const board = String(r[f.board] || '').trim();
      const type = String(r[f.type] || '').trim();
      const key = type + '|' + board;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { key, type, board, parts: 0, qty: 0, names: new Set() }));
      g.parts++;
      g.qty += Number(r[f.qty]) || 0;
      if (r[f.name]) g.names.add(String(r[f.name]).trim());
    }
    return [...groups.values()].sort((a, b) => a.type.localeCompare(b.type) || b.parts - a.parts);
  }

  async function showChoose() {
    setTabs('choose');
    body.innerHTML = '<p class="mut">Reading the parts of the list…</p>';
    const used = await materialsInUse();
    if (!used.length) { body.innerHTML = '<p>Could not read the rows of the list. Open the Carpenter Cutting List (tick "Show All Orders" for every part) and press "2. Your choices" again.</p>'; return; }
    const m = byType();
    const opts = (sel) => '<option value="">Keep it (no change)</option>' + [...m].map(([type, rows]) => '<optgroup label="' + esc(type) + '">'
      + rows.filter((r) => r.size).map((r) => { const v = r.type + '|' + r.size; return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(r.type + ' · ' + r.size + (r.material ? '  →  ' + r.material : '')) + '</option>'; }).join('')
      + '</optgroup>').join('');
    let h = '<p>For every material the parts use today, choose what the carpenter must change it to. <b>Keep it</b> = no change.</p>'
      + '<div style="display:flex;gap:6px;align-items:center;margin:8px 0"><input data-q placeholder="Search…" style="flex:1"><button data-dl class="cm-b go">Download (Excel)</button><button data-cp class="cm-b">Copy</button></div>'
      + '<table><tr><th>Material now</th><th>Parts</th><th>Change to</th><th>ChangeType</th></tr>';
    for (const g of used) {
      const c = choices[g.key] || {};
      const same = catalog.rows.find((r) => r.material && refOf(r.material) && refOf(r.material) === refOf(g.board));
      h += '<tr data-k="' + esc(g.key) + '"><td><b>' + esc(g.type || '?') + '</b> ' + esc(g.board || '(empty)') + '<div class="mut">' + esc([...g.names].slice(0, 3).join(', ')) + (same ? ' · in the window as ' + esc(same.type + ' · ' + same.size) : '') + '</div></td>'
        + '<td>' + g.parts + '<div class="mut">' + g.qty + ' pcs</div></td>'
        + '<td><select data-to style="width:330px">' + opts(c.to || '') + '</select></td>'
        + '<td><select data-ct><option' + (c.changeType === 'Permanent' ? '' : ' selected') + '>Temporary</option><option' + (c.changeType === 'Permanent' ? ' selected' : '') + '>Permanent</option></select></td></tr>';
    }
    body.innerHTML = h + '</table>';
    const store = () => {
      for (const tr of body.querySelectorAll('tr[data-k]')) {
        const to = tr.querySelector('[data-to]').value;
        const changeType = tr.querySelector('[data-ct]').value;
        if (to) choices[tr.dataset.k] = { to, changeType }; else delete choices[tr.dataset.k];
      }
      save(KEY_CH, choices);
    };
    body.addEventListener('change', store);
    body.querySelector('[data-q]').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      for (const tr of body.querySelectorAll('tr[data-k]')) tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    };
    const table = () => used.map((g) => {
      const c = choices[g.key];
      const [type, size] = c ? c.to.split('|') : ['', ''];
      const r = c && catalog.rows.find((x) => x.type === type && x.size === size);
      return { 'Material type now': g.type, 'Material now': g.board, Parts: g.parts, Pieces: g.qty, Decision: c ? 'Change' : 'Keep', ChangeType: c ? c.changeType : '', Type: type, Size: size, 'Material it becomes': r ? r.material : '' };
    });
    body.querySelector('[data-cp]').onclick = async () => {
      store();
      const t = table();
      const tsv = [Object.keys(t[0]).join('\t'), ...t.map((r) => Object.values(r).join('\t'))].join('\n');
      try { await navigator.clipboard.writeText(tsv); alert('Copied: paste it into Excel or send it to me.'); } catch (e) { prompt('Copy this:', tsv); }
    };
    body.querySelector('[data-dl]').onclick = () => {
      store();
      const t = table();
      const cell = (v) => '<Cell><Data ss:Type="' + (typeof v === 'number' ? 'Number' : 'String') + '">' + esc(v) + '</Data></Cell>';
      const sheet = (name, rows) => '<Worksheet ss:Name="' + esc(name) + '"><Table><Row>' + Object.keys(rows[0]).map((k) => '<Cell ss:StyleID="h"><Data ss:Type="String">' + esc(k) + '</Data></Cell>').join('') + '</Row>'
        + rows.map((r) => '<Row>' + Object.values(r).map(cell).join('') + '</Row>').join('') + '</Table></Worksheet>';
      const cat = catalog.rows.map((r) => ({ Type: r.type, Size: r.size, Material: r.material, Note: r.note || '' }));
      const xml = '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#FDE68A" ss:Pattern="Solid"/></Style></Styles>'
        + sheet('Choices', t) + sheet('Types and sizes', cat) + '</Workbook>';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.ms-excel' }));
      a.download = 'carpenter-material-choices.xml';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    };
  }

  if (catalog) showChoose(); else showRead();
})();
