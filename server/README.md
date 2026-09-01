# Máy chủ cân trong mạng LAN

Máy nối trực tiếp với đầu cân chạy dịch vụ này. Trên Windows có ổ D, dữ liệu cân
được lưu tại `D:\Cân Sơn Phú 2026\Cân Sơn Phú 2026.sqlite`, không lưu lên
Supabase và không trộn với dữ liệu phần mềm nội bộ.

## Chạy trên máy đầu cân

```powershell
cd D:\ORDER-APP
npm run build
npm run scale:server
```

Sau đó xem địa chỉ IPv4 của máy đầu cân bằng `ipconfig`. Máy khác cùng mạng mở:

```text
http://IP-MAY-DAU-CAN:8787/scale
```

Windows Firewall cần cho phép Node.js nhận kết nối Private network ở cổng 8787.

## Biểu tượng ngoài Desktop

Chạy một lần:

```powershell
powershell -ExecutionPolicy Bypass -File .\server\install-scale-shortcut.ps1
```

Biểu tượng **Cân Sơn Phú 2026** sẽ xuất hiện ngoài Desktop. Khi bấm, nó tự bật
máy chủ cân nếu cần rồi mở `http://127.0.0.1:8787/scale`.

## Kết nối đầu cân thật

Máy chủ tự đọc đầu cân Keli D2008FA tại COM1, 9600 baud, 8 data bits, không parity,
2 stop bits theo đúng cấu hình phần mềm cân cũ của Sơn Phú. Nó nhận chế độ truyền
liên tục TF=0 và đồng thời hỏi dữ liệu theo Modbus TF=1. Có thể đổi stop bits bằng
biến `SCALE_STOP_BITS` nếu cần chẩn đoán.

Có thể đặt cấu hình trước khi chạy:

```powershell
$env:SCALE_COM_PORT="COM1"
$env:SCALE_BAUD_RATE="9600"
$env:SCALE_STOP_BITS="2"
npm run scale:server
```

Nếu trạng thái vẫn là "chờ đầu cân", cần kiểm tra dây RS232 chân 2-2, 3-3, 5-5 và
cài trên đầu cân: `bt=4` (9600), `tF=0` (truyền liên tục), `jn=0` (không parity).
