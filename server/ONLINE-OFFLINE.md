# Chế độ online và offline của phần mềm cân

Máy nối trực tiếp đầu cân là máy chủ duy nhất và vẫn lưu toàn bộ dữ liệu trong:

```text
D:\Cân Sơn Phú 2026\Cân Sơn Phú 2026.sqlite
```

Giao diện cân tự thử các địa chỉ theo thứ tự:

1. `VITE_SCALE_SERVER_URL` (địa chỉ online, nếu đã cấu hình).
2. `VITE_SCALE_LAN_URL` (địa chỉ LAN, mặc định `http://192.168.1.12:8787`).
3. Máy chủ cân cục bộ nếu đang mở trực tiếp trên máy đầu cân.

Nếu đường online mất, các thiết bị cùng mạng nội bộ vẫn dùng được qua LAN. Điện
thoại ở ngoài mạng LAN không thể cân khi Internet tại máy đầu cân bị mất; đây là
giới hạn vật lý của kết nối mạng, không phải lỗi phần mềm.

## Để dùng online từ mọi nơi

Không đưa trực tiếp cổng 8787 ra Internet. Dùng một đường hầm bảo mật (ví dụ
Cloudflare Tunnel hoặc VPN Tailscale) trỏ tới `http://127.0.0.1:8787` trên máy
đầu cân. Sau đó đặt URL HTTPS của đường hầm làm biến môi trường Vercel:

```text
VITE_SCALE_SERVER_URL=https://dia-chi-duong-ham-cua-ban.example
VITE_SCALE_LAN_URL=http://192.168.1.12:8787
```

Build/deploy lại Vercel sau khi thay đổi biến môi trường. Không đưa token đường
hầm hoặc mật khẩu router vào mã nguồn.

## Chạy nhanh trên máy đầu cân

Sau khi giải nén bộ cài, chạy `CHAY-DUONG-HAM-ONLINE.cmd` trên máy đầu cân.
Lần đầu script tải `cloudflared.exe` từ Cloudflare rồi hiện một địa chỉ HTTPS
tạm thời. Địa chỉ này chỉ tồn tại khi cửa sổ đang mở. Muốn địa chỉ cố định cần
tạo Named Tunnel trong tài khoản Cloudflare, sau đó đặt token vào biến môi trường
`SCALE_TUNNEL_TOKEN` trên máy đầu cân và chạy lại script.
