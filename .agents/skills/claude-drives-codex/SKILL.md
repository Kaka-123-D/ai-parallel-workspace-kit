---
name: claude-drives-codex
description: Dùng khi muốn Claude Code giao việc cho Codex hoặc lấy Codex làm reviewer khác họ — qua plugin chính thức openai/codex-plugin-cc (lệnh /codex:review, /codex:adversarial-review, /codex:rescue, /codex:status, /codex:result).
---

# Claude điều khiển Codex (plugin `codex-plugin-cc`)

Plugin chính thức của OpenAI cho Claude Code: `https://github.com/openai/codex-plugin-cc`. Claude làm
controller/trọng tài; Codex làm executor hoặc reviewer khác họ.

## Cài một lần

```bash
npm install -g @openai/codex          # Codex CLI ≥ 0.150
codex login                           # hoặc OPENAI_API_KEY
# trong Claude Code:
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/codex:setup                          # kiểm tra CLI, có thể bật review gate
```

## Lệnh

| Lệnh | Làm gì | Dùng khi |
|---|---|---|
| `/codex:review [--wait\|--background] [--base <ref>] [--scope auto\|working-tree\|branch]` | Codex review diff local, trả findings **nguyên văn** | Reviewer khác họ cho task Claude vừa làm |
| `/codex:adversarial-review …` | Review kiểu **phản biện cách làm**: giả định, thiết kế, chỗ vỡ trong thực tế | Task có quyết định thiết kế đáng nghi |
| `/codex:rescue [--background\|--wait] [--resume\|--fresh] <việc>` | Giao Codex điều tra / sửa / tiếp tục — qua subagent `codex:codex-rescue` | Claude kẹt, hoặc muốn Codex làm executor |
| `/codex:status [job-id]` · `/codex:result <job-id>` · `/codex:cancel` | Theo dõi job nền | — |
| `/codex:transfer` | Chuyển phiên Claude hiện tại thành thread Codex resume được | Đổi tool giữa chừng |

Quy ước plugin: review là **chỉ đọc** — không sửa, không đề xuất sửa; output Codex trả về nguyên văn để
trọng tài tự phán. `rescue` mặc định **được ghi** (`--write`) trừ khi bạn nói chỉ đọc.

## Hai cách dùng trong workflow

### A. Codex là reviewer (đi với `multi-agent-one-task`)

1. Claude implement trong worktree, `tsc` sạch.
2. Trọng tài đọc diff trước, ghi 2–3 điểm nghi.
3. `/codex:adversarial-review --wait <điểm nghi dưới dạng câu hỏi>` — diff lớn thì `--background` rồi `/codex:result`.
4. Mỗi finding → mở code → Accept (hướng sửa) / Reject (file:line).

### B. Codex là executor

1. Viết `tasks/<KEY>/worker-brief.md` theo `multi-agent-one-task` bước 2.
2. `/codex:rescue --background Đọc tasks/<KEY>/worker-brief.md và thực hiện trong .worktrees/<KEY>/<repo>. Không commit.`
   Plugin tự nén request theo skill `gpt-5-4-prompting` (task · output contract · verification loop · action safety).
3. `/codex:status` theo dõi; hết lượt → `/codex:rescue --resume <việc còn lại, ngắn>`.
4. Claude review diff → Accept/Reject → self-test bằng `browser-evidence`.

## Prompt cho Codex — điều plugin đã dạy

Nói với Codex như **người vận hành**, không như đồng nghiệp: một task một lần chạy · nói rõ "xong" trông ra
sao · có verification rule · block XML ổn định (`<task>`, `<output_contract>`, `<verification_loop>`,
`<action_safety>`). Không tăng reasoning trước khi siết prompt.

## Bẫy

- Review gate (`/codex:setup --enable-review-gate`) chạy Codex review **mỗi lần Claude dừng** — tốn; bật khi cần.
- `--resume` giữ ngữ cảnh cũ; đổi hướng thì `--fresh`.
- Không gọi `Skill(codex:rescue)` từ trong subagent — treo session. Chỉ dùng lệnh `/codex:rescue`.
- Kết quả Codex là **đề xuất**; trọng tài vẫn mở code kiểm rồi mới sửa.
