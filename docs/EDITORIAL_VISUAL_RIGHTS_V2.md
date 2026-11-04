# TigerIQ News — Visual Rights Contract V2

## Mục tiêu
Bài mới chỉ được xuất bản khi cover raster JPEG/WebP có quyền sử dụng và provenance kiểm chứng được. SVG lịch sử được giữ nguyên để không phá dữ liệu cũ; không được tạo SVG motif mới khi Visual V2 bật.

## Ma trận quyền
| Nhóm | Trạng thái | Điều kiện |
|---|---|---|
| Ảnh/asset do hãng phát hành | Cho phép có điều kiện | HTTPS, JPEG/WebP, license/rights evidence rõ, copyright/author rõ, AI disclosure rõ, hash/pixel xác minh |
| Ảnh gốc TigerIQ | Cho phép | Tác giả/chủ sở hữu, license nội bộ, file gốc và hash |
| Minh họa AI | Cho phép có điều kiện | Giấy phép/tài nguyên hợp lệ, `isAIGenerated=true`, caption VI/EN/ES bắt buộc gắn nhãn |
| Ảnh web scrape/stock không chứng từ | Cấm | Không được suy diễn quyền từ việc ảnh công khai hoặc có `og:image` |
| Quyền/nguồn/AI disclosure không rõ | Cấm | Fail closed, không đăng để đủ quota |

## Metadata bắt buộc
`visualVersion=2`, MIME, width/height, bytes, SHA-256, owner, author, originalSource, sourceAssetUrl, rightsEvidenceUrl, license, attribution, rightsClass, assetClass, isAIGenerated, caption VI/EN/ES, alt VI/EN/ES.

## Kiểm chứng
- Kích thước tối thiểu 1200×675 và gần tỷ lệ 16:9.
- Magic bytes/pixel dimensions phải khớp MIME và metadata.
- SHA-256 chống tái sử dụng asset giữa các bài mới.
- Download bị giới hạn 8 MiB, HTTPS, không credentials, redirect bị chặn.
- `og:image` một mình không phải chứng cứ quyền. Chỉ nhận disclosure khi có license + copyright + AI disclosure.
- Asset thiếu chứng từ là NOOP/fail closed; không gọi dịch vụ ảnh có phí để lấp khoảng trống.

## Tương thích lịch sử
Article cũ chưa có `visualVersion` vẫn được phép tham chiếu cover SVG canonical đã commit. Rule này chỉ dành cho readback/legacy, không phải đường tạo cover mới.
