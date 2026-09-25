// Helper evidence cho Playwright thường. Không import playwright ở đây — script của agent
// import playwright (resolve từ node_modules của worktree) rồi truyền `page` vào.
//
//   import { chromium } from 'playwright';
//   import { attach } from '<workspace>/.external-assets/evidence/evidence.mjs';
//   const browser = await chromium.launch({ headless: false, slowMo: 120 });
//   const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
//   const ev = attach(page, { dir: '<workspace>/tasks/<TASK>/evidence' });
//   await ev.shot('AC-01_form', [['[data-testid=new-todo-form]', 'AC-1 · form tạo việc']]);
//   await ev.report({ task: '<TASK>', rows: [...] });
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ANNOTATE = `(${String(function () {
  if (window.__evidence) return;
  var LAYER_ID = '__evidence_layer';
  function layer() {
    var l = document.getElementById(LAYER_ID);
    if (l) return l;
    l = document.createElement('div'); l.id = LAYER_ID;
    l.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:600 12px/1.3 ui-monospace,Menlo,monospace';
    document.body.appendChild(l); return l;
  }
  function mark(selector, label, opts) {
    opts = opts || {};
    var el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) throw new Error('không tìm thấy: ' + selector);
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    var r = el.getBoundingClientRect(), pad = opts.pad == null ? 6 : opts.pad, color = opts.color || '#EF4444';
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:' + (r.left - pad) + 'px;top:' + (r.top - pad) + 'px;width:' + (r.width + pad * 2) + 'px;height:' + (r.height + pad * 2) + 'px;border:3px solid ' + color + ';border-radius:8px;box-shadow:0 0 0 4px rgba(0,0,0,.35),0 0 0 9999px rgba(0,0,0,' + (opts.dim == null ? .28 : opts.dim) + ');';
    layer().appendChild(box);
    if (label) {
      var tag = document.createElement('div'); var above = r.top - pad > 30;
      tag.style.cssText = 'position:fixed;left:' + Math.max(8, r.left - pad) + 'px;top:' + (above ? r.top - pad - 26 : r.bottom + pad + 6) + 'px;background:' + color + ';color:#fff;padding:4px 9px;border-radius:6px;white-space:nowrap;max-width:70vw;overflow:hidden;text-overflow:ellipsis;';
      tag.textContent = label; layer().appendChild(tag);
    }
  }
  function clear() { var l = document.getElementById(LAYER_ID); if (l) l.remove(); }
  window.__evidence = { mark: mark, clear: clear };
})})()`;

export function attach(page, opts) {
  const dir = opts.dir;
  mkdirSync(dir, { recursive: true });
  const shots = [];

  async function ensure() { await page.evaluate(ANNOTATE); }
  async function mark(selector, label, o) { await ensure(); await page.evaluate(([s, l, x]) => window.__evidence.mark(s, l, x), [selector, label, o || {}]); }
  async function clear() { await ensure(); await page.evaluate(() => window.__evidence.clear()); }
  async function text(selector) { return page.locator(selector).first().textContent().then((t) => (t || '').trim()); }

  // shot(name, [[selector, label, opts], ...]) → khoanh → chụp cả viewport → xoá khung → trả đường dẫn
  async function shot(name, marks) {
    for (const m of marks || []) await mark(m[0], m[1], m[2]);
    await page.waitForTimeout(150);
    const file = join(dir, name.endsWith('.png') ? name : name + '.png');
    await page.screenshot({ path: file });
    await clear();
    shots.push(file);
    return file;
  }

  // report({ task, rows: [{ ac, desc, pass, actual, expected, img }], notes })
  function report(data) {
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const rows = data.rows || [];
    const passed = rows.filter((r) => r.pass).length;
    const html = `<!doctype html><meta charset="utf-8"><title>Evidence · ${esc(data.task)}</title>
<style>body{font:15px/1.5 system-ui;margin:32px;max-width:1100px;color:#1a1a1a}h1{margin:0 0 4px}
.sum{color:${passed === rows.length ? '#0a7' : '#c33'};font-weight:700;margin:0 0 20px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #ddd}
th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#666}
.ok{color:#0a7;font-weight:700}.no{color:#c33;font-weight:700}img{max-width:420px;border:1px solid #ccc;border-radius:6px;display:block}
.notes{margin-top:24px;padding:14px 16px;background:#f6f6f6;border-radius:8px;white-space:pre-wrap}code{background:#eee;padding:1px 5px;border-radius:4px}</style>
<h1>Evidence · ${esc(data.task)}</h1>
<p class="sum">${passed}/${rows.length} acceptance criteria đạt · ${new Date().toLocaleString('vi-VN')}</p>
<table><thead><tr><th>AC</th><th>Mô tả</th><th>Kết quả</th><th>Thực tế / mong đợi</th><th>Ảnh</th></tr></thead><tbody>
${rows.map((r) => `<tr><td><code>${esc(r.ac)}</code></td><td>${esc(r.desc)}</td><td class="${r.pass ? 'ok' : 'no'}">${r.pass ? '✓ đạt' : '✗ chưa đạt'}</td>
<td>${esc(r.actual ?? '')}${r.expected != null ? '<br><small>mong đợi: ' + esc(r.expected) + '</small>' : ''}</td>
<td>${r.img ? `<a href="${esc(r.img.split('/').pop())}"><img src="${esc(r.img.split('/').pop())}" alt="${esc(r.ac)}"></a>` : ''}</td></tr>`).join('\n')}
</tbody></table>
${data.notes ? `<div class="notes">${esc(data.notes)}</div>` : ''}`;
    const file = join(dir, 'report.html');
    writeFileSync(file, html);
    return file;
  }

  return { mark, clear, text, shot, report, shots };
}
