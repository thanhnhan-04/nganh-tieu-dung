# Ngành tiêu dùng — Key Driver Dashboard

Dashboard theo dõi các key driver (giá hàng hoá, FX, chính sách, vận hành nội bộ) ảnh hưởng tới 4 doanh nghiệp ngành tiêu dùng: **VNM, MCM, QNS, SAB**.

Toàn bộ số liệu công ty được trích trực tiếp từ file model/PPT/PDF/BCTC nội bộ (không đưa lên repo này), có ghi rõ nguồn và các mâu thuẫn/khoảng trống dữ liệu tìm thấy trong tab *Data Quality & Sources*.

## Chạy local (có live data on-demand)

```bash
python3 server.py
# mở http://127.0.0.1:8765
```

`server.py` gọi Yahoo Finance trực tiếp mỗi lần bấm "Refresh live" — dùng khi phát triển/chỉnh sửa.

## Site live trên GitHub Pages

GitHub Pages chỉ host file tĩnh nên không chạy được `server.py`. Thay vào đó, workflow
[`refresh-live-data.yml`](.github/workflows/refresh-live-data.yml) chạy mỗi 30 phút, gọi
`fetch_live.py` (tái dùng logic fetch của `server.py`) và commit lại `live-data.json`.
Frontend (`app.js`) tự thử `/api/live` trước, nếu không có (trường hợp static hosting) sẽ
fallback sang đọc `live-data.json` — nên cùng một codebase chạy được cả hai chế độ.

## Cấu trúc

- `index.html`, `app.js`, `styles.css` — frontend
- `dashboard-data.json` — dữ liệu công ty/driver đã trích từ nguồn (snapshot, cập nhật thủ công khi có phân tích mới)
- `server.py` — local dev server + logic fetch Yahoo Finance
- `fetch_live.py` — script one-shot dùng trong CI để ghi `live-data.json`
- `live-data.json` — snapshot live gần nhất (tự động, đừng sửa tay)
