---
name: evidence-report
description: Dùng khi cần tổng hợp kết quả self-test thành tài liệu evidence theo một format cố định — report.html tự chứa + test-report.md — để nhiều agent báo cáo giống nhau và người review đọc trong 10 giây.
---

# Evidence Report — một format cho mọi agent

Nhiều agent cùng báo cáo mà mỗi con một kiểu thì người review phải ghép lại từ đầu. Skill này ép **một
cấu trúc**: tổng quan trước, từng tiêu chí, evidence tương ứng, điểm cần người quyết định.

## Nơi lưu

```text
tasks/<KEY>/evidence/
  AC-01_<mô-tả>.png ...        ảnh có khung đỏ, cả viewport
  report.html                  tự chứa, mở là đọc — do evidence.mjs sinh
  test-report.md               bản text cho git/ticket
```

Cite trong tài liệu: `[@tasks/<KEY>/evidence/AC-01_....png]`.

## `report.html` — do `ev.report()` sinh, cấu trúc cố định

1. **Đầu trang**: task · `n/m tiêu chí đạt` (màu xanh nếu đủ, đỏ nếu thiếu) · thời điểm.
2. **Bảng**: AC · mô tả · ✓ đạt / ✗ chưa đạt · thực tế / mong đợi · ảnh (click phóng to).
3. **Ghi chú**: lần test đầu fail gì → đã sửa gì → test lại ra sao; thứ chưa tự verify được và vì sao.

Không thêm mục. Không đổi thứ tự. Muốn thêm thông tin → vào `notes`.

## `test-report.md`

```markdown
# Test Report — <KEY>

| | |
|---|---:|
| Tổng | 6 |
| Đạt | 5 |
| Chưa đạt | 1 |
| Chưa verify được | 0 |

## Tiêu chí

### AC-1 — <mô tả>
- Kết quả: ✓ đạt
- Thực tế: `Còn 3 việc chưa xong` · Mong đợi: `Còn 3 việc chưa xong`
- Evidence: [@tasks/<KEY>/evidence/AC-01_bo-dem.png]

### AC-4 — <mô tả>
- Kết quả: ✗ chưa đạt
- Thực tế: `11.000.000 ₫` · Mong đợi: `8.600.000 ₫`
- Evidence: [@tasks/<KEY>/evidence/AC-04_doanh-thu.png]
- Nguyên nhân (nếu biết): đơn `refunded` vẫn được cộng
- Đã thử: sửa `revenue.ts` lọc thêm `refunded` → lần 2 đạt / hoặc: chưa sửa vì task "chỉ test"

## Vòng test
- Lần 1: 4/6 — AC-3, AC-4 fail
- Sửa: <file, hướng>
- Lần 2: 6/6

## Điểm cần người quyết định
- <nếu có>
```

## Quy tắc

- Mỗi AC ít nhất một evidence. Không có ảnh thì ghi bằng chứng thay thế và lý do.
- Đánh dấu rõ `live-verified` (chạy thật) vs `code-only` (chỉ đọc code) cho từng AC.
- Không chụp evidence của trạng thái khác rồi gán cho AC này.
- Không dọn evidence trước khi user xác nhận.
- Trả lời trong chat = bảng tổng quan + link report, không dán lại toàn bộ.
