---
name: requirement-gate
description: Dùng TRƯỚC khi implement một task — kiểm tra định nghĩa hoàn thành đã đủ chưa, yêu cầu có gì mâu thuẫn, còn điểm nào phải confirm — để agent không tự suy diễn nghiệp vụ hay hỏi lại thứ đã có trong context.
---

# Requirement Gate — cổng trước khi code

Câu hỏi phải trả lời được trước khi sửa dòng đầu tiên: **yêu cầu nói gì · đủ để làm chưa · thiếu gì thì
tự quyết được, thiếu gì phải hỏi**. Gate này chống hai lỗi ngược nhau: agent tự bịa scope, và agent hỏi
lại thứ đã nằm sẵn trong `tasks/<KEY>/`.

## Khi bắt buộc

Task chạm màn hình, luồng, API, dữ liệu, quyền, thông báo, tích hợp — tức là gần như mọi task có nghiệp vụ.
Không cần cho sửa typo, format, comment.

## Bước 1 — Gom nguồn (đọc, không hỏi)

Theo thứ tự, chỉ đọc cái có:

1. `tasks/<KEY>/index.md` — bản tóm tắt cho kỹ sư mới.
2. `tasks/<KEY>/tickets/*/rendered.md` — body + **comment sau cùng** (comment thắng body).
3. `tasks/<KEY>/slack-context.md`, `figma-context.md`, `video-context.md` nếu có.
4. Tài liệu nghiệp vụ / SRS theo `repo-srs-map` nếu workspace có.
5. Code hiện tại ở vùng bị ảnh hưởng.

## Bước 2 — Viết Definition of Done

Ghi vào `tasks/<KEY>/index.md` mục **DoD**, mỗi dòng một tiêu chí **kiểm được** (nhìn thấy / đo được / có
số cụ thể). Mẫu:

```text
## DoD
- AC-1 <thao tác> → <kết quả thấy được>            (nguồn: ticket body)
- AC-2 <trường hợp biên> → <kết quả>                (nguồn: comment #3, 14/09)
- AC-3 <số liệu cụ thể, ví dụ "8.600.000 ₫">       (nguồn: Slack thread ...)
Ngoài phạm vi: ...
```

Tiêu chí viết không kiểm được ("hoạt động đúng", "đẹp") → viết lại cho tới khi kiểm được.

## Bước 3 — Phân loại từng tiêu chí

| Nhãn | Nghĩa | Hành động |
|---|---|---|
| `Covered` | Nguồn nói rõ | Làm |
| `Partial` | Có nhắc nhưng thiếu chi tiết UI/API/rule | **Tự quyết theo pattern có sẵn trong code**, ghi rõ giả định |
| `Conflict` | Hai nguồn mâu thuẫn (body ≠ comment, Figma ≠ SRS) | Ưu tiên nguồn mới hơn/khách hơn; ghi cả hai; nếu vẫn không quyết được → hỏi |
| `Missing` | Không nguồn nào nói | Hỏi user |
| `Out-of-scope` | Yêu cầu vượt ticket | Không làm, ghi lại |

## Bước 4 — Quyết định hỏi hay đi tiếp

**Đi tiếp** khi mọi tiêu chí là Covered/Partial-có-giả-định-an-toàn. Giả định an toàn = làm theo pattern
đang có trong code, đổi lại được rẻ, không ảnh hưởng dữ liệu người dùng.

**Dừng hỏi** chỉ khi có `Missing` hoặc `Conflict` không tự quyết được — và hỏi **một lần, gom hết câu**,
mỗi câu kèm phương án đề xuất để user chỉ cần "ok".

Không hỏi: thứ đã có trong `tasks/` · thứ đọc code ra được · "bạn có chắc không".

## Bước 5 — Kiểm tra chéo

Trước khi đóng gate, liệt kê một dòng mỗi mục: vùng khác bị ảnh hưởng? (component dùng chung, type/interface,
API contract, role/permission, dữ liệu cũ cần migrate). Có → thêm vào DoD hoặc ghi "ngoài phạm vi".

## Output

Task nhỏ — 3 dòng:

```text
Gate: DoD 4 tiêu chí, nguồn ticket + comment #2.
Giả định: <...> (theo pattern <file>).
Cần confirm: không / <câu hỏi kèm đề xuất>.
```

Task lớn — mục **Requirement gate** trong `index.md`: Covered · Partial (giả định) · Conflict (chọn gì, vì sao)
· Out-of-scope · Cross-impact · Cần confirm.

## Lỗi hay gặp

- Nhìn FE hiện tại rồi suy ra yêu cầu — FE có thể đang sai.
- Chỉ đọc body, bỏ comment cuối.
- Có ảnh mà không mở, kết luận bằng chữ.
- Hỏi 5 câu rời rạc thay vì một lần gom.
- Biến gap thành code im lặng.
