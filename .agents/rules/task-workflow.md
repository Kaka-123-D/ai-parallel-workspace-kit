# Quy trình task

1. Câu giao việc (tên task + yêu cầu) → `implement-task`. Yêu cầu ghi lại vào `tasks/<TASK>/index.md`.
2. Code chỉ trong `.worktrees/<TASK>/<repo>`; không đụng `repos/<repo>`.
3. Không cài dependency trong worktree; dùng symlink `node_modules` từ repo canonical.
4. `npx tsc --noEmit` sạch trước khi self-test.
5. Self-test bằng `playwright-evidence` tới khi pass hết mới báo cáo.
6. Sau mỗi lát cắt có ý nghĩa, ghi `tasks/<TASK>/implement.md`: file sửa, hướng làm, đã verify gì.
7. Không commit/push nếu user chưa yêu cầu. Không để lại `console.log`, `TODO`.
