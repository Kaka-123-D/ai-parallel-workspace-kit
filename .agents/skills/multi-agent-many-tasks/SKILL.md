---
name: multi-agent-many-tasks
description: Dùng khi có nhiều task độc lập cần chạy song song — mỗi task một agent, một worktree, một cổng — và người điều phối cần giao xong là chuyển, biết ngay con nào đang dừng chờ, gom quyết định theo đợt mà không quá tải.
---

# Multi-agent · nhiều task

Mỗi task một agent, mỗi agent một worktree + nhánh + cổng. Người điều phối không tự làm N việc — điều phối N luồng.

## Điều kiện vào

- Mỗi task đã qua `requirement-gate`: có DoD, điểm mờ đã liệt kê.
- Các task **đủ độc lập**: không cùng sửa một vùng code. Hai task đụng cùng file → làm nối tiếp, đừng ép song song.
- Workspace có `implement-flow` (script worktree tự cấp cổng, có khoá chống tranh).

## Quy trình

### 1. Giao việc — giao xong là chuyển

Mở một session mỗi task (pane cmux / tab terminal / session extension), cùng thư mục workspace. Dán câu giao
việc vào session 1, **không chờ**, sang session 2. Mỗi câu chỉ cần tên task + yêu cầu; phần dài đã nằm trong
`tasks/` và skill.

Agent tự chạy `ensure-worktree.sh` → mỗi con một cổng. Không tạo worktree hay chọn cổng trước.

### 2. Biết ngay con nào đang dừng

Terminal thường: bốn cửa sổ trông y hệt, không biết con nào đã dừng chờ → phải đi tuần. Cần cơ chế báo:

- **cmux** (macOS): session dừng → dòng workspace ở sidebar sáng + thông báo hệ điều hành.
- **Không cmux**: bật notification của Claude Code (hook `Notification` → `osascript`/`notify-send`), hoặc tmux `monitor-silence`.

Chỉ vào đúng con đang chờ, trả lời, quay về. Không con nào bị bỏ quên.

### 3. Trong lúc chờ — không đứng nhìn

Làm việc khác: review diff của con đã xong, đọc ticket tiếp theo, hoặc nghỉ. Đứng nhìn agent chạy là tuần tự trá hình.

### 4. Xem kết quả — mỗi con trên cổng của nó

Mỗi task có `tasks/<TASK>/evidence/report.html` và dev server riêng còn chạy. Xem report → mở app trên đúng
cổng → `git -C <worktree> status --short` để chắc diff nằm đúng chỗ.

Chứng minh isolation cho người khác: mở cổng của task B **sau khi** task A đã sửa xong — B vẫn nguyên.

### 5. Gom

Từng task một: review diff, self-test lại nếu cần, commit khi user yêu cầu. Hai nhánh đụng nhau lúc merge là
**bình thường** — worktree dời conflict về đúng lúc nó nên xảy ra, và đó là việc của người.

## Nhịp — phần hay bị bỏ qua

Song song tăng throughput nhưng dồn **quyết định** về một người. Nguyên tắc:

- **Giới hạn số việc đang chạy**: 2–3; càng phức tạp càng ít.
- **Gom quyết định theo đợt**: để vài con dừng rồi xử một lượt, thay vì phản ứng từng thông báo.
- **DoD rõ trong brief** → agent bớt ngắt giữa chừng.
- **Cùng một format báo cáo** (`evidence-report`) → review nhanh, không ghép lại từ đầu.
- **Chủ động nghỉ** giữa các chu kỳ ra quyết định.

Mục tiêu là nhịp bền vững, không phải tối đa số session đang chạy.

## Đóng task

`git -C repos/<repo> worktree remove .worktrees/<TASK>/<repo>` sau khi merge; xoá entry trong `.workspace/ports.json`.
Dev server tắt khi user bảo.
