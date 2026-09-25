# ai-parallel-workspace-kit

Workspace skeleton + 12 skill để một dev điều phối nhiều AI agent (Claude Code, Codex) chạy nhiều task song song: mỗi task một git worktree, một nhánh, một cổng; agent tự lấy context, tự dựng DoD, tự test trên trình duyệt và chụp evidence.

_A workspace skeleton and 12 agent skills for running several coding agents in parallel, one worktree + port per task, with self-test and evidence built in._

## Lấy cả bộ

```bash
git clone https://github.com/Kaka-123-D/ai-parallel-workspace-kit.git my-project
cd my-project
git clone <url-fe> repos/FE            # hoặc: ln -s /path/to/existing/FE repos/FE
cp .agents/.env.example .agents/.env    # điền token Backlog/Slack nếu dùng
```

Windows: bật Developer Mode rồi `git clone -c core.symlinks=true …` để `.claude/skills` và `.claude/rules` là symlink thật.

## Lấy từng skill

```bash
npx degit Kaka-123-D/ai-parallel-workspace-kit/.agents/skills/backlog-context .agents/skills/backlog-context
```

Ba skill cần thêm tool trong `.external-assets/`: `backlog-context` → `backlog/` + `gyazo/`, `implement-flow` → `worktree/`, `browser-evidence` → `evidence/`. Lấy cùng cách:

```bash
npx degit Kaka-123-D/ai-parallel-workspace-kit/.external-assets/worktree .external-assets/worktree
```

## Cấu trúc

```text
.agents/            skills/<tên>/SKILL.md, rules/*.md, .env (gitignored), .env.example
.claude/            symlink skills/rules → .agents/ ; settings.json (allowlist quyền)
.external-assets/   tool: backlog, worktree, evidence, gyazo
.workspace/env/     env template theo repo (không secret); ports.json do script ghi
.worktrees/<TASK>/  nơi làm task (gitignored)
docs/               SRS, screen list, API spec — read-only với agent
repos/<repo>/       code canonical (gitignored)
tasks/<TASK>/       index.md, implement.md, evidence/
AGENTS.md           mọi agent đọc
CLAUDE.md           Claude đọc, trỏ về AGENTS.md
```

## Skill

| Nhóm | Skill |
|---|---|
| Context | backlog-context · slack-context · figma-context · video-context · requirement-gate · repo-srs-map |
| Implement | implement-flow · browser-evidence · evidence-report |
| Điều phối | multi-agent-one-task · multi-agent-many-tasks · claude-drives-codex |

## Bắt đầu

1. Cài `node_modules` một lần trong `repos/<repo>`, commit lockfile (worktree symlink `node_modules` khi lockfile giống).
2. App đọc cổng từ file `.port` cạnh config (script worktree ghi file này).
3. Mở Claude Code hoặc Codex tại thư mục này, chấp nhận trust, hỏi "bạn thấy skill nào" để kiểm.
4. Dán `Task <ticket>` và để agent chạy.

MIT.
