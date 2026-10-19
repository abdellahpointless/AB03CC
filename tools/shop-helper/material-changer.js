/*
 * Carpenter material changer. Page: Digitalisation/CarpenterProduceList.
 * Press F12, open Console, paste this script, press Enter. A panel opens: press "Check" (changes nothing),
 * then "Start".
 *
 * For every row of the list it reads the material the part uses now (column "Description De", by its number).
 * When the replacement table below says that material is replaced, it opens the row's Change Material window,
 * sets ChangeType = Temporary, the Type and the Size, checks that the window filled in the expected material,
 * and saves. Rows whose material is not in the table are skipped.
 * Every saved row is remembered in this browser, so a stopped or reloaded run carries on where it was.
 */
(async function carpenterMaterialChanger() {
  // material number now, material now, -> Type, Size, material the window must fill in
  // (from "Carpenter material replacements.xlsx": the lines marked Replace)
  const RULES = [
  ["103401", "103401 - Trolitax epoksit 10mm", "POM", "20mm", "114926 - POM 20mm Plattenmaterial schw."],
  ["103402", "103402 - Trolitax epoksit15mm", "POM", "30mm", "108001 - POM 30mm Plattenmaterial schw."],
  ["103405", "103405 - Trolitax epoksit 30mm", "POM", "40mm", "111783 - POM 40mm Plattenmaterial schw."],
  ["103404", "103404 - Trolitax epoksit 40mm", "POM", "50 mm", "103428 - POM TECAFORM 50x610x1000 white"],
  ["103312", "103312 - Trolitax epoksit 40mm beschichtet grau", "POM", "50 mm", "103428 - POM TECAFORM 50x610x1000 white"],
  ["210283", "210283 - 230 (100x100x30)", "RESOPAL", "32", "114723 - Resopal HPL 32x1220x1220 RAL7035"],
  ["210285", "210285 - 230 (100x100x40)", "RESOPAL", "42", "114724 - Resopal HPL 42,8x1220x1220 RAL7035"],
  ["210288", "210288 - 230 (100x100x50)", "RESOPAL", "52", "120839 - Resopal HPL 52,8x1220x1220 RAL7035"],
  ["210133", "210133 - 230 (100x150x30)", "RESOPAL", "32", "114723 - Resopal HPL 32x1220x1220 RAL7035"],
  ["210294", "210294 - 230 (100x150x40)", "RESOPAL", "42", "114724 - Resopal HPL 42,8x1220x1220 RAL7035"],
  ["210145", "210145 - 230 (100x150x50)", "RESOPAL", "52", "120839 - Resopal HPL 52,8x1220x1220 RAL7035"],
  ["210290", "210290 - 230 (100x50x30)", "RESOPAL", "32", "114723 - Resopal HPL 32x1220x1220 RAL7035"],
  ["210291", "210291 - 230 (100x50x40)", "RESOPAL", "42", "114724 - Resopal HPL 42,8x1220x1220 RAL7035"],
  ["210295", "210295 - 230 (100x50x50)", "RESOPAL", "52", "120839 - Resopal HPL 52,8x1220x1220 RAL7035"],
  ["210282", "210282 - 230 (50x100x30)", "RESOPAL", "32", "114723 - Resopal HPL 32x1220x1220 RAL7035"],
  ["210284", "210284 - 230 (50x100x40)", "RESOPAL", "42", "114724 - Resopal HPL 42,8x1220x1220 RAL7035"],
  ["210289", "210289 - 230 (50x100x50)", "RESOPAL", "52", "120839 - Resopal HPL 52,8x1220x1220 RAL7035"],
  ["400203", "400203 - 230 (50x50x30)", "RESOPAL", "32", "114723 - Resopal HPL 32x1220x1220 RAL7035"],
  ["210293", "210293 - 230 (50x50x40)", "RESOPAL", "42", "114724 - Resopal HPL 42,8x1220x1220 RAL7035"],
  ["210296", "210296 - 230 (50x50x50)", "RESOPAL", "52", "120839 - Resopal HPL 52,8x1220x1220 RAL7035"],
  ["103435", "103435 - Festholz 30mm", "RESOPAL", "32", "114723 - Resopal HPL 32x1220x1220 RAL7035"],
  ["103313", "103313 - Grau 30mm", "RESOPAL", "32", "114723 - Resopal HPL 32x1220x1220 RAL7035"],
  ["103314", "103314 - Grau 40mm", "RESOPAL", "42", "114724 - Resopal HPL 42,8x1220x1220 RAL7035"],
  ["105713", "105713 - Grau 50mm", "RESOPAL", "52", "120839 - Resopal HPL 52,8x1220x1220 RAL7035"],
  ["107993", "107993 - Rechteckstahl VA 20x10mm 1.4305", "MS", "20x20 mm", "120437 - BRASS-MS58Zn40Pb"],
  ["112847", "112847 - Rechteckstahl VA 20x15mm 1.4305", "MS", "20x20 mm", "120437 - BRASS-MS58Zn40Pb"],
  ["107069", "107069 - Rechteckstahl VA 20x20mm 1.4305", "MS", "20x20 mm", "120437 - BRASS-MS58Zn40Pb"],
  ["104870", "104870 - Rechteckstahl VA 20x5mm 1.4305", "MS", "20x20 mm", "120437 - BRASS-MS58Zn40Pb"],
  ["103342", "103342 - Rechteckstahl VA 20x8mm 1.4305", "MS", "20x20 mm", "120437 - BRASS-MS58Zn40Pb"],
  ["103348", "103348 - Rechteckstahl VA 25x5mm 1.4305", "MS", "25x10 mm", "114552 - BRASS-MS58Zn40Pb"],
  ["107572", "107572 - Rechteckstahl VA 30x10mm 1.4305", "MS", "30x30 mm", "103372 - BRASS-MS58Zn40Pb"],
  ["111827", "111827 - Rect. Steel VA 30x15mm 1.4301 DIN174", "MS", "30x30 mm", "103372 - BRASS-MS58Zn40Pb"],
  ["111827", "111827 - Rechteckstahl VA 30x15mm 1.4305", "MS", "30x30 mm", "103372 - BRASS-MS58Zn40Pb"],
  ["110127", "110127 - Rechteckstahl VA 30x20mm 1.4305", "MS", "30x30 mm", "103372 - BRASS-MS58Zn40Pb"],
  ["112846", "112846 - Rechteckstahl VA 30x30mm 1.4305", "MS", "30x30 mm", "103372 - BRASS-MS58Zn40Pb"],
  ["108324", "108324 - Rechteckstahl VA 30x8mm 1.4305", "MS", "30x30 mm", "103372 - BRASS-MS58Zn40Pb"],
  ["110126", "110126 - Rechteckstahl VA 40x10mm 1.4305", "MS", "40x40 mm", "120438 - BRASS-MS58Zn40Pb"],
  ["107089", "107089 - Rechteckstahl VA 40x20mm 1.4305", "MS", "40x40 mm", "120438 - BRASS-MS58Zn40Pb"],
  ["112848", "112848 - Rechteckstahl VA 40x30mm 1.4305", "MS", "40x40 mm", "120438 - BRASS-MS58Zn40Pb"],
  ["111645", "111645 - Rechteckstahl VA 40x40mm 1.4301 DIN 1017", "MS", "40x40 mm", "120438 - BRASS-MS58Zn40Pb"],
  ["112855", "112855 - Rechteckstahl VA 50x20mm 1.4305", "MS", "50x50 mm", "107779 - BRASS-MS58Zn40Pb"],
  ["109791", "109791 - Rechteckstahl VA 50x25mm 1.4301 DIN 1017", "MS", "50x50 mm", "107779 - BRASS-MS58Zn40Pb"],
  ["115625", "115625 - Rechteckstahl VA 60x50x50mm 1.4305", "MS", "60x10 mm", "111686 - BRASS-MS58Zn40Pb"],
  ];
  const CHANGE_TYPE = 'Temporary';
  const KEY_DONE = 'cnc-matchange.done';

  const $ = window.jQuery;
  if (!$ || !$.fn || !$.fn.select2) { alert('Open the Carpenter Cutting List page of the website first, then run this again.'); return; }
  const rules = new Map(RULES.map(([ref, now, type, size, material]) => [ref, { ref, now, type, size, material, newRef: (material.match(/^\s*(\d+)/) || [])[1] }]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 8000, step = 50) => {
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
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const refOf = (t) => (String(t || '').match(/^\s*(\d{5,})/) || [])[1] || '';
  const load = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY_DONE)) || []); } catch (e) { return new Set(); } };
  const done = load();
  const remember = (k) => { done.add(k); try { localStorage.setItem(KEY_DONE, JSON.stringify([...done])); } catch (e) { /* private window */ } };

  /* ------------------------------------------------------------------ panel */
  const old = document.getElementById('cnc-matchange');
  if (old) old.remove();
  const panel = document.createElement('div');
  panel.id = 'cnc-matchange';
  panel.style.cssText = 'position:fixed;right:12px;bottom:12px;width:520px;max-height:80vh;z-index:2147483647;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;font:13px system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5);display:flex;flex-direction:column';
  panel.innerHTML = '<div style="display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid #334155"><b>Carpenter material changer</b><button data-x class="cx-b" style="margin-left:auto">✕</button></div>'
    + '<div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px;overflow:auto">'
    + '<div>' + rules.size + ' materials to replace, ChangeType <b>' + CHANGE_TYPE + '</b>. Other materials are skipped.</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap"><button data-a="check" class="cx-b">Check (changes nothing)</button><button data-a="start" class="cx-b go">Start</button><button data-a="stop" class="cx-b">Stop</button><button data-a="forget" class="cx-b" title="Forget which rows were already changed in this browser">Forget done rows</button></div>'
    + '<div data-now style="background:#1e3a8a;border:1px solid #3b82f6;border-radius:8px;padding:8px 10px">Ready.</div>'
    + '<pre data-log style="margin:0;white-space:pre-wrap;background:#020617;border:1px solid #1e293b;border-radius:6px;padding:6px;max-height:40vh;overflow:auto;font:11px ui-monospace,monospace"></pre></div>';
  const st = document.createElement('style');
  st.textContent = '#cnc-matchange .cx-b{all:unset;cursor:pointer;padding:5px 10px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#e2e8f0}#cnc-matchange .cx-b.go{background:#15803d;border-color:#22c55e;font-weight:600}';
  panel.appendChild(st);
  document.body.appendChild(panel);
  const nowEl = panel.querySelector('[data-now]');
  const logEl = panel.querySelector('[data-log]');
  const now = (h) => { nowEl.innerHTML = h; };
  const log = (m) => { logEl.textContent += m + '\n'; logEl.scrollTop = logEl.scrollHeight; console.log('[material changer] ' + m); };
  let stopped = false;
  let running = false;
  panel.querySelector('[data-x]').onclick = () => { stopped = true; panel.remove(); };

  /* ------------------------------------------------------------------ the list */
  function gridParts() {
    const el = document.querySelector('.s-CarpenterProduceListGrid') || document.querySelector('.s-DataGrid');
    let grid = null;
    try { grid = $(el).getWidget(window.Serenity.DataGrid); } catch (e) { grid = null; }
    const slick = grid && ((grid.getGrid && grid.getGrid()) || grid.slickGrid);
    if (!slick) throw new Error('Could not find the list on this page.');
    const cols = slick.getColumns();
    const field = (re) => { const c = cols.find((x) => re.test(String(x.name || '').replace(/<[^>]*>/g, '').trim())); return c && c.field; };
    const f = { mat: field(/^description\s*de$/i), wo: field(/^work\s*order$/i), nr: field(/^materialnr$/i) };
    if (!f.mat || !f.wo) throw new Error('Could not find the "Description De" or "Work Order" column.');
    const btnCol = cols.findIndex((c) => /change/i.test(String(c.name || '') + String(c.id || '') + String(c.field || '')));
    return { grid, slick, f, btnCol };
  }
  const keyOf = (item, f) => String(item[f.wo] || '') + '|' + String(item[f.nr] || '');

  async function showAllRows() {
    const sel = document.querySelector('.slick-pg-size');
    const stat = () => txt(document.querySelector('.slick-pg-stat'));
    const m = stat().match(/of\s+([\d.,]+)/i);
    const total = m ? Number(m[1].replace(/[.,]/g, '')) : 0;
    const { slick } = gridParts();
    if (!sel || (total && slick.getDataLength() >= total)) return;
    const biggest = [...sel.options].map((o) => Number(o.value)).filter(Boolean).sort((a, b) => b - a)[0];
    if (!biggest || Number(sel.value) === biggest) return;
    log('Showing ' + biggest + ' rows per page…');
    $(sel).val(String(biggest)).trigger('change');
    await waitFor(() => { const s = stat(); return /^showing 1 to/i.test(s) && !/to 20 of/i.test(s) ? s : null; }, 60000, 200);
    await sleep(500);
    if (total > biggest) log('⚠ The list has ' + total + ' rows, more than one page: run the script again on the next pages.');
  }

  function toChange() {
    const { slick, f } = gridParts();
    const out = [];
    for (let i = 0; i < slick.getDataLength(); i++) {
      const item = slick.getDataItem(i);
      if (!item || item.__group || item.__groupTotals) continue;
      const rule = rules.get(refOf(item[f.mat]));
      if (!rule) continue;
      const key = keyOf(item, f);
      if (done.has(key)) continue;
      out.push({ i, item, rule, key });
    }
    return out;
  }

  /* ------------------------------------------------------------------ the window */
  const visibleDialog = () => [...document.querySelectorAll('.s-CarpenterChangeMaterialsDialog')]
    .filter((d) => d.offsetParent !== null && d.querySelector('input[name="Type"]')).pop();
  const chosenOf = (input) => { const c = document.getElementById('s2id_' + input.id); return c ? c.querySelector('.select2-chosen') : null; };

  async function choose(input, text) {
    const want = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (txt(chosenOf(input)).toLowerCase() === want) return true;
    $(input).select2('open');
    const own = () => { const s = $(input).data('select2'); return s && s.dropdown && s.dropdown[0]; };
    const drop = await waitFor(() => { const d = own(); return d && d.offsetParent !== null && !d.querySelector('.select2-searching') ? d : null; }, 5000);
    let li = null;
    if (drop) {
      for (let k = 0; k < 40 && !li; k++) {
        li = [...drop.querySelectorAll('li.select2-result-selectable')].find((l) => txt(l.querySelector('.select2-result-label') || l).toLowerCase() === want);
        if (li) break;
        const more = drop.querySelector('.select2-more-results');
        const ul = drop.querySelector('.select2-results');
        if (more && ul) { ul.scrollTop = ul.scrollHeight; ul.dispatchEvent(new Event('scroll')); }
        await sleep(more ? 120 : 60);
        if (!more && k > 3) break;
      }
    }
    if (li) {
      const lab = li.querySelector('.select2-result-label') || li;
      lab.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      lab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      if (!(await waitFor(() => txt(chosenOf(input)).toLowerCase() === want, 1500))) {
        const data = $(li).data('select2-data');
        if (data) $(input).select2('data', data, true);
      }
    }
    try { $(input).select2('close'); } catch (e) { /* closed */ }
    return txt(chosenOf(input)).toLowerCase() === want;
  }

  const closeDialog = (dlg) => { const w = dlg.closest('.ui-dialog') || dlg; const x = w.querySelector('.ui-dialog-titlebar-close'); if (x) x.click(); };

  // a confirmation the website may show after Save: answer Yes / OK
  function answerConfirm() {
    for (const d of document.querySelectorAll('.ui-dialog')) {
      if (d.offsetParent === null || d.querySelector('.s-CarpenterChangeMaterialsDialog, input[name="Type"]') || d.classList.contains('s-CarpenterChangeMaterialsDialog')) continue;
      const b = [...d.querySelectorAll('.ui-dialog-buttonpane button, button')].find((x) => /^(yes|ok|evet|tamam|oui)$/i.test(txt(x)));
      if (b) { b.click(); return true; }
    }
    return false;
  }

  async function changeOne(job) {
    const { slick, btnCol } = gridParts();
    slick.scrollRowIntoView(job.i);
    const cell = await waitFor(() => {
      const n = btnCol >= 0 ? slick.getCellNode(job.i, btnCol) : null;
      const row = n ? n.parentElement : null;
      return (n && n.querySelector('.btn-change-mat')) || (row && row.querySelector('.btn-change-mat'));
    }, 3000);
    if (!cell) return 'could not find the Change Material button';
    cell.click();
    const dlg = await waitFor(visibleDialog, 10000);
    if (!dlg) return 'the window did not open';
    const inp = (n) => dlg.querySelector('input[name="' + n + '"]');
    if (!(await choose(inp('ChangeType'), CHANGE_TYPE))) { closeDialog(dlg); return 'could not set ChangeType ' + CHANGE_TYPE; }
    if (!(await choose(inp('Type'), job.rule.type))) { closeDialog(dlg); return 'could not choose Type ' + job.rule.type; }
    await waitFor(() => !txt(chosenOf(inp('Size'))) || txt(chosenOf(inp('Size'))) === '--select--', 1000);
    if (!(await choose(inp('Size'), job.rule.size))) { closeDialog(dlg); return 'could not choose Size ' + job.rule.size; }
    const mat = inp('MaterialId');
    const got = await waitFor(() => { const t = txt(chosenOf(mat)); return refOf(t) === job.rule.newRef ? t : null; }, 6000);
    if (!got) { const t = txt(chosenOf(mat)); closeDialog(dlg); return 'the window filled in "' + t + '", not ' + job.rule.material + ': not saved'; }
    // Save
    const save = (dlg.closest('.ui-dialog') || dlg).querySelector('.save-and-close-button');
    if (!save) { closeDialog(dlg); return 'no Save button'; }
    save.click();
    const closed = await waitFor(() => { answerConfirm(); return !visibleDialog() || visibleDialog() !== dlg || dlg.offsetParent === null; }, 15000, 100);
    if (!closed) {
      const err = txt((dlg.closest('.ui-dialog') || dlg).querySelector('.error, .validation-summary, label.error'));
      closeDialog(dlg);
      return 'the window did not close after Save' + (err ? ' (' + err + ')' : '');
    }
    return null;
  }

  /* ------------------------------------------------------------------ buttons */
  async function check() {
    await showAllRows();
    const list = toChange();
    const by = new Map();
    for (const j of list) by.set(j.rule.ref, (by.get(j.rule.ref) || 0) + 1);
    log(list.length + ' rows to change' + (done.size ? ' (' + done.size + ' already done in this browser)' : '') + ':');
    for (const [ref, n] of [...by].sort((a, b) => b[1] - a[1])) { const r = rules.get(ref); log('  ' + n + ' × ' + r.now + '  →  ' + r.type + ' · ' + r.size + ' (' + r.material + ')'); }
    now(list.length ? '<b>' + list.length + '</b> rows to change. Press <b>Start</b>.' : 'Nothing to change.');
    return list;
  }

  panel.querySelector('[data-a="check"]').onclick = async () => { if (running) return; try { await check(); } catch (e) { log('✗ ' + e.message); } };
  panel.querySelector('[data-a="stop"]').onclick = () => { stopped = true; now('Stopping after this row…'); };
  panel.querySelector('[data-a="forget"]').onclick = () => { if (confirm('Forget the ' + done.size + ' rows already changed in this browser? They are checked again by their material.')) { done.clear(); localStorage.removeItem(KEY_DONE); log('Forgotten.'); } };
  panel.querySelector('[data-a="start"]').onclick = async () => {
    if (running) return;
    running = true; stopped = false;
    const t0 = Date.now();
    let ok = 0;
    const failed = [];
    try {
      const total = (await check()).length;
      const skip = new Set();
      while (!stopped) {
        const job = toChange().find((j) => !skip.has(j.key));
        if (!job) break;
        const n = ok + failed.length + 1;
        now('(' + n + '/' + total + ') ' + esc(job.item[gridParts().f.wo]) + ': ' + esc(job.rule.now) + ' → <b>' + esc(job.rule.type + ' · ' + job.rule.size) + '</b>');
        const err = await changeOne(job);
        if (err) { skip.add(job.key); failed.push(job); log('✗ ' + job.item[gridParts().f.wo] + ': ' + err); } else { remember(job.key); ok++; log('✓ ' + job.item[gridParts().f.wo] + ': ' + job.rule.type + ' · ' + job.rule.size); }
      }
      const s = Math.round((Date.now() - t0) / 1000);
      now((stopped ? 'Stopped. ' : 'Done. ') + '<b>' + ok + '</b> changed' + (failed.length ? ', <b style="color:#fca5a5">' + failed.length + ' not changed</b> (see the list)' : '') + ' in ' + Math.floor(s / 60) + ' min ' + (s % 60) + ' s.');
    } catch (e) {
      log('✗ ' + e.message);
      now('✗ ' + esc(e.message));
    }
    running = false;
  };
  now('Press <b>Check</b> to see how many rows will be changed (nothing is changed), then <b>Start</b>.');
})();
