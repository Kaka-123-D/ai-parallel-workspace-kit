---
name: repo-srs-map
description: Dùng khi cần biết một màn/chức năng nằm ở đâu trong các repo (FE, BE, CMS, Worker) và spec tương ứng ở đâu trong SRS/docs — từ screen ID, route, tên tiếng Nhật, hoặc file code — trước khi implement hay audit.
---

# Repo ↔ SRS Map

Ba nơi gọi tên một màn theo ba kiểu: SRS gọi **screen ID**, FE gọi **route**, BE gọi **controller**. Skill này
nối chúng lại bằng grep — không có bảng tĩnh phải bảo trì.

## Điều kiện để grep thay bảng

Code có **chú thích screen ID** ở đầu file/component/controller (`// Screen: A-018`). Nếu repo chưa có, việc
đầu tiên khi nhận workspace là thêm — một lần, sau đó mọi agent tìm được.

## Cấu trúc workspace nhiều repo

```text
repos/FE        Next.js / React — route, component, hook, type FE
repos/BE        API — controller, service, DTO, entity, migration
repos/CMS       admin — màn quản trị, permission, mapping dữ liệu
repos/Worker    job nền — queue, cron, consumer
docs/  hoặc  repos/docs/   SRS, screen list, API spec, message list
```

Mỗi repo tự version-control; workspace root không phải git repo → luôn `git -C repos/<repo>`.

## Entry point: grep

```bash
SCREEN=A-018        # hoặc route / label tiếng Nhật
grep -rlE "\b$SCREEN\b" repos/FE/src   --include='*.ts' --include='*.tsx'
grep -rlE "\b$SCREEN\b" repos/BE/src   --include='*.ts'
grep -rlE "\b$SCREEN\b" repos/CMS/src  --include='*.ts' --include='*.tsx'
ls docs/ | grep -i "$SCREEN"                       # thư mục spec theo màn
grep -rl "ログイン" docs/                        # tìm ngược từ label Nhật
grep -rE "\b[AU]-[0-9]{3}\b" repos/FE/src/app/<route>/   # từ route ra screen ID
```

zsh: quote `--include='*.ts'`.

## Đọc đúng loại tài liệu

| Tài liệu | Đọc khi |
|---|---|
| Thiết kế cơ bản (基本設計 / BD) — mục đích màn, luồng, business rule BR-xx, quyền theo role | cần *hiểu nghiệp vụ* |
| Thiết kế chi tiết (画面詳細設計 / DD) — từng field, validation, label nguyên văn, message | *code UI* |
| API spec — route, method, request/response, status, auth | nối FE↔BE |
| Message list — mã lỗi `E_xxxx`, text | hiển thị lỗi, validate |

Làm một màn FE cần **cả BD lẫn DD**.

## Nối FE ↔ BE: backend là nguồn sự thật cho contract

Không đoán field/nullability/enum từ FE. Trước khi sửa FE integration: đọc controller/DTO/serializer ở BE
trên nhánh base. Ghi vào `tasks/<KEY>/index.md`: endpoint, method, request/response, status, auth, pagination.
FE và BE lệch → cite file BE, không âm thầm vá FE.

## Quy tắc trích xuất

- Chuỗi tiếng Nhật/label: **copy nguyên văn từng ký tự**. Đây là thứ chốt với khách.
- Mã lỗi: đúng mã trong spec; FE rẽ nhánh theo mã, không theo text.
- Ghi mã BR khi implement để trace ngược.
- Spec mâu thuẫn code → **spec đúng**; báo lại, không sửa spec cho khớp code.
- Spec là read-only với agent. Sửa spec chỉ khi user yêu cầu từng file.

## Khi grep không ra

1. Sai hoa/thường hoặc dấu gạch → thử biến thể. 2. Tìm ngược từ route hoặc label Nhật. 3. Vẫn không → màn chưa
được chú thích: hỏi user 1 câu, rồi thêm chú thích để lần sau grep được.

## Output vào `tasks/<KEY>/index.md`

```text
Screen A-018 — <tên>
  spec: docs/A-018/【基本設計書】…md · 【画面詳細設計書】…md
  FE:   repos/FE/src/app/admin/allowance/page.tsx (+ 3 file)
  BE:   repos/BE/src/admin/allowance.controller.ts · allowance.service.ts
  API:  GET /api/v1/admin/allowances · POST … (auth: admin)
```
