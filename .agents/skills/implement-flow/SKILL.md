---
name: implement-flow
description: Dùng khi nhận một câu giao việc (ticket key hoặc tên task + yêu cầu) và cần làm trọn — gom context, gate DoD, tạo worktree/nhánh/cổng, code, self-test tới khi pass, chụp evidence, báo cáo — không hỏi lại thứ đã có.
---

# Implement Flow — từ câu giao việc tới báo cáo có bằng chứng

Đây là skill xương sống; các skill khác là từng bước của nó. User chỉ cần dán một câu. Không hỏi lại những gì
đã ghi trong prompt hoặc đã có trong `tasks/`; dừng hỏi chỉ khi gate bảo dừng.

## 1. Context

- Tên task: ticket key (`ABC-12`) hoặc slug từ prompt (`Task them-loc:` → `them-loc`). Không có → tự đặt slug ngắn, nói ra.
- Prompt **chỉ có ticket key** → skill `backlog-context` (+ `slack-context`, `figma-context`, `video-context` nếu ticket dẫn tới).
- Prompt **đã có yêu cầu** → ghi thẳng vào `tasks/<TASK>/index.md`, không gọi Backlog.

## 2. Gate

Skill `requirement-gate`: viết DoD kiểm được, phân loại tiêu chí, quyết định hỏi hay đi. Hỏi thì hỏi **một
lần gom hết**, kèm đề xuất.

## 3. Worktree + nhánh + cổng + env

```bash
bash .external-assets/worktree/ensure-worktree.sh <TASK> [repo]
```

Script `.external-assets/worktree/ensure-worktree.sh` (lấy riêng: `npx degit Kaka-123-D/ai-parallel-workspace-kit/.external-assets/worktree .external-assets/worktree`): worktree `.worktrees/<TASK>/<repo>` trên `feat/<TASK>` từ `main` (đổi bằng
`WORKTREE_BASE=develop`) → symlink `node_modules` khi lockfile giống → copy env từ `.workspace/env/<repo>/`
(không symlink) → cổng: ticket `ABC-12` → `3012`, slug → rảnh kế tiếp từ `3011`, có khoá chống tranh →
ghi `.port` (app đọc file này) + `.workspace/ports.json` → in `WORKTREE=` `PORT=`.

**Từ đây mọi lệnh chạy trong worktree.** Nhiều repo cho một task (FE + BE) → chạy script hai lần với tên repo.

Không symlink: `.env*`, `dist`, `.next`, cache. Không cài dependency trong worktree nếu không bắt buộc.

## 4. Tìm hiểu trước khi sửa

- Đọc file sẽ sửa và consumer của nó (`git grep -n <symbol>`), type/interface dùng chung, API contract nếu FE↔BE.
- Có tài liệu nghiệp vụ → `repo-srs-map` để mở đúng màn/spec.
- Ghi entry đầu `tasks/<TASK>/implement.md`: nhánh, worktree, cổng, phạm vi, giả định từ gate.

## 5. Code

- Đúng phạm vi DoD. Không refactor ngoài yêu cầu. Không đổi rule nghiệp vụ vì UI tiện hơn.
- Text hiển thị lấy nguyên văn từ nguồn (ticket/Figma/SRS), không tự dịch.
- Xong: `npx tsc --noEmit` (FE/TS) sạch; lint file đã sửa 0 warning. Không `console.*`, `TODO`, `@ts-ignore`.
- Task ghi "không sửa code" → bỏ hẳn bước này.

## 6. Self-test tới khi pass

Skill `browser-evidence`: dev nền đúng cổng → `.evidence/run.mjs` → từng AC → khoanh, chụp → fail thì
sửa → chạy lại → pass hết. Không đẩy lỗi sang người khi còn tự sửa được.

## 7. Báo cáo

- `tasks/<TASK>/implement.md`: file sửa, hướng làm, giả định, điều chưa làm được, vòng test.
- `tasks/<TASK>/evidence/report.html` + `test-report.md` theo skill `evidence-report`.
- Trả lời: bảng AC · pass/fail · link. **Không commit/push** khi user chưa yêu cầu. Không tắt dev server.

## Sơ đồ

```text
câu giao việc
  └─ context (backlog / slack / figma / video → tasks/<TASK>/)
      └─ gate (DoD · giả định · hỏi một lần nếu cần)
          └─ worktree + nhánh + cổng + env
              └─ tìm hiểu → code → tsc/lint
                  └─ self-test ⇄ sửa (tới khi pass)
                      └─ evidence + implement.md → trả lời
```
