---
name: backlog-context
description: Dùng khi user đưa một ticket key Backlog (Nulab) và cần đọc, tóm tắt hoặc gom toàn bộ context — body, mọi comment, attachment, ticket cha/con, ticket được nhắc tới — về tasks/<KEY>/ trước khi plan hay implement.
---

# Backlog Context

Kéo ticket về thành **file trong workspace** để agent tự đọc thay vì hỏi lại. Không dùng Backlog MCP để
lấy body/comment: MCP hay thiếu comment và không tải được attachment nội bộ. Script trong skill này gọi
REST API trực tiếp.

## Cài một lần

1. Copy `scripts/` vào `.external-assets/backlog/` của workspace.
2. Tạo `.agents/.env` từ `env.example`, điền `BACKLOG_DOMAIN` + `BACKLOG_API_KEY` (Backlog › Personal settings › API).
   Nhiều space: `BACKLOG_<NAME>_DOMAIN` / `_API_KEY` / `_PREFIXES`, script tự route theo prefix của key.
3. `.agents/.env` phải gitignored. Không in giá trị ra chat.

## Lệnh

```bash
node .external-assets/backlog/materialize-backlog-context.js --ticket <KEY>
# --space <name>      ép space khi prefix chưa gán
# --output-dir <dir>  đổi chỗ ghi (mặc định tasks/<ROOT>/)
# --max-tickets <n>   giới hạn crawl (mặc định 200)
```

Script: đi lên `parentIssueId` tới ticket gốc (**ROOT**) → gom ROOT, chuỗi cha, con trực tiếp, ticket được
nhắc trong body/comment → mỗi ticket lấy body, **mọi** comment (đối chiếu endpoint đếm), attachment tải về file,
link Gyazo tải về `gyazo/` → ghi `tasks/<ROOT>/backlog-context.md`, `source-map.json`, `tickets/<KEY>/rendered.md`.

## Sau khi chạy — bắt buộc

Viết `tasks/<ROOT>/index.md` **cho kỹ sư mới**, không copy ticket thô:

- ticket gốc · ticket nguồn sự thật · ticket con/liên quan
- bối cảnh trước khi sửa · luồng hiện tại · vì sao cần sửa
- hành vi mong muốn sau khi sửa
- màn/API/module bị ảnh hưởng
- trong phạm vi · ngoài phạm vi · để sau
- điểm chưa rõ cần confirm
- self-test cần nhìn vào đâu
- link `[@tasks/<ROOT>/...]` tới file gốc

## Quy tắc đọc

- **Comment sau thắng body trước.** Feedback trong comment có thể thu hẹp hoặc đổi wording ban đầu — đó là nguồn để verify.
- Ảnh/video được nhắc là acceptance evidence. Chưa mở ảnh thì chưa được kết luận thiếu/đủ.
- Ticket không truy cập được → ghi rõ, không đoán.
- Asset local viết `[@path]`; URL remote giữ nguyên nếu không tải được.

## Chỉ đọc

Chỉ `GET`. Không `add_*`, `update_*`, `delete_*`, `mark_*` trên Backlog dù có tool.
