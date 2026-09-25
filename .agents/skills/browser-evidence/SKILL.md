---
name: browser-evidence
description: Dùng khi cần tự test một task trên trình duyệt bằng script Playwright thường (không MCP), khoanh vùng cần chứng minh ngay trên DOM rồi chụp, và chạy vòng verify → sửa → verify tới khi mọi tiêu chí pass trước khi báo cáo.
---

# Browser Evidence — tự test, khoanh vùng, chụp, sửa tới khi pass

Định nghĩa "xong" là **đã kiểm chứng và có bằng chứng**, không phải "đã implement". Skill này dùng
Playwright thường qua **một script Node tạm** — mỗi script mở trình duyệt riêng, nên nhiều session cùng
test không đụng nhau (Playwright MCP dùng chung profile, session thứ hai sẽ lỗi).

## Cài một lần

```bash
npm i -D playwright            # trong repo canonical
npx playwright install chromium
```

Helper nằm ở `.external-assets/evidence/evidence.mjs` của skeleton. Lấy riêng: `npx degit Kaka-123-D/ai-parallel-workspace-kit/.external-assets/evidence .external-assets/evidence`.

## 0. Dev server — chạy nền, để nguyên sau khi test

```bash
# trong worktree
nohup npm run dev > .dev.log 2>&1 &
sleep 3 && cat .dev.log        # đọc URL thật
```

Không kill khi xong — user cần mở lại xem. `.dev.log`, `.evidence/` phải gitignored.

## 1. Script tạm `.evidence/run.mjs` trong worktree

```js
import { chromium } from 'playwright';
import { attach } from '<WS>/.external-assets/evidence/evidence.mjs';

const headless = process.env.EVIDENCE_HEADLESS === '1';
const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 120 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const ev = attach(page, { dir: '<WS>/tasks/<KEY>/evidence' });
const rows = [];

await page.goto('http://127.0.0.1:<PORT>/');

// AC-1: thao tác → kết quả hiện ra → khoanh → chụp
await page.getByTestId('new-item-title').fill('Việc thử');
await page.getByTestId('new-item-submit').click();
const actual = (await page.locator('[data-item]').last().locator('[data-field=title]').textContent())?.trim();
rows.push({
  ac: 'AC-1', desc: 'Tạo mới hiện trong danh sách',
  pass: actual === 'Việc thử', actual, expected: 'Việc thử',
  img: await ev.shot('AC-01_tao-moi', [['[data-item]:last-child', 'AC-1 · mục vừa tạo']])
});

ev.report({ task: '<KEY>', rows, notes: 'Lần 1: … Đã sửa: … Lần 2: …' });
await browser.close();
console.log(JSON.stringify(rows.map(r => [r.ac, r.pass])));
```

Chạy `node .evidence/run.mjs`. Mặc định **mở cửa sổ thật** để người xem thấy; `EVIDENCE_HEADLESS=1` khi không cần.

`ev` có: `shot(tên, [[selector, nhãn, {color, dim, pad}]…])` khoanh đỏ + chụp cả viewport + tự xoá khung ·
`mark/clear` tự điều khiển · `text(selector)` · `report({task, rows, notes})` → `report.html`.

Mobile: thêm `newPage({ viewport: { width: 375, height: 812 } })` và chụp lại các AC có khác biệt PC/mobile.

## 2. Chụp đúng khoảnh khắc

```text
thao tác → kết quả hiện ra → shot() → thao tác tiếp
```

Không chụp màn trống rồi tả bằng chữ. Không dựng lại trạng thái đã mất. Mỗi AC ít nhất một ảnh,
tên `AC-nn_<mô-tả>`.

Thứ không chụp được (tooltip native, lỗi server, validate BE): dùng bằng chứng thay thế — network
request/response, assertion trong script — và ghi rõ trong `notes`.

## 3. Đối chiếu bằng số, không bằng cảm giác

AC nói con số hay chuỗi cụ thể → đọc DOM trong script (`count()`, `textContent()`), ghi `actual`/`expected`.
"Không còn phần tử X" = `count() === 0`, không phải "nhìn ảnh không thấy".

Hành vi theo thời gian (Back/Forward, modal đóng theo URL, animation): sample trạng thái **trong lúc** chuyển,
không chỉ assert trạng thái cuối. Final pass mà transition chưa quan sát → báo "chưa đủ".

## 4. Vòng verify → sửa → verify

```text
chạy script → AC fail? → task cho sửa code? → sửa trong worktree → tsc sạch → chạy lại đúng AC đó + AC liên quan
                                    ↑____________________________________________________________|
```

Lặp tới khi pass hết mới bàn giao. Ghi mỗi vòng vào `notes`: lần n fail gì, sửa gì, lần n+1 ra sao.
Task ghi "không sửa code" → để fail, ghi rõ. Đã thử mà không tự sửa được → để fail kèm lý do, **không** báo "đã chạy test".

## 5. Trả lời

Bảng ngắn AC · pass/fail · đường dẫn ảnh + link `report.html`. Giữ nguyên ảnh, report, script, dev server.
Report chi tiết theo skill `evidence-report`.
