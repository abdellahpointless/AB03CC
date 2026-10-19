/*
 * Carpenter material changer. Page: Digitalisation/CarpenterProduceList.
 * Press F12, open Console, paste this script, press Enter (or press "Change materials" in the shop helper's
 * carpenter panel). A panel opens: press "Check" (changes nothing), then "Start".
 *
 * For every row it reads the size the part really needs from the "Nc Description" (the N3 line: the cut size after
 * ZUSCHNITT / RAW / ROHTEIL, else the part size) and the material type the part is linked to from "Description De".
 * Boards: the thinnest board of that type at least as thick as the smallest cut size (same colour when there is a
 * choice). Bars (MS, INOX): the smallest bar whose section holds the part. Then the replacement table applies
 * (Keep / Replace, from "Carpenter material replacements.xlsx"). When the result differs from Description De it
 * opens the row's Change Material window, sets ChangeType = Temporary, the Type and the Size, checks that the
 * window filled in the expected material, and saves. Rows that are already right are skipped.
 * Every saved row is remembered in this browser, so a stopped or reloaded run carries on where it was.
 */
window.__cncMaterialChanger = async function carpenterMaterialChanger() {
  // every choice of the Change Material window: Type, Size, Material, and (Replace) the Type + Size used instead
  const CATALOG = [
    ["ALU", "10mm", "103394 - Alu Tafelm. 10mm", null, null],
    ["ALU", "15mm", "103391 - Alu Tafelm. 15mm", null, null],
    ["ALU", "20mm", "103392 - Alu Tafelm. 20mm", null, null],
    ["ALU", "2mm", "103395 - Alu Tafelm. 2mm", null, null],
    ["ALU", "30mm", "103397 - Alu Tafelm. 30mm", null, null],
    ["ALU", "3mm", "103389 - Alu Tafelm. 3mm", null, null],
    ["ALU", "40mm", "103396 - Alu Tafelm. 40mm", null, null],
    ["ALU", "4mm", "103390 - Alu Tafelm. 4mm", null, null],
    ["ALU", "50mm", "105481 - Alu Tafelm. 50mm", null, null],
    ["ALU", "6mm", "103393 - Alu Tafelm. 6mm", null, null],
    ["ALU", "80mm", "111537 - Alu Tafelm. 80mm", null, null],
    ["ALU", "8mm", "103398 - Alu Tafelm. 8mm", null, null],
    ["CuBe D10", "D10", "105768 - CuBe", null, null],
    ["CuBe D16", "D16", "111410 - CuBe D16", null, null],
    ["EPO", "10mm", "103401 - Trolitax epoksit 10mm", "POM", "20mm"],
    ["EPO", "15mm", "103402 - Trolitax epoksit15mm", "POM", "30mm"],
    ["EPO", "30mm", "103405 - Trolitax epoksit 30mm", "POM", "40mm"],
    ["EPO", "40mm", "103404 - Trolitax epoksit 40mm", "POM", "50 mm"],
    ["EPO", "40mm beschichtet grau", "103312 - Trolitax epoksit 40mm beschichtet grau", "POM", "50 mm"],
    ["Ertalyte", "30", "117234 - Ertalyte TX", null, null],
    ["FH", "100x100x30 mm", "210283 - 230 (100x100x30)", "RESOPAL", "32"],
    ["FH", "100x100x40 mm", "210285 - 230 (100x100x40)", "RESOPAL", "42"],
    ["FH", "100x100x50 mm", "210288 - 230 (100x100x50)", "RESOPAL", "52"],
    ["FH", "100x150x30 mm", "210133 - 230 (100x150x30)", "RESOPAL", "32"],
    ["FH", "100x150x40 mm", "210294 - 230 (100x150x40)", "RESOPAL", "42"],
    ["FH", "100x150x50 mm", "210145 - 230 (100x150x50)", "RESOPAL", "52"],
    ["FH", "100x50x30 mm", "210290 - 230 (100x50x30)", "RESOPAL", "32"],
    ["FH", "100x50x40 mm", "210291 - 230 (100x50x40)", "RESOPAL", "42"],
    ["FH", "100x50x50 mm", "210295 - 230 (100x50x50)", "RESOPAL", "52"],
    ["FH", "10mm", "103432 - Festholz 10mm", null, null],
    ["FH", "15mm", "103433 - Festholz 15mm", null, null],
    ["FH", "20mm", "103434 - Festholz 20mm", null, null],
    ["FH", "50x100x30 mm", "210282 - 230 (50x100x30)", "RESOPAL", "32"],
    ["FH", "50x100x40 mm", "210284 - 230 (50x100x40)", "RESOPAL", "42"],
    ["FH", "50x100x50 mm", "210289 - 230 (50x100x50)", "RESOPAL", "52"],
    ["FH", "50x50x30 mm", "400203 - 230 (50x50x30)", "RESOPAL", "32"],
    ["FH", "50x50x40 mm", "210293 - 230 (50x50x40)", "RESOPAL", "42"],
    ["FH", "50x50x50 mm", "210296 - 230 (50x50x50)", "RESOPAL", "52"],
    ["FH", "8mm", "103431 - Festholz 8mm", null, null],
    ["FH", "Festholz 30mm", "103435 - Festholz 30mm", "RESOPAL", "32"],
    ["FH", "Grau 30 mm", "103313 - Grau 30mm", "RESOPAL", "32"],
    ["FH", "Grau 40 mm", "103314 - Grau 40mm", "RESOPAL", "42"],
    ["FH", "Grau 50 mm", "105713 - Grau 50mm", "RESOPAL", "52"],
    ["FR4", "1,5mm", "105373 - Basic material FR4 1,5mm (uncoated)", null, null],
    ["FR4", "19mm", "106099 - FR4 19mm thick/ 864x1218 mm", null, null],
    ["FR4", "30mm", "106098 - FR4 30mm thick, 1070x1190mm", null, null],
    ["FR4", "8mm", "210469 - FR4 8mm thick, Zuschnitt 175x1055", null, null],
    ["INOX", "20x10mm 1.4305", "107993 - Rechteckstahl VA 20x10mm 1.4305", "MS", "20x20 mm"],
    ["INOX", "20x15mm 1.4305", "112847 - Rechteckstahl VA 20x15mm 1.4305", "MS", "20x20 mm"],
    ["INOX", "20x20mm 1.4305", "107069 - Rechteckstahl VA 20x20mm 1.4305", "MS", "20x20 mm"],
    ["INOX", "20x5mm 1.4305", "104870 - Rechteckstahl VA 20x5mm 1.4305", "MS", "20x20 mm"],
    ["INOX", "20x8mm 1.4305", "103342 - Rechteckstahl VA 20x8mm 1.4305", "MS", "20x20 mm"],
    ["INOX", "25x5mm 1.4305", "103348 - Rechteckstahl VA 25x5mm 1.4305", "MS", "25x10 mm"],
    ["INOX", "30x10mm 1.4305", "107572 - Rechteckstahl VA 30x10mm 1.4305", "MS", "30x30 mm"],
    ["INOX", "30x15mm 1.4301 DIN174", "111827 - Rect. Steel VA 30x15mm 1.4301 DIN174", "MS", "30x30 mm"],
    ["INOX", "30x15mm 1.4305", "111827 - Rechteckstahl VA 30x15mm 1.4305", "MS", "30x30 mm"],
    ["INOX", "30x20mm 1.4305", "110127 - Rechteckstahl VA 30x20mm 1.4305", "MS", "30x30 mm"],
    ["INOX", "30x30mm 1.4305", "112846 - Rechteckstahl VA 30x30mm 1.4305", "MS", "30x30 mm"],
    ["INOX", "30x8mm 1.4305", "108324 - Rechteckstahl VA 30x8mm 1.4305", "MS", "30x30 mm"],
    ["INOX", "40x10mm 1.4305", "110126 - Rechteckstahl VA 40x10mm 1.4305", "MS", "40x40 mm"],
    ["INOX", "40x20mm 1.4305", "107089 - Rechteckstahl VA 40x20mm 1.4305", "MS", "40x40 mm"],
    ["INOX", "40x30mm 1.4305", "112848 - Rechteckstahl VA 40x30mm 1.4305", "MS", "40x40 mm"],
    ["INOX", "40x40mm 1.4301 DIN 1017", "111645 - Rechteckstahl VA 40x40mm 1.4301 DIN 1017", "MS", "40x40 mm"],
    ["INOX", "50x20mm 1.4305", "112855 - Rechteckstahl VA 50x20mm 1.4305", "MS", "50x50 mm"],
    ["INOX", "50x25mm 1.4301 DIN 1017", "109791 - Rechteckstahl VA 50x25mm 1.4301 DIN 1017", "MS", "50x50 mm"],
    ["INOX", "60x50x50mm 1.4305", "115625 - Rechteckstahl VA 60x50x50mm 1.4305", "MS", "60x10 mm"],
    ["MS", "20 mm", "108192 - BRASS - MS58Zn40Pb", null, null],
    ["MS", "20x20 mm", "120437 - BRASS-MS58Zn40Pb", null, null],
    ["MS", "25x10 mm", "114552 - BRASS-MS58Zn40Pb", null, null],
    ["MS", "30x30 mm", "103372 - BRASS-MS58Zn40Pb", null, null],
    ["MS", "40x40 mm", "120438 - BRASS-MS58Zn40Pb", null, null],
    ["MS", "50x50 mm", "107779 - BRASS-MS58Zn40Pb", null, null],
    ["MS", "60x10 mm", "111686 - BRASS-MS58Zn40Pb", null, null],
    ["PCGF", "20mm", "115022 - Polycarbonat PC-GF-30 Platte 20mm", null, null],
    ["PCGF", "1,5 mm", "105373 - FR4 uncoated", null, null],
    ["PCGF", "40mm", "107859 - Polycarbonat PC-GF-30 Platte 40mm", null, null],
    ["PEEK", "30mm", "105241 - PEEK grey 30x500x1000", null, null],
    ["POM", "100mm", "225922 - POM 100mm Plattenmaterial schw.", null, null],
    ["POM", "20mm", "114926 - POM 20mm Plattenmaterial schw.", null, null],
    ["POM", "25mm", "103416 - POM 25mm Plattenmaterial", null, null],
    ["POM", "30mm", "108001 - POM 30mm Plattenmaterial schw.", null, null],
    ["POM", "40mm", "111783 - POM 40mm Plattenmaterial schw.", null, null],
    ["POM", "50 mm", "103428 - POM TECAFORM 50x610x1000 white", null, null],
    ["POM", "50mm", "103428 - POM 50mm Plattenmaterial (52)", null, null],
    ["POM", "60 mm", "112825 - POM 50mm Plattenmaterial", null, null],
    ["POM", "70mm", "105761 - POM 70mm Plattenmaterial schw.", null, null],
    ["POM", "8mm", "103408 - POM 8mm Plattenmaterial", null, null],
    ["POM", "Schwz 50mm", "105641 - POM 50mm Plattenmaterial schw.", null, null],
    ["POM", "Schwz 60mm", "111782 - POM 60mm Plattenmaterial schw.", null, null],
    ["POM White D12", "D12", "105781 - POM White D12", null, null],
    ["PP", "10 mm", "108551 - PP-Polypropylene 10mm Plattenmaterial", null, null],
    ["PP", "35mm", "108471 - PP-Polypropylene 35mm Plattenmaterial", null, null],
    ["PP", "40mm", "108472 - PP-Polypropylene 40mm Plattenmaterial", null, null],
    ["PP", "50mm", "107877 - PP-Polypropylene 50mm Plattenmaterial", null, null],
    ["RESOPAL", "32", "114723 - Resopal HPL 32x1220x1220 RAL7035", null, null],
    ["RESOPAL", "42", "114724 - Resopal HPL 42,8x1220x1220 RAL7035", null, null],
    ["RESOPAL", "52", "120839 - Resopal HPL 52,8x1220x1220 RAL7035", null, null],
    ["TECANAT", "40MM", "105596 - TECANAT PC 1000x500x40(plexiglass lucent", null, null],
  ];
  const CHANGE_TYPE = 'Temporary';
  const KEY_DONE = 'cnc-matchange.done';

  const $ = window.jQuery;
  if (!$ || !$.fn || !$.fn.select2) { alert('Open the Carpenter Cutting List page of the website first, then run this again.'); return; }
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

  /* ------------------------------------------------------------------ what each part needs */
  const num = (s) => parseFloat(String(s).replace(',', '.'));
  const CAT = CATALOG.map(([type, size, material, rt, rs]) => ({ type, size, material, ref: refOf(material), rt, rs }));
  const byRef = new Map();
  for (const c of CAT) if (!byRef.has(c.ref)) byRef.set(c.ref, c);
  const BARS = new Set(['INOX', 'MS']);
  // plate thickness of a window size ("Grau 30 mm" -> 30); none for blocks, bars and round stock
  const thickOf = (c) => {
    if (/\d\s*x\s*\d/i.test(c.size) || /^D\d/i.test(c.size) || (c.type === 'PCGF' && /^1,5/.test(c.size))) return null;
    const m = c.size.match(/(\d+(?:[.,]\d+)?)/);
    return m ? num(m[1]) : null;
  };
  const sectionOf = (c) => {
    const m = c.size.match(/^\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/i);
    if (!m) return null;
    const a = num(m[1]), b = num(m[2]);
    return a >= b ? [a, b] : [b, a];
  };
  const TRIPLE = /(\d+(?:[.,]\d+)?)\s*X\s*(\d+(?:[.,]\d+)?)\s*X\s*(\d+(?:[.,]\d+)?)/gi;
  // "N3 (KONTAKTTRAEGERPLATTE POM / 22X20X15 / ZUSCHNITT:26X24X25)" -> part 22x20x15, cut 26x24x25
  function parseNc(text) {
    const m = String(text || '').match(/N3\s*\((.*)\)/i);
    if (!m) return null;
    const n3 = m[1].toUpperCase();
    const trips = [...n3.matchAll(TRIPLE)].map((x) => ({ at: x.index, d: [num(x[1]), num(x[2]), num(x[3])] }));
    if (!trips.length) return null;
    const k = n3.search(/ZUSCHNITT|RAW|ROHTEIL|\/\/\//);
    let raw = k >= 0 ? (trips.find((x) => x.at > k) || {}).d : null;
    if (!raw && trips.length > 1) raw = trips[1].d;
    return { n3: m[1].trim(), part: trips[0].d, raw: raw || trips[0].d };
  }
  const colorOf = (t) => (/schw|black/i.test(t) ? 'black' : /white|weiss|natur/i.test(t) ? 'white' : '');
  const NC_TYPES = [['EPO', /\bEPO|EPOX/], ['FH', /\bFH\b/], ['INOX', /\bINOX\b|\bVA\b|1\.43\d\d/]];
  const replacedInto = (type) => new Set(CAT.filter((c) => c.type === type && c.rt).map((c) => c.rt));
  const fmt = (n) => String(Math.round(n * 10) / 10);
  function fitting(type, nc, cur) {
    let cands;
    let need;
    if (BARS.has(type)) {
      const p = [...nc.part].sort((a, b) => a - b);
      const sec = [p[1], p[0]];
      need = fmt(sec[0]) + 'x' + fmt(sec[1]);
      const fits = CAT.filter((c) => c.type === type && sectionOf(c) && sectionOf(c)[0] >= sec[0] - 0.01 && sectionOf(c)[1] >= sec[1] - 0.01);
      if (!fits.length) return { err: 'no ' + type + ' bar holds ' + need };
      const area = (c) => sectionOf(c)[0] * sectionOf(c)[1];
      const best = Math.min(...fits.map(area));
      cands = fits.filter((c) => area(c) === best);
    } else {
      const plates = CAT.filter((c) => c.type === type && thickOf(c) !== null);
      if (!plates.length) return { keep: true };
      const z = Math.min(...nc.raw);
      need = fmt(z) + ' mm';
      const fits = plates.filter((c) => thickOf(c) >= z - 0.01);
      if (!fits.length) return { err: 'no ' + type + ' board of ' + need + ' or more' };
      const th = Math.min(...fits.map(thickOf));
      cands = fits.filter((c) => thickOf(c) === th);
    }
    if (cur && cands.some((c) => c.ref === cur.ref)) return { c: cur, need };
    const col = colorOf(cur ? cur.material : '');
    return { c: (col && cands.find((c) => colorOf(c.material) === col)) || cands[0], need };
  }
  const finalOf = (c) => (c && c.rt ? CAT.find((x) => x.type === c.rt && x.size === c.rs) || c : c);
  // The rule: Description De gives the material type (by its number). When the replacement table has no Replace for
  // that type, the row is skipped. Otherwise the Z of the part in the Nc Description (the last number of the part
  // size, e.g. 75X78X8 -> 8) picks the board of that type (that size, or the next bigger one); Keep -> skip,
  // Replace -> change to the table's Type + Size. Bars (INOX) are picked by the part's section.
  // Returns {rule} to change, or {skip: reason}.
  function decide(desc, ncText) {
    const cur = byRef.get(refOf(desc));
    if (!cur) return { skip: 'material not in the Change Material window' };
    const rows = CAT.filter((c) => c.type === cur.type);
    if (!rows.some((c) => c.rt)) return { skip: 'no change for ' + cur.type };
    const nc = parseNc(ncText);
    if (!nc) return { skip: 'no size in the Nc Description' };
    let row = null;
    let need = '';
    if (BARS.has(cur.type)) {
      const p = [...nc.part].sort((a, b) => a - b);
      const sec = [p[1], p[0]];
      need = 'section ' + fmt(sec[0]) + 'x' + fmt(sec[1]);
      const fits = rows.filter((c) => sectionOf(c) && sectionOf(c)[0] >= sec[0] - 0.01 && sectionOf(c)[1] >= sec[1] - 0.01);
      if (!fits.length) return { skip: 'no ' + cur.type + ' bar for ' + need };
      const area = (c) => sectionOf(c)[0] * sectionOf(c)[1];
      const best = Math.min(...fits.map(area));
      const cands = fits.filter((c) => area(c) === best);
      row = cands.find((c) => c.ref === cur.ref) || cands[0];
    } else {
      const z = nc.part[2];
      need = 'Z ' + fmt(z);
      const boards = rows.filter((c) => thickOf(c) !== null);
      const fits = boards.filter((c) => thickOf(c) >= z - 0.01);
      if (!fits.length) return { skip: 'no ' + cur.type + ' board for ' + need };
      const th = Math.min(...fits.map(thickOf));
      const cands = fits.filter((c) => thickOf(c) === th);
      row = cands.find((c) => c.ref === cur.ref) || cands.find((c) => c.rt) || cands[0];
    }
    if (!row.rt) return { skip: 'keep: ' + cur.type + ' ' + row.size };
    const f = finalOf(row);
    if (f.ref === cur.ref) return { skip: 'already ' + f.type + ' ' + f.size };
    return { rule: { now: cur.type + ' · ' + cur.size, desc: String(desc).trim(), type: f.type, size: f.size, material: f.material, newRef: f.ref, via: row.type + ' · ' + row.size, need, n3: nc.n3 } };
  }

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
    + '<div>Size from the <b>Nc Description</b>, material type from <b>Description De</b>, then your Keep / Replace table. ChangeType <b>' + CHANGE_TYPE + '</b>. Rows already right are skipped.</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap"><button data-a="check" class="cx-b">Check (changes nothing)</button><button data-a="one" class="cx-b" title="Change only the first row, step by step, to test">Do 1 row</button><button data-a="start" class="cx-b go">Start</button><button data-a="stop" class="cx-b">Stop</button><button data-a="csv" class="cx-b" title="Every row the script would change, with the NC line and the reason (Excel)">Download the list</button><button data-a="forget" class="cx-b" title="Forget which rows were already changed in this browser">Forget done rows</button></div>'
    + '<div data-now style="background:#1e3a8a;border:1px solid #3b82f6;border-radius:8px;padding:8px 10px">Ready.</div>'
    + '<pre data-log style="margin:0;white-space:pre-wrap;background:#020617;border:1px solid #1e293b;border-radius:6px;padding:6px;max-height:40vh;overflow:auto;font:11px ui-monospace,monospace"></pre></div>';
  const st = document.createElement('style');
  st.textContent = '#cnc-matchange .cx-b{all:unset;cursor:pointer;padding:5px 10px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#e2e8f0}#cnc-matchange .cx-b.go{background:#15803d;border-color:#22c55e;font-weight:600}';
  panel.appendChild(st);
  if (document.getElementById('cnc-helper')) { panel.style.right = 'auto'; panel.style.left = '12px'; } // beside the shop helper's panel, not on top of it
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
    const f = { mat: field(/^description\s*de$/i), nc: field(/^nc\s*description$/i), wo: field(/^work\s*order$/i), nr: field(/^materialnr$/i) };
    if (!f.mat || !f.wo || !f.nc) throw new Error('Could not find the "Description De", "Nc Description" or "Work Order" column.');
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

  let skipped = new Map();
  function toChange() {
    const { slick, f } = gridParts();
    const out = [];
    skipped = new Map();
    for (let i = 0; i < slick.getDataLength(); i++) {
      const item = slick.getDataItem(i);
      if (!item || item.__group || item.__groupTotals) continue;
      const key = keyOf(item, f);
      if (done.has(key)) continue;
      const d = decide(item[f.mat], item[f.nc]);
      if (!d.rule) { const why = String(d.skip || 'already right').replace(/^(keep|already): .*/, (m) => m); skipped.set(why, (skipped.get(why) || 0) + 1); continue; }
      out.push({ i, item, rule: d.rule, key });
    }
    return out;
  }

  /* ------------------------------------------------------------------ the window */
  let verbose = false;
  const step = (m) => { if (verbose) log('    · ' + m); };
  const press = (el) => {
    el.scrollIntoView({ block: 'center' });
    for (const ty of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(ty, { bubbles: true, cancelable: true, view: window }));
  };
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
    const { slick, f } = gridParts();
    slick.scrollRowIntoView(job.i);
    const ncols = slick.getColumns().length;
    const wo = String(job.item[f.wo] || '');
    // the row's Change Material button: look through the drawn cells of this row (the button column has no name)
    const btn = await waitFor(() => {
      for (let c = 0; c < ncols; c++) {
        let n = null;
        try { n = slick.getCellNode(job.i, c); } catch (e) { n = null; }
        if (n && n.parentElement) { const b = n.parentElement.querySelector('span.btn-change-mat, .btn-change-mat'); if (b) return b; }
      }
      // fallback: the drawn row that shows this work order
      const row = [...document.querySelectorAll('.slick-row')].find((r) => wo && r.textContent.includes(wo));
      return row && row.querySelector('span.btn-change-mat, .btn-change-mat');
    }, 4000);
    if (!btn) return 'could not find the Change Material button of this row';
    step('pressing Change Material');
    press(btn);
    let dlg = await waitFor(visibleDialog, 6000);
    if (!dlg) { const icon = btn.querySelector('i'); if (icon) press(icon); else btn.click(); dlg = await waitFor(visibleDialog, 8000); }
    if (!dlg) return 'the window did not open';
    step('window open');
    const inp = (n) => dlg.querySelector('input[name="' + n + '"]');
    if (!(await choose(inp('ChangeType'), CHANGE_TYPE))) { closeDialog(dlg); return 'could not set ChangeType ' + CHANGE_TYPE; }
    step('ChangeType ' + CHANGE_TYPE);
    if (!(await choose(inp('Type'), job.rule.type))) { closeDialog(dlg); return 'could not choose Type ' + job.rule.type; }
    step('Type ' + job.rule.type);
    await waitFor(() => !txt(chosenOf(inp('Size'))) || txt(chosenOf(inp('Size'))) === '--select--', 1000);
    if (!(await choose(inp('Size'), job.rule.size))) { closeDialog(dlg); return 'could not choose Size ' + job.rule.size; }
    step('Size ' + job.rule.size);
    const mat = inp('MaterialId');
    const got = await waitFor(() => { const t = txt(chosenOf(mat)); return refOf(t) === job.rule.newRef ? t : null; }, 6000);
    if (!got) { const t = txt(chosenOf(mat)); closeDialog(dlg); return 'the window filled in "' + t + '", not ' + job.rule.material + ': not saved'; }
    // Save
    const save = (dlg.closest('.ui-dialog') || dlg).querySelector('.save-and-close-button');
    if (!save) { closeDialog(dlg); return 'no Save button'; }
    step('Save: ' + txt(chosenOf(mat)));
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
    for (const j of list) {
      const k = j.rule.now + '  →  ' + j.rule.type + ' · ' + j.rule.size + (j.rule.via ? '  (right size: ' + j.rule.via + ', replaced)' : '');
      if (!by.has(k)) by.set(k, { n: 0, ex: j.rule });
      by.get(k).n++;
    }
    log(list.length + ' rows to change' + (done.size ? ' (' + done.size + ' already done in this browser)' : '') + ':');
    for (const [k, g] of [...by].sort((a, b) => b[1].n - a[1].n)) log('  ' + g.n + ' × ' + k + '\n      e.g. needs ' + g.ex.need + ': ' + g.ex.n3);
    for (const [why, n] of skipped) log('  skipped ' + n + ': ' + why);
    lastList = list;
    now(list.length ? '<b>' + list.length + '</b> rows to change. Look through the list (or <b>Download the list</b>), then press <b>Start</b>.' : 'Nothing to change.');
    return list;
  }

  panel.querySelector('[data-a="check"]').onclick = async () => { if (running) return; try { await check(); } catch (e) { log('✗ ' + e.message); } };
  let lastList = null;
  panel.querySelector('[data-a="csv"]').onclick = async () => {
    if (running) return;
    try {
      const list = lastList || (await check());
      const { f } = gridParts();
      const head = ['Work Order', 'MaterialNr', 'Description De now', 'Nc Description (N3)', 'Size needed', 'Change to Type', 'Change to Size', 'Material', 'Replaced from'];
      const rows = list.map((j) => [j.item[f.wo], j.item[f.nr], j.rule.desc, j.rule.n3, j.rule.need, j.rule.type, j.rule.size, j.rule.material, j.rule.via]);
      const csv = '\ufeff' + [head, ...rows].map((r) => r.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'material-changes.csv';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    } catch (e) { log('✗ ' + e.message); }
  };
  panel.querySelector('[data-a="stop"]').onclick = () => { stopped = true; now('Stopping after this row…'); };
  panel.querySelector('[data-a="forget"]').onclick = () => { if (confirm('Forget the ' + done.size + ' rows already changed in this browser? They are checked again by their material.')) { done.clear(); localStorage.removeItem(KEY_DONE); log('Forgotten.'); } };
  panel.querySelector('[data-a="one"]').onclick = async () => {
    if (running) return;
    running = true; verbose = true;
    try {
      await showAllRows();
      const job = toChange()[0];
      if (!job) log('Nothing to change.');
      else {
        log('Test on ' + job.item[gridParts().f.wo] + ': ' + job.rule.now + ' (' + job.rule.need + ') → ' + job.rule.type + ' · ' + job.rule.size);
        const err = await changeOne(job);
        if (err) log('✗ ' + err); else { remember(job.key); log('✓ changed. Look at the row: does Description De show ' + job.rule.material + '?'); }
      }
    } catch (e) { log('✗ ' + e.message); }
    running = false; verbose = false;
  };
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
};
// on its own it starts at once; inside the shop helper it waits for its "Change materials" button
if (!window.__cncBundle) window.__cncMaterialChanger();
