// Change Material recorder (TPS Carpenter Cutting List)
// Paste in the console (F12) on the carpenter list, then change ONE row by hand:
// Change Material -> Temporary -> Type -> Size -> Save. Then press "Copy report" and paste it to Claude.
// It only watches: it changes nothing itself.
(() => {
  const old = document.getElementById('cnc-recorder');
  if (old) old.remove();
  const $ = window.jQuery;
  const t0 = Date.now();
  const rep = { page: location.pathname, at: new Date().toString(), browser: navigator.userAgent, steps: [] };
  const cut = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…[' + s.length + ' chars]' : s; };
  const short = (el) => {
    if (!el || !el.tagName) return String(el);
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
  };
  const path = (el) => { const p = []; for (let e = el; e && e.tagName && p.length < 16; e = e.parentElement) p.push(short(e)); return p; };
  const safe = (fn) => { try { return fn(); } catch (e) { return 'ERROR: ' + e.message; } };
  const add = (kind, data) => { rep.steps.push({ ms: Date.now() - t0, kind, data }); draw(); };

  /* ---------------- panel ---------------- */
  const panel = document.createElement('div');
  panel.id = 'cnc-recorder';
  panel.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;width:360px;background:#0f172a;color:#e2e8f0;font:13px/1.4 system-ui,sans-serif;border:2px solid #f59e0b;border-radius:10px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.4)';
  panel.innerHTML = '<div style="font-weight:700;margin-bottom:6px">● Recording Change Material</div>'
    + '<div data-msg>Now change <b>one row</b> by hand: press <b>Change Material</b> on a row, choose <b>Temporary</b>, <b>Type</b>, <b>Size</b>, wait for Material, press <b>Save</b>.<br>Then press <b>Copy report</b> and paste it to Claude.</div>'
    + '<div data-n style="margin:8px 0;color:#fbbf24"></div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
    + '<button data-a="copy" style="all:unset;cursor:pointer;padding:6px 10px;border-radius:6px;background:#15803d;font-weight:600">Copy report</button>'
    + '<button data-a="dl" style="all:unset;cursor:pointer;padding:6px 10px;border-radius:6px;background:#1e293b;border:1px solid #475569">Download report</button>'
    + '<button data-a="x" style="all:unset;cursor:pointer;padding:6px 10px;border-radius:6px;background:#1e293b;border:1px solid #475569">Close</button></div>';
  document.body.appendChild(panel);
  const nEl = panel.querySelector('[data-n]');
  function draw() {
    const k = (x) => rep.steps.filter((s) => s.kind === x).length;
    nEl.textContent = 'Recorded: ' + k('button press') + ' button press, ' + k('window') + ' window snapshots, ' + k('request') + ' server requests';
  }
  draw();
  const text = () => JSON.stringify(rep, null, 1);
  panel.querySelector('[data-a="copy"]').onclick = async () => {
    try { await navigator.clipboard.writeText(text()); panel.querySelector('[data-msg]').innerHTML = '<b style="color:#86efac">Copied.</b> Paste it in the chat with Claude.'; }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text(); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); panel.querySelector('[data-msg]').innerHTML = '<b style="color:#86efac">Copied.</b> Paste it in the chat with Claude.'; }
  };
  panel.querySelector('[data-a="dl"]').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }));
    a.download = 'change-material-recording.txt';
    document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
  };
  panel.querySelector('[data-a="x"]').onclick = () => { stop(); panel.remove(); };

  /* ---------------- the page and the grid ---------------- */
  const gridInfo = () => safe(() => {
    const els = [...document.querySelectorAll('.s-DataGrid, [class*="Grid"].s-Widget, .slick-viewport')].slice(0, 10);
    const main = document.querySelector('.s-CarpenterProduceListGrid');
    let w = null; let slick = null;
    try { w = $(main).getWidget(window.Serenity.DataGrid); } catch (e) { w = null; }
    slick = w && ((w.getGrid && w.getGrid()) || w.slickGrid);
    const proto = w ? Object.getPrototypeOf(w) : null;
    const methods = [];
    for (let p = proto; p && p !== Object.prototype && methods.length < 400; p = Object.getPrototypeOf(p)) for (const n of Object.getOwnPropertyNames(p)) if (!methods.includes(n)) methods.push(n);
    const src = (n) => safe(() => (w && typeof w[n] === 'function' ? cut(w[n].toString(), 4000) : null));
    const interesting = methods.filter((n) => /click|change|mat|dialog|edit|open/i.test(n));
    const subs = (ev) => safe(() => { const h = ev && (ev.handlers || ev._handlers || ev.subscribers || ev.subscriberList); return h ? h.map((f) => cut((f.handler || f).toString(), 2000)) : null; });
    return {
      gridElements: els.map(short),
      carpenterGridFound: !!main,
      widget: w ? (w.constructor && (w.constructor.__typeName || w.constructor.name)) : null,
      slickFound: !!slick,
      options: slick ? safe(() => { const o = slick.getOptions(); return { rowHeight: o.rowHeight, frozenColumn: o.frozenColumn, frozenRow: o.frozenRow, enableCellNavigation: o.enableCellNavigation }; }) : null,
      columns: slick ? safe(() => slick.getColumns().map((c, i) => i + ': ' + cut((c.name || '').replace(/<[^>]*>/g, ''), 40) + ' [' + c.id + '/' + c.field + ']')) : null,
      dataLength: slick ? safe(() => slick.getDataLength()) : null,
      methods: interesting,
      onClickSource: src('onClick'),
      sources: Object.fromEntries(interesting.filter((n) => n !== 'onClick').slice(0, 12).map((n) => [n, src(n)])),
      slickOnClickSubscribers: slick ? subs(slick.onClick) : null,
    };
  });
  add('page', { grid: gridInfo(), pager: safe(() => (document.querySelector('.slick-pg-stat') || {}).textContent) });

  /* ---------------- the button press ---------------- */
  let pressed = 0;
  const onEv = (ev) => {
    const t = ev.target;
    if (!t || !t.closest || panel.contains(t)) return;
    const btn = t.closest('.btn-change-mat, .btn, button, a, span');
    const inGrid = t.closest('.slick-row');
    const isChange = (btn && /change\s*mat/i.test(btn.textContent + ' ' + btn.className)) || (t.className && /change-mat/.test(String(t.className)));
    const inDialog = t.closest('.ui-dialog');
    if (inDialog && /mousedown|click/.test(ev.type)) {
      const b = t.closest('.save-and-close-button, .apply-changes-button, .tool-button, .button-outer, button, .btn, a, [class*="save"]');
      if (b && /save|kaydet|apply/i.test(b.textContent + ' ' + b.className)) {
        add('save press', { event: ev.type, target: short(t), button: cut(b.outerHTML, 600), window: windowSnap(inDialog) });
      }
      return;
    }
    if (!isChange || pressed > 12) return;
    pressed++;
    const row = t.closest('.slick-row');
    const cell = t.closest('.slick-cell');
    const data = {
      event: ev.type, phase: ev.eventPhase, isTrusted: ev.isTrusted, button: ev.button, buttons: ev.buttons,
      target: short(t), path: path(t),
      buttonHtml: btn ? cut(btn.outerHTML, 800) : null,
      cellHtmlClass: cell ? cell.className : null,
      rowClass: row ? row.className : null, rowStyle: row ? row.getAttribute('style') : null,
      rowText: row ? cut(row.textContent.replace(/\s+/g, ' '), 1500) : null,
      rowCellClasses: row ? [...row.children].map((c) => c.className + ' | ' + cut(c.textContent.replace(/\s+/g, ' ').trim(), 60)) : null,
      rowsDrawnInThisCanvas: row && row.parentElement ? row.parentElement.querySelectorAll('.slick-row').length : null,
      canvas: row && row.parentElement ? short(row.parentElement) : null,
      viewport: safe(() => { const vp = t.closest('.slick-viewport'); return vp ? { el: short(vp), scrollTop: vp.scrollTop, scrollLeft: vp.scrollLeft, clientW: vp.clientWidth, clientH: vp.clientHeight } : null; }),
      inCarpenterGrid: !!t.closest('.s-CarpenterProduceListGrid'),
      gridAncestor: short(t.closest('[class*="Grid"]')),
    };
    if (ev.type === 'click') {
      // what the grid thinks this row is, and what the changer script would look up
      const main = document.querySelector('.s-CarpenterProduceListGrid');
      let w = null; try { w = $(main).getWidget(window.Serenity.DataGrid); } catch (e) { w = null; }
      const slick = w && ((w.getGrid && w.getGrid()) || w.slickGrid);
      if (slick) {
        data.grid = safe(() => {
          const c = slick.getCellFromEvent(ev);
          const out = { cellFromEvent: c };
          if (c) {
            const item = slick.getDataItem(c.row);
            out.item = item ? Object.fromEntries(Object.entries(item).slice(0, 60).map(([k, v]) => [k, cut(typeof v === 'object' ? JSON.stringify(v) : v, 200)])) : null;
            out.cellNode0 = safe(() => short(slick.getCellNode(c.row, 0)));
            out.cellNodeHere = safe(() => short(slick.getCellNode(c.row, c.cell)));
            out.sameCell = safe(() => slick.getCellNode(c.row, c.cell) === cell);
            out.cellNodeParentIsRow = safe(() => { const n = slick.getCellNode(c.row, 0); return n ? short(n.parentElement) + ' / row has button: ' + !!(n.parentElement && n.parentElement.querySelector('.btn-change-mat')) : null; });
            out.rowTopIs = safe(() => (slick.getOptions().rowHeight || 0) * c.row);
          }
          return out;
        });
      } else data.grid = 'the Carpenter grid widget was not found';
      data.jqueryHandlers = safe(() => {
        const out = [];
        for (let e = t; e; e = e.parentElement || (e === document.documentElement ? null : null)) {
          const evs = $._data(e, 'events');
          if (evs) for (const ty of Object.keys(evs)) if (/click|mouse|pointer/.test(ty)) for (const h of evs[ty]) out.push(short(e) + ' ' + ty + (h.selector ? ' [' + h.selector + ']' : '') + ': ' + cut(h.handler.toString(), 700));
          if (out.length > 20) break;
        }
        const d = $._data(document, 'events');
        if (d) for (const ty of Object.keys(d)) if (/click|mouse/.test(ty)) for (const h of d[ty]) if (h.selector && /mat|change|btn/i.test(h.selector)) out.push('document ' + ty + ' [' + h.selector + ']: ' + cut(h.handler.toString(), 700));
        return out;
      });
    }
    add('button press', data);
  };
  const types = ['pointerdown', 'mousedown', 'mouseup', 'click'];
  for (const ty of types) document.addEventListener(ty, onEv, true);

  /* ---------------- the window ---------------- */
  function windowSnap(d) {
    return safe(() => ({
      classes: d.className,
      inner: [...d.querySelectorAll('[class*="Dialog"]')].slice(0, 3).map(short),
      title: (d.querySelector('.ui-dialog-title') || {}).textContent,
      toolbar: [...d.querySelectorAll('.tool-button, .s-Toolbar .button-outer, .ui-dialog-buttonpane button')].map((b) => short(b) + ' "' + b.textContent.trim() + '"'),
      categories: [...d.querySelectorAll('.category')].map((c) => short(c) + ' "' + cut(((c.querySelector('.category-title') || {}).textContent || '').trim(), 40) + '"'),
      fields: [...d.querySelectorAll('input, select, textarea')].filter((i) => i.type !== 'hidden' || i.name).map((i) => ({
        name: i.name, id: i.id, type: i.type, value: cut(i.value, 120), readOnly: i.readOnly, disabled: i.disabled,
        shown: cut(((document.getElementById('s2id_' + i.id) || {}).textContent || '').replace(/\s+/g, ' ').trim(), 120),
        cls: cut(i.className, 80),
      })),
      widget: safe(() => {
        const inner = d.querySelector('.s-CarpenterChangeMaterialsDialog') || d;
        const keys = Object.keys($(inner).data() || {});
        const w = keys.map((k) => $(inner).data(k)).find((v) => v && typeof v === 'object' && (v.form || v.entity || v.get_entity));
        if (!w) return { dataKeys: keys };
        const ent = safe(() => JSON.stringify(w.entity || (w.get_entity && w.get_entity())));
        const methods = [];
        for (let p = Object.getPrototypeOf(w); p && p !== Object.prototype && methods.length < 300; p = Object.getPrototypeOf(p)) for (const n of Object.getOwnPropertyNames(p)) if (!methods.includes(n)) methods.push(n);
        return { dataKeys: keys, type: w.constructor && (w.constructor.__typeName || w.constructor.name), entity: cut(ent, 3000), methods: methods.filter((n) => /save|entity|load|form|service|change|after|before|validate/i.test(n)) };
      }),
    }));
  }
  const seen = new Map();
  const iv = setInterval(() => {
    for (const d of document.querySelectorAll('.ui-dialog')) {
      if (d.offsetParent === null || d.contains(panel)) continue;
      const s = windowSnap(d);
      const key = JSON.stringify(s.fields && s.fields.map((f) => f.value + f.shown));
      if (seen.get(d) !== key) { seen.set(d, key); add('window', s); }
    }
  }, 250);

  /* ---------------- server requests ---------------- */
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__rec = { method: m, url: String(u) }; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const r = this.__rec;
    if (r) {
      r.body = cut(typeof body === 'string' ? body : body ? '[' + (body.constructor && body.constructor.name) + ']' : '', 4000);
      this.addEventListener('loadend', () => add('request', { method: r.method, url: r.url, body: r.body, status: this.status, answer: cut(this.responseText, 3000) }));
    }
    return XS.apply(this, arguments);
  };
  const F = window.fetch;
  if (F) window.fetch = function (u, o) {
    const url = String((u && u.url) || u);
    const body = o && typeof o.body === 'string' ? cut(o.body, 4000) : '';
    return F.apply(this, arguments).then((res) => { res.clone().text().then((tx) => add('request', { method: (o && o.method) || 'GET', url, body, status: res.status, answer: cut(tx, 3000) })).catch(() => {}); return res; });
  };

  function stop() {
    for (const ty of types) document.removeEventListener(ty, onEv, true);
    clearInterval(iv);
    XMLHttpRequest.prototype.open = XO;
    XMLHttpRequest.prototype.send = XS;
    if (F) window.fetch = F;
  }
  console.log('[recorder] recording. Change one row by hand, then press "Copy report".');
})();
