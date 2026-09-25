---
name: figma-context
description: Dùng khi cần đọc thiết kế Figma cho task — layout màn, bảng feedback/review, node ID, chuỗi chữ nguyên văn, screenshot — qua figma-mcp-go điều khiển Figma desktop. Chỉ đọc.
---

# Figma Context (figma-mcp-go)

Figma là nguồn sự thật cho layout, khoảng cách, **chuỗi chữ hiển thị**; tài liệu nghiệp vụ là nguồn sự thật
cho hành vi. Skill này lấy phần Figma về file để agent đọc cùng ticket.

## Cài một lần

`.mcp.json` ở root workspace:

```json
{ "mcpServers": { "figma-mcp-go": {
  "type": "stdio", "command": "npx",
  "args": ["-y", "@vkhanhqui/figma-mcp-go@latest"], "env": {} } } }
```

Server nói chuyện với **Figma desktop qua plugin bridge**: app mở, file đúng đang focus, plugin đang chạy.
Không có tham số URL — mọi tool thao tác trên file đang mở. Trả rỗng / "node not found" → nghi **sai file
đang focus** trước.

## Chỉ đọc

Server có ~60 tool tạo/sửa. **Không gọi** trừ khi user yêu cầu sửa thiết kế rõ ràng.

## Recipe

1. `get_metadata` — file nào đang mở.
2. `get_pages` → `navigate_to_page({pageName})` — tool chỉ thấy **trang hiện tại**.
3. Tìm: `search_nodes({query, types:["FRAME","SECTION"]})` hoặc `get_design_context({depth:2, detail:"minimal"})`.
4. Lấy:
   - `scan_text_nodes({nodeId})` — bảng feedback, **label nguyên văn**.
   - `get_node` / `get_nodes_info` — hình học, fill.
   - `save_screenshots({items:[{nodeId, outputPath}]})` — ghi ra đĩa, không đổ base64 vào context. `outputPath` trong repo → thư mục gitignored.

## Đọc bảng review

`scan_text_nodes` trả danh sách phẳng — ranh giới hàng là **đoán**: đối chiếu với cột đánh số; cột ưu tiên
hay không qua scan → nói rõ; mục suy ra thì đánh ⚠️.

## Bẫy node ID gốc/clone

Khách giữ **master** và giao **clone**. Node ID **không** giữ giữa hai file. 404 ≠ đã xoá: tìm lại **theo tên**,
ghi cả hai ID kèm file. Trong tài liệu luôn viết `<file-key> + <node-id>`. Giữ bảng file → key → node quan
trọng trong `figma-map.md`; thêm khi nhận clone mới.

## URL ↔ node ID

`?node-id=17730-5062` → `"17730:5062"`.

## Ghi về workspace

`tasks/<KEY>/figma-context.md`: màn → node, screenshot đã lưu, **label nguyên văn** (không dịch, không sửa),
điểm Figma khác tài liệu (ghi cả hai).

## Bẫy khác

- Frame lớn: `get_node`/`search_nodes` timeout; `scan_text_nodes`, `save_screenshots` vẫn chạy.
- `get_document` = cả trang, đắt.
