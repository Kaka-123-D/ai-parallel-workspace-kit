---
name: multi-agent-one-task
description: Dùng khi một task đủ lớn hoặc đủ rủi ro để cần hai agent trên cùng một task — một agent thực thi, một agent khác họ phản biện, và phiên gốc làm trọng tài — thay vì một AI tự viết rồi tự xác nhận mình đúng.
---

# Multi-agent · một task

Mô hình ba vai, hai trục độc lập. Mục tiêu không phải chứng minh agent nào giỏi hơn — mà là **không để một
AI tự viết rồi tự chấm**.

| Vai | Ai | Quyền |
|---|---|---|
| **Executor** | một agent trong worktree của task | sửa file trong worktree; **không** commit/push |
| **Reviewer** | agent **khác họ** với executor (Claude ↔ Codex/GPT) | chỉ đọc; trả finding có id |
| **Trọng tài** | phiên gốc — chính phiên đang đọc skill này | đọc code trước khi phán, accept/reject từng finding, self-test, viết docs, commit khi user yêu cầu |

Khác họ là điểm mấu chốt: hai model cùng họ chia sẻ cùng điểm mù.

## Khi nào đáng dùng

- Task chạm shared type/hook/helper, API contract, luồng có nhiều nhánh.
- Task mà "sai một chỗ là khách thấy ngay".
- Không đáng cho sửa text/CSS/một file.

## Quy trình

### 1. Chuẩn bị (trọng tài)

- `implement-flow` bước 1–3: context, gate, worktree. DoD đã có trong `tasks/<KEY>/index.md`.
- Chạy `npx tsc --noEmit` một lần trên nhánh base sạch, lưu `tasks/<KEY>/tsc-baseline.log` — base có thể sẵn lỗi; executor so với baseline, không đòi 0.

### 2. Brief cho executor — `tasks/<KEY>/worker-brief.md`

Executor không thấy cuộc trò chuyện của bạn. Brief phải tự đứng được:

```markdown
# Brief — <KEY>
## Mục tiêu (1–2 câu)
## DoD (copy từ index.md, đánh số)
## Chỉ đúng chỗ
- file:line đã tra bằng grep trên nhánh base, kể cả chỗ hard-code cùng giá trị
## Không đổi
- <X> trừ khi trọng tài accept finding về <X>      ← viết dạng này, không viết "không đổi X" trần
## Dừng và báo cáo khi
- <lấy từ mục "cần confirm" của gate>
## Định nghĩa xong
- tsc trùng baseline · lint 0 · không console/TODO · implement.md có entry · KHÔNG commit
```

Bẫy brief thường gặp: file > 800 dòng → ép "Grep trước, Read theo dải ≤ 60 dòng", cân nhắc tách task; executor
hết lượt là lỗi brief, không phải lỗi model.

### 3. Chạy executor

Bằng bất kỳ runtime nào bạn có: session Claude Code thứ hai mở trong worktree, `codex exec`, hoặc subagent.
Theo dõi log sớm vài phút để bắt đi lạc; hết lượt thì gửi tiếp danh sách việc còn lại thật ngắn, giữ session.

### 4. Trọng tài đọc diff TRƯỚC khi mở reviewer

`git -C <worktree> diff --stat` + đọc hunk chính. Ghi 2–3 điểm nghi của **mình** (data shape, state reset,
consumer dùng chung, PC/mobile). Đây là căn cứ để không bị reviewer dẫn.

### 5. Reviewer khác họ

Đưa diff + DoD + điểm nghi của trọng tài dưới dạng câu hỏi. Với Codex: skill `claude-drives-codex`
(`/codex:review` hoặc `/codex:adversarial-review`). Yêu cầu output có id, file:line, mức độ, lý do.

### 6. Trọng tài phán từng finding

Mỗi finding → **mở code kiểm chứng** rồi mới verdict:

- `Accept` → ghi hướng sửa cụ thể (file, nhánh, giữ gì).
- `Reject` → ghi file:line chứng minh, hoặc quyết định của khách (comment ticket).
- Không accept vì "nghe hợp lý". Kinh nghiệm đo được: khoảng nửa finding của reviewer sai, đều bác được bằng code.

Finding của chính trọng tài mà reviewer bỏ sót → gửi lại executor.

### 7. Gate chất lượng + self-test

`browser-evidence` do **trọng tài** chạy — không tin "đã kiểm tra" của executor vì executor thường không có dev server.
Sai → sửa (1–2 dòng tự sửa, lớn hơn gửi executor), chụp lại.

### 8. Bàn giao

`implement.md`: kết quả executor · finding + verdict · evidence · điểm cần khách/PM chốt. Sổ finding ở
`tasks/<KEY>/review/`. Commit/push chỉ khi user yêu cầu.

## Bẫy

- Reviewer `--resume` nhớ code cũ → mỗi vòng phiên mới.
- Executor gộp "không đổi X" thành lý do bỏ việc → viết "trừ khi trọng tài accept".
- Quá 2–3 job reviewer song song → rate limit.
