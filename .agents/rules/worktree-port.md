# Worktree và cổng

- Worktree: `.worktrees/<TASK>/<repo>`, nhánh `feat/<TASK>`, tạo từ `main`.
- Cổng: ticket key → `3000 + số ticket`; slug → cổng rảnh kế tiếp từ 3011; bận thì +1. Ghi `.port` trong worktree và `.workspace/ports.json`.
- `.port` không commit. Vite đọc file này nên `npm run dev` không cần tham số.
- Không symlink env, `dist`, cache giữa worktree. `node_modules` thì được, khi lockfile giống nhau.
- Đóng task: `git -C repos/<repo> worktree remove .worktrees/<TASK>/<repo>` khi user yêu cầu.
