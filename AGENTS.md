# AGENTS.md

Nguồn hướng dẫn canonical của workspace là `.agents/`. Mỗi skill trong `.agents/skills/<tên>/SKILL.md` có
`description` nêu rõ khi nào dùng; harness tự chọn skill theo description, không cần mục lục riêng. Chỉ mở skill
đang cần, không nạp toàn bộ.

## Cấu trúc

```text
.agents/                        skills/, rules/, .env (token — gitignored)
.claude/                        symlink skills/rules → .agents/ ; settings.json
.external-assets/               tool: backlog, worktree, evidence, gyazo
.workspace/env/<repo>/          env template theo repo (không secret); ports.json
.worktrees/<TASK>/<repo>        nơi làm task: mỗi task một worktree + một nhánh + một cổng (file .port)
docs/                           SRS, screen list, API spec, message list (read-only với agent)
repos/<FE|BE|CMS|Worker>        code canonical, nhánh base — KHÔNG sửa trực tiếp
tasks/<TASK>/                   index.md (yêu cầu, DoD), implement.md, evidence/
```

Workspace root không phải git repo. Luôn `git -C repos/<repo>` hoặc `git -C .worktrees/<TASK>/<repo>`.

## Luật ngắn

- Nhận câu giao việc → `implement-flow`. Không hỏi lại thứ đã có trong prompt hay `tasks/`.
- Mọi sửa code, mọi lần chạy dev đều trong `.worktrees/<TASK>/<repo>`.
- Không symlink `.env*`, `dist`, `.next`, cache. `node_modules` symlink được khi lockfile giống.
- Xong code phải tự test (`browser-evidence`) tới khi pass rồi mới báo cáo (`evidence-report`).
- Không commit, không push nếu user chưa yêu cầu. Không đọc `.agents/.env` ra chat.
- Text hiển thị (label, message) copy nguyên văn từ nguồn, không tự dịch.
