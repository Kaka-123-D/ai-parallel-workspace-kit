# Self-test và evidence — bắt buộc sau khi code

Không tuyên bố "xong" khi chưa tự test và chưa có bằng chứng.

- **Static**: `npx tsc --noEmit` sạch. Đọc output thật.
- **Behavioral**: chạy app đúng cổng worktree, đi qua từng AC bằng script Playwright tạm (`.evidence/run.mjs`), khoanh vùng rồi chụp.
- Mỗi AC ít nhất một ảnh trong `tasks/<TASK>/evidence/`, tên `AC-nn_<mô-tả>.png`.
- AC có con số/chuỗi cụ thể thì đọc DOM ra so sánh, không nhìn ảnh đoán.
- Fail → sửa → test lại. Đẩy sang người chỉ khi đã thử mà không tự sửa được, và nói rõ.
- Report cuối: bảng AC → cách verify → kết quả, đánh dấu cái nào live-verified.
- Không chụp evidence của state khác rồi nói là của AC này. Không dọn evidence trước khi user xác nhận.
