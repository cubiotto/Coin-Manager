// Cấu hình Google cho đồng bộ Drive — tách riêng khỏi code để mỗi người dùng OAuth client của mình.
// Client ID không phải bí mật (hiện công khai trên trang đăng nhập Google), commit được.
//
// Tạo ở Google Cloud Console → APIs & Services → Credentials → OAuth client ID (loại "Web application"),
// xem hướng dẫn: docs/google-oauth-setup.md
export const GOOGLE_CLIENT_ID = '665718028785-7p32r09s7vf5sjkmg8jbuji7hucm3tom.apps.googleusercontent.com';
