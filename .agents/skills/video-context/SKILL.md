---
name: video-context
description: Dùng khi ticket hay evidence có video (.mp4) và cần hiểu timeline, trạng thái trước/sau, hành vi UI theo thời gian — bằng cách trích frame và contact sheet để agent đọc được.
---

# Video Context

Agent không xem được video; nó xem được **frame**. Trích đúng frame rồi đọc như một chuỗi.

## ffmpeg

Thiếu thì hỏi user trước khi cài (`brew install ffmpeg` / `apt install ffmpeg`).

```bash
OUT=tasks/<KEY>/video-frames/<tên-video>; mkdir -p "$OUT"
ffmpeg -y -i <video>.mp4 -vf "fps=1/<giây>,scale=474:-1,tile=3x3" -frames:v 1 -update 1 "$OUT/contact-sheet.png"
ffmpeg -i <video>.mp4 -vf "fps=1/<giây>" "$OUT/frame-%03d.png"
```

`<giây>`: video < 30s → `2`; dài hơn → chọn để ra 8–12 frame, trích thêm quanh đoạn quan tâm.
macOS không có ffmpeg: `qlmanage -t -s 1200 -o "$OUT" <video>.mp4` — một thumbnail, đủ biết màn nào, không đủ kết luận hành vi.

## Đọc

1. Contact sheet → flow tổng. 2. Frame quan trọng → chi tiết.
3. `tasks/<KEY>/video-context.md`: màn lúc bắt đầu · thao tác/chuyển tiếp · trạng thái đổi ở frame nào ·
   lỗi thuộc layout / timing / hiển thị / component state.
4. Đối chiếu comment ticket trước khi plan.

## Ưu tiên khi nhiều asset cùng vùng UI

1. Mock/ảnh khách sửa **sau** video → 2. Comment khách nói rõ đổi gì → 3. Body ticket → 4. Video đề xuất của team.
Khách reply "đúng" với video **không** tự thành nguồn sự thật nếu cùng thread có mock mới hơn. Video chỉ cho
thứ mock không thể hiện: timing, hướng chuyển, quán tính cuộn.

## Nguyên tắc

Kết luận hẹp · chỉ thumbnail thì thận trọng · mơ hồ thì hỏi timestamp · cite `[@tasks/<KEY>/video-frames/.../frame-003.png]`.
