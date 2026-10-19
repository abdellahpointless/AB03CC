/*
 * Carpenter material catalog (temporary, read-only).
 *
 * Run it on the website page Digitalisation/CarpenterProduceList: press F12, open Console, paste, Enter.
 * It changes nothing. It downloads one Excel file with:
 *   1. "To fill in"   every material the parts in the list use today (one line per material, with how many parts),
 *                     and empty columns to say what the carpenter must change it to
 *   2. "All choices"  every material the Change Material window offers: Type, Size, Material
 *   3. "Types", "Sizes"  the two lists of the window
 * Tip: open one "Change Material" window first (and close it without saving): the script then reads the exact
 * lists that window uses. Without it, it uses the lists the page normally loads.
 */
(async function carpenterMaterialCatalog() {
  const say = (m) => console.log('%c[material catalog] ' + m, 'color:#2563eb;font-weight:bold');
  const $ = window.jQuery;
  const Q = window.Q;
  const S = window.Serenity;
  if (!$ || !Q || !S) {
    alert('Open the Carpenter Cutting List page of the website first, then run this again.');
    return;
  }

  /* ---------------------------------------------------------------- helpers */
  const str = (v) => (v === null || v === undefined ? '' : String(v)).trim();
  const fn = (o, ...names) => {
    for (const n of names) {
      if (o && typeof o[n] === 'function') {
        try { const v = o[n](); if (v !== undefined && v !== null && v !== '') return v; } catch (e) { /* next */ }
      } else if (o && o[n] !== undefined && o[n] !== null && o[n] !== '') return o[n];
    }
    return undefined;
  };
  const widget = (el, type) => {
    try { return $(el).getWidget(type); } catch (e) { /* not that widget */ }
    try { return $(el).tryGetWidget && $(el).tryGetWidget(type); } catch (e) { return null; }
  };
  const loadLookup = async (key) => {
    if (Q.getLookupAsync) return await Q.getLookupAsync(key);
    return Q.getLookup(key);
  };
  const itemsOf = (lk) => (lk && (fn(lk, 'items', 'get_items') || [])) || [];

  /* ---------------------------------------------------------------- 1. the window's three lists */
  const editors = { Type: { key: 'Digitalisation.MaterialTypes' }, Size: { key: 'Digitalisation.MaterialSizeTypes' }, Material: { key: 'Digitalisation.Materials' } };
  const dlg = document.querySelector('.s-CarpenterChangeMaterialsDialog');
  if (dlg) {
    for (const [label, name] of [['Type', 'Type'], ['Size', 'Size'], ['Material', 'MaterialId']]) {
      const input = dlg.querySelector('input[name="' + name + '"]');
      const w = input && widget(input, S.LookupEditor);
      if (!w) continue;
      const o = w.options || {};
      const key = fn(o, 'lookupKey') || fn(w, 'getLookupKey', 'get_lookupKey', 'lookupKey');
      if (key) editors[label].key = key;
      editors[label].cascadeField = fn(o, 'cascadeField') || fn(w, 'get_cascadeField', 'cascadeField');
      editors[label].cascadeFrom = fn(o, 'cascadeFrom') || fn(w, 'get_cascadeFrom', 'cascadeFrom');
      editors[label].filterField = fn(o, 'filterField') || fn(w, 'get_filterField', 'filterField');
    }
    say('Read the lists from the open Change Material window.');
  } else {
    say('No Change Material window open: using the usual lists (' + Object.values(editors).map(e => e.key).join(', ') + ').');
  }

  const lists = {};
  for (const [label, e] of Object.entries(editors)) {
    try {
      const lk = await loadLookup(e.key);
      lists[label] = { items: itemsOf(lk), idField: fn(lk, 'idField', 'get_idField'), textField: fn(lk, 'textField', 'get_textField') };
      say(label + ': ' + lists[label].items.length + ' entries from ' + e.key);
    } catch (err) {
      lists[label] = { items: [], error: String(err && err.message || err) };
      say(label + ': could not load ' + e.key + ' (' + lists[label].error + ')');
    }
  }
  if (!lists.Material.items.length) {
    alert('Could not read the list of materials. Open one "Change Material" window (do not save), close it, and run the script again. If it still fails, send me what the Console shows.');
    return;
  }

  // which fields of a material are its Type and its Size: what the window filters on, else a good guess
  const mat = lists.Material;
  const fields = [...new Set(mat.items.flatMap(it => Object.keys(it)))];
  const guess = (re, not) => fields.find(f => re.test(f) && !(not && not.test(f)));
  const typeField = (editors.Material.cascadeField && fields.includes(editors.Material.cascadeField) ? editors.Material.cascadeField : null)
    || guess(/^(type|materialtype|typename|tip|tur)$/i) || guess(/type/i, /id$/i) || guess(/type/i);
  const sizeField = (editors.Material.filterField && fields.includes(editors.Material.filterField) ? editors.Material.filterField : null)
    || guess(/^(size|sizetype|thickness|kalinlik|olcu)$/i) || guess(/size|thick/i, /id$/i) || guess(/size|thick/i);
  const idField = mat.idField || guess(/^(materialid|id)$/i) || fields[0];
  const textField = mat.textField || guess(/^(text|name|description|materialname|displaytext)$/i) || fields[1];
  const textOfType = (v) => { const t = lists.Type.items.find(x => str(x[lists.Type.idField]) === str(v)); return t ? str(t[lists.Type.textField]) : str(v); };
  const textOfSize = (v) => { const t = lists.Size.items.find(x => str(x[lists.Size.idField]) === str(v)); return t ? str(t[lists.Size.textField]) : str(v); };
  const refOf = (text) => (str(text).match(/^\s*(\d{5,})/) || [])[1] || '';

  const choices = mat.items.map(it => ({
    type: textOfType(typeField ? it[typeField] : ''),
    size: textOfSize(sizeField ? it[sizeField] : ''),
    text: str(it[textField]),
    ref: refOf(it[textField]),
    raw: it,
  })).sort((a, b) => a.type.localeCompare(b.type) || (parseFloat(a.size) || 0) - (parseFloat(b.size) || 0) || a.text.localeCompare(b.text));
  const byRef = new Map(choices.filter(c => c.ref).map(c => [c.ref, c]));

  /* ---------------------------------------------------------------- 2. the materials the parts use today */
  const gridEl = document.querySelector('.s-DataGrid');
  const grid = gridEl && widget(gridEl, S.DataGrid);
  let rows = [];
  let columns = [];
  if (grid) {
    const slick = fn(grid, 'getGrid', 'slickGrid') || grid.slickGrid;
    columns = (slick && slick.getColumns && slick.getColumns()) || [];
    const view = fn(grid, 'getView', 'view') || grid.view;
    rows = (grid.getItems && grid.getItems()) || (view && view.getItems && view.getItems()) || [];
    const total = view && (fn(view, 'totalCount', 'get_totalCount') || 0);
    // the list may be paged: ask the website for every row with the same filters
    if (view && view.url && (!total || total > rows.length)) {
      try {
        const request = Object.assign({}, view.params || {}, { Skip: 0, Take: 0 });
        const resp = await new Promise((res, rej) => Q.serviceCall({ url: view.url, request, onSuccess: res, onError: rej, blockUI: true }));
        if (resp && Array.isArray(resp.Entities) && resp.Entities.length > rows.length) rows = resp.Entities;
      } catch (err) { say('Could not load every row, using the ' + rows.length + ' rows on screen.'); }
    }
  }
  const col = (re) => { const c = columns.find(x => re.test(str(x.name).replace(/<[^>]*>/g, '')) || re.test(str(x.field))); return c && c.field; };
  const f = {
    board: col(/^description\s*de$/i) || col(/description/i),
    type: col(/^materialtype$/i),
    nr: col(/^materialnr$/i),
    name: col(/^m\.?\s*text$/i),
    measure: col(/^measure$/i),
    wo: col(/^work\s*order$/i),
    qty: col(/^qty$/i),
  };
  const groups = new Map();
  for (const r of rows) {
    const board = str(r[f.board]);
    const type = str(r[f.type]);
    const key = type + '|' + board;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { type, board, ref: refOf(board), parts: 0, qty: 0, examples: [], names: new Set() }));
    g.parts++;
    g.qty += Number(r[f.qty]) || 0;
    if (g.examples.length < 3) g.examples.push(str(r[f.wo]) + ' ' + str(r[f.measure]));
    if (r[f.name]) g.names.add(str(r[f.name]));
  }
  const situations = [...groups.values()].sort((a, b) => a.type.localeCompare(b.type) || b.parts - a.parts);
  say(rows.length + ' rows read: ' + situations.length + ' different materials in use.');

  /* ---------------------------------------------------------------- 3. the Excel file (SpreadsheetML: opens in Excel) */
  const esc = (v) => str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cell = (v, style) => '<Cell' + (style ? ' ss:StyleID="' + style + '"' : '') + '><Data ss:Type="' + (typeof v === 'number' ? 'Number' : 'String') + '">' + esc(v) + '</Data></Cell>';
  const sheet = (name, head, body, widths, fill) => '<Worksheet ss:Name="' + esc(name) + '"><Table>'
    + widths.map(w => '<Column ss:Width="' + w + '"/>').join('')
    + '<Row>' + head.map((h, i) => cell(h, fill && fill.includes(i) ? 'headFill' : 'head')).join('') + '</Row>'
    + body.map(r => '<Row>' + r.map((v, i) => cell(v, fill && fill.includes(i) ? 'fill' : null)).join('') + '</Row>').join('')
    + '</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions></Worksheet>';

  const toFill = situations.map(g => {
    const own = byRef.get(g.ref);
    return [g.type, g.board, g.parts, g.qty, [...g.names].slice(0, 3).join(', '), g.examples.join(' | '),
      own ? 'yes: ' + own.type + ' / ' + own.size : 'no',
      '', '', '', '', '', ''];
  });
  const extra = fields.filter(x => x !== textField);
  const all = choices.map(c => [c.type, c.size, c.text, c.ref, ...extra.map(x => str(c.raw[x]))]);
  const simple = (l) => l.items.map(it => [str(it[l.textField]), str(it[l.idField])]);

  const xml = '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>'
    + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
    + '<Styles><Style ss:ID="head"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#334155" ss:Pattern="Solid"/></Style>'
    + '<Style ss:ID="headFill"><Font ss:Bold="1"/><Interior ss:Color="#FDE68A" ss:Pattern="Solid"/></Style>'
    + '<Style ss:ID="fill"><Interior ss:Color="#FEF9C3" ss:Pattern="Solid"/></Style></Styles>'
    + sheet('To fill in',
      ['Material type now', 'Material now (Description De)', 'Parts', 'Pieces', 'Part names', 'Examples (work order, measure)', 'Already a choice in the window?',
        'Change it? (yes / no)', 'ChangeType (Temporary / Permanent)', 'Type to choose', 'Size to choose', 'Material to choose (copy from "All choices")', 'Notes'],
      toFill, [90, 260, 45, 50, 160, 220, 150, 90, 120, 90, 80, 280, 160], [7, 8, 9, 10, 11, 12])
    + sheet('All choices', ['Type', 'Size', 'Material', 'Reference', ...extra], all, [90, 70, 300, 70, ...extra.map(() => 90)])
    + sheet('Types', ['Type', 'Id'], simple(lists.Type), [140, 80])
    + sheet('Sizes', ['Size', 'Id'], simple(lists.Size), [140, 80])
    + '</Workbook>';

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = 'carpenter-materials-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.xml';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  say('Fields used: material type "' + typeField + '", size "' + sizeField + '", text "' + textField + '".');
  alert('Done: ' + situations.length + ' materials in use, ' + choices.length + ' choices in the window.\nThe file ' + a.download + ' is in your Downloads: open it with Excel, fill in the yellow columns of "To fill in" and send it back.');
})();
