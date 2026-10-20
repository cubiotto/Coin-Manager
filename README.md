# Coin Manager — Sổ Chi Tiêu

Ghi chi tiêu bằng giọng nói tiếng Việt, giao diện con vịt 🦆. Bấm micro, đọc *"bánh hai lăm nước ngọt hai lăm rau hai lăm"*, app tự tách **từng món**, **giá** và **danh mục**. Về nhà có thể **chia nhỏ hoá đơn** đã ghi. Không dùng AI, không cần máy chủ: dữ liệu **mã hoá** và lưu ngay trên điện thoại.

**Mở app:** <https://daydreamersy.github.io/Coin-Manager/>

- Chạy trên **Chrome Android**, cài lên màn hình chính như app (PWA), mở được khi không có mạng.
- Nhận giọng nói bằng Web Speech API của Chrome (`vi-VN`). Phần này cần mạng; khi offline vẫn gõ tay được.
- Tách số tiền và phân loại bằng quy tắc viết tay ([js/parser.js](js/parser.js), [js/categories.js](js/categories.js)), kết quả luôn như nhau với cùng một câu.

## Cách nói

Mẫu câu: **`[món] [giá] [món] [giá] …`** — không cần đọc đơn vị, số dưới 1000 hiểu là nghìn.

| Bạn nói | App hiểu |
|---|---|
| bánh hai lăm nước ngọt hai lăm rau hai lăm | 3 khoản: Bánh 25.000đ (Ăn uống) · Nước ngọt 25.000đ (Đồ uống) · Rau 25.000đ (Đi chợ) |
| siêu thị một trăm | Siêu thị · 100.000đ · Đi chợ & siêu thị |
| phở bò năm lăm cà phê hai mươi | 55.000đ + 20.000đ |
| bánh mì heo quay mười lăm nghìn / mười lăm ca / 15k | 15.000đ (vẫn hiểu khi có đơn vị) |
| cà phê sữa hai lăm k | 25.000đ · Cà phê & đồ uống |
| đổ xăng một trăm rưỡi | 150.000đ (không nói đơn vị → hiểu là nghìn) |
| tiền nhà ba triệu hai | 3.200.000đ · Nhà ở |
| tiền điện một triệu hai trăm ba mươi | 1.230.000đ |
| trà sữa ba mươi lăm nghìn và bánh tráng hai chục | 2 khoản: 35.000đ + 20.000đ |
| bánh mì hai ổ ba mươi · cà phê 2 ly 50 · xăng 2 lít 50 | "Bánh mì hai ổ" 30.000đ · "Cà phê 2 ly" 50.000đ · "Xăng 2 lít" 50.000đ (ổ, ly, chai, kg, người… là số lượng) |
| quà năm mới hai trăm · quà cho ba mẹ năm trăm | 200.000đ · 500.000đ ("năm mới", "ba mẹ" không bị nhầm là số) |
| tiền điện tháng chín năm trăm nghìn | "Tiền điện tháng chín" · 500.000đ |
| hôm qua ăn phở năm mươi lăm nghìn | ghi vào ngày hôm qua |
| nhận lương mười lăm triệu · thu bán đồ cũ hai trăm nghìn | khoản **thu** |

- Đơn vị: nghìn / ngàn / k / ca, triệu / tr, tỷ. Tiếng lóng **củ** (triệu), **lít / xị** (trăm nghìn), **cành** (nghìn) bật/tắt trong Cài đặt.
- Nói tắt: hai lăm (25), bốn mốt (41), ba tư (34), băm sáu (36), trăm rưỡi (150), ba triệu hai (3,2 triệu).
- Danh mục đoán theo **từ khoá dài nhất** khớp trong tên ("grab food" → Ăn uống, "grab" → Di chuyển). Khi bạn đổi danh mục của một khoản, app **ghi nhớ** cho lần sau (xem/xoá trong Cài đặt → Đã học từ bạn).
- Thêm từ khoá riêng trong **Cài đặt → Danh mục & từ khoá**: chạm vào danh mục, gõ từ khoá, bấm **Lưu**. Từ khoá bạn thêm thắng từ khoá có sẵn khi dài bằng nhau (ví dụ thêm "bánh" cho Đi chợ).
- Nút 🎤 nằm giữa thanh dưới cùng (tầm ngón cái) và dùng được ở mọi tab; kết quả + nút Lưu hiện ngay phía trên nút.

## Tài sản

Thẻ **🏦 Tài sản** ở tab Hôm nay: tiền thật đang nằm ở đâu — Tiền mặt, Ngân hàng, Momo / ZaloPay, Thẻ tín dụng… và tổng tài sản.

- **Nói kèm tài sản khi ghi:** *"thịt bò năm mươi nghìn tiền mặt"* → Thịt bò 50.000đ (Đi chợ & siêu thị), trừ vào **Tiền mặt**. Hiểu cả *"bằng momo"*, *"quẹt thẻ"*, *"chuyển khoản"*; khoản thu *"nhận lương mười lăm triệu vào vietcombank"* thì cộng vào.
- Cả câu chỉ nhắc một tài sản → mọi khoản trong câu dùng tài sản đó (*"bánh 25 nước ngọt 25 tiền mặt"*). Mỗi khoản một tài sản: *"bánh 25 tiền mặt nước ngọt 25 momo"*.
- Không nhắc tài sản nào → dùng **tài sản mặc định** (★). Đổi được ở bảng xem trước, hoặc sau này trong *Sửa khoản*.
- **Tạo / sửa:** tên, loại, biểu tượng, số dư, và *"Khi nói, gọi là"* (các cách gọi khác: `tiền mặt, cash`). Tên tài sản luôn được nhận; gõ không dấu (*tien mat*) cũng được.
- **Điều chỉnh số dư:** sửa ô *Số dư hiện tại* khi đếm lại thấy lệch → app ghi phần chênh lệch (xem / xoá trong chi tiết tài sản).
- **⇄ Chuyển tiền giữa tài sản:** rút ATM, nạp Momo, trả thẻ tín dụng — không tính là thu/chi.
- **Thẻ tín dụng:** số dư âm = đang nợ; chi bằng thẻ làm nợ tăng, chuyển tiền trả thẻ làm nợ giảm.
- **Lịch sử** lọc được theo tài sản; **khoản cố định** chọn được tài sản (Netflix → Thẻ tín dụng); xuất CSV có cột *Tài sản*.
- Khoản cũ (trước khi có tài sản) không tính vào số dư nào. Gộp khoản chỉ gộp được các khoản cùng tài sản.
- Ghi lúc đang khoá: app chưa đọc được danh sách tài sản (đã mã hoá) nên nhận diện ngay khi bạn mở khoá.
- Tài sản và các lần chuyển / điều chỉnh được **mã hoá** cùng hồ sơ và đồng bộ qua Google Drive.

**Tài sản khác Ví thế nào?** Ví (chia hũ) là ngân sách theo danh mục, Tài sản là nơi tiền nằm. Một khoản chi *"phở 55 tiền mặt"* vừa trừ ví *Ăn uống*, vừa trừ tài sản *Tiền mặt*.

## Chi hộ bạn bè · được trả lại

Trả tiền giúp bạn bè rồi họ trả lại: app ghi **ai trả, bao nhiêu, về tài sản nào**, và thống kê chỉ tính **chi thực** của bạn.

- **Được trả lại:** *"Tiền mua game đã được anh Lâm trả lại 257k"* → app tìm khoản "Tiền mua game", ghi *↩️ Anh Lâm trả 257k*, chi thực còn 243k, tiền cộng vào tài sản mặc định (nói *"chuyển khoản"*, *"vào momo"* để chọn tài sản). Cũng hiểu *"anh Lâm trả lại tiền lẩu 250k"*, *"hoàn tiền vé phim từ chị Hoa 120k"*.
- Không khớp tên khoản nào → chọn từ danh sách khoản gần đây (khoản đang có người nợ đứng đầu), hoặc *Ghi là khoản thu*.
- **Ghi ai nợ ngay lúc chi:** *"lẩu năm trăm lâm nợ hai trăm rưỡi"*, *"lẩu năm trăm chia đôi với anh Lâm"*, *"pizza ba trăm chia đều với Lâm và Hùng"*. Thẻ **🤝 Người khác nợ bạn** ở tab Hôm nay liệt kê ai còn nợ bao nhiêu; bấm **↩️ Đã trả** (trả vào khoản cũ trước).
- Đã ghi nợ rồi thì chỉ cần nói *"Lâm trả hai trăm rưỡi"* — app tự tìm khoản Lâm đang nợ. ("trả" một mình chỉ tính là hoàn tiền khi người đó có danh xưng như *anh/chị/bạn* hoặc đã từng nợ, để *"trả tiền nhà ba triệu"* vẫn là khoản chi.)
- **Sửa khoản → 🤝 Chi hộ · được trả lại:** thêm / xoá người nợ, lần trả (có nút *Trả đủ*).
- "anh Lâm", "Lâm", "lam" là cùng một người. Tiền trả lại **không phải khoản thu**; Thống kê có dòng *↩️ Được trả lại*.
- Câu hoàn tiền lúc app đang khoá: cần mở khoá (phải đọc các khoản cũ mới biết hoàn cho khoản nào).

## Giảm giá · voucher

- *"pizza ba trăm giảm năm mươi"*, *"trà sữa 60k voucher 20k"*, *"áo 400k giảm 20%"* (hoặc *"giảm hai mươi phần trăm"*) → **số trước là giá gốc**, app ghi số đã trả (250k) kèm *🏷️ giảm 50k (gốc 300k)*.
- Hiểu cả *được giảm, mã giảm giá, khuyến mãi, coupon, sale, chiết khấu, ưu đãi, bớt*.
- Sửa trong **Sửa khoản → 🏷️ Được giảm** (nhập *50k* hoặc *20%*). Thống kê có dòng *🏷️ Tiết kiệm nhờ giảm giá*.
- **Chia nhỏ hoá đơn có giảm giá:** đọc giá gốc từng món như trên hoá đơn (*"bánh 100 nước ngọt 100 rau 100"* cho siêu thị 300k giảm 50k) → app tự trừ giảm giá theo tỉ lệ, mỗi món *→ đã trả 83.333đ*, tổng khớp đúng 250k. Hoá đơn in sẵn giá đã giảm từng món thì bỏ chọn *"Giá các món là giá trước giảm"*.

## Ví nhỏ (chia hũ)

Thẻ **👛 Các ví** ở tab Hôm nay: chia thu nhập vào các ví như ăn uống, tiết kiệm, học phí… rồi nhìn là biết mỗi ví còn bao nhiêu.

- **Tạo ví:** bấm *Dùng mẫu 6 hũ* (Thiết yếu 55%, Tiết kiệm dài hạn 10%, Giáo dục 10%, Hưởng thụ 10%, Tự do tài chính 10%, Cho đi 5%) hoặc *+ Tự tạo ví* (có gợi ý: Ăn uống, Tiết kiệm, Học phí, Nhà & hoá đơn…).
- **Mỗi ví trừ tiền theo danh mục:** ví Ăn uống gồm Ăn uống, Cà phê, Đi chợ… Mỗi danh mục thuộc một ví. Có thể đặt một ví *nhận cả các khoản chi chưa thuộc ví nào*. Ví không gắn danh mục nào là **ví để dành** (chỉ cộng vào).
- **💸 Chia tiền vào ví:** số tiền gợi ý là thu nhập tháng này chưa chia. App chia theo *Mỗi lần chia tiền* của từng ví: `3tr` là số cố định (chia trước), `30%` tính trên phần còn lại. Sửa tay từng ví được, có 🧮.
- **⇄ Chuyển** tiền giữa hai ví (ví dụ lấy từ Hưởng thụ bù cho Giáo dục). Số dư cộng dồn qua các tháng; ví chi quá hiện số âm màu đỏ.
- Lưu một khoản chi xong, thông báo cho biết ví đó còn bao nhiêu. Chạm vào ví để sửa, xem / xoá các lần nạp và chuyển.
- Ví và các lần nạp được **mã hoá** cùng hồ sơ và đồng bộ qua Google Drive.

## Khoản cố định hằng tháng

**Cài đặt → 🔁 Khoản cố định hằng tháng → + Thêm**: Netflix, Disney+, phí giữ xe, tiền nhà… (có gợi ý sẵn; danh mục tự theo tên). Chọn ngày trừ (ngày 29–31 ở tháng ngắn → ngày cuối tháng).

- App tự ghi vào đúng ngày mỗi tháng khi bạn mở app; lỡ vài ngày/tháng thì **ghi bù** đúng ngày. Khoản tự ghi có dấu 🔁.
- Xoá một khoản tự ghi thì nó không bị tạo lại; tạm tắt rồi bật lại thì không ghi bù những tháng đã tắt.
- Dùng nhiều máy: mỗi khoản tự ghi có mã cố định theo "khoản + tháng" nên hai máy không ghi trùng; danh sách khoản cố định cũng đồng bộ qua Google Drive.
- Biểu đồ theo ngày (chế độ *Hằng ngày*) không tính khoản cố định để thấy rõ chi tiêu thường ngày.

## Gộp nhiều khoản thành một hoá đơn

Đi siêu thị/chợ/du lịch mà ghi lắt nhắt nhiều lần → cuối ngày gộp lại: **Lịch sử → ☑️ Gộp khoản** (hoặc nút **☑️ Gộp** ở thẻ *Hôm nay*) → chạm chọn các khoản → **Gộp** → đặt tên ("Siêu thị", "Du lịch Đà Lạt"…; danh mục tự theo tên).

- Mỗi khoản cũ thành một món trong hoá đơn, **giữ danh mục riêng** → thống kê không đổi. Gộp cả hoá đơn đã chia thì lấy từng món của nó.
- Có **Hoàn tác** ngay sau khi gộp. Đồng bộ Google Drive cũng gộp theo trên máy khác.

## Máy tính trong ô số tiền

Mọi ô số tiền (khi ghi, khi sửa, các món khi chia hoá đơn) nhận phép tính: `12 kẹo * 10000`, `12x10k`, `100k - 15k`, `xăng 50 + gửi xe 5`, `(20+5)*2`. Bấm 🧮 để mở bàn phím máy tính (+ − × ÷). Như khi đọc, kết quả dưới 1000 hiểu là nghìn (`12*10` = 120.000đ).

## Thống kê

- **Chi theo danh mục** có 2 tab: **Tỉ lệ** (mặc định) là donut tối đa 6 phần — 5 danh mục lớn nhất + "Khác" gộp phần còn lại, theo khuyến nghị trực quan hoá dữ liệu (nhiều phần hơn thì mắt khó so). Bảng chú giải luôn có icon, % và số tiền; chạm lát hoặc dòng để xem ở giữa. Tab **Danh mục** liệt kê đủ mọi danh mục.
- Chi theo ngày (bỏ/không bỏ tiền nhà & hoá đơn), khoản lớn nhất, mua thường xuyên.

## Chia nhỏ hoá đơn

Ở siêu thị chỉ cần nói *"siêu thị một trăm"*. Về nhà chạm vào khoản đó → **✂️ Chia nhỏ hoá đơn** → nói (🎤) hoặc gõ *"bánh 25 nước ngọt 25 rau 25"*:

```
Siêu thị 100.000đ  (Đi chợ & siêu thị)
 ├─ Bánh       25.000đ → Ăn uống
 ├─ Nước ngọt  25.000đ → Cà phê & đồ uống
 ├─ Rau        25.000đ → Đi chợ & siêu thị
 └─ Còn lại    25.000đ → Đi chợ & siêu thị (danh mục của hoá đơn)
```

- Mỗi món tự đoán danh mục theo từ khoá; món không đoán được thì theo danh mục của hoá đơn. Đổi được từng món.
- **Thống kê theo danh mục, biểu đồ theo ngày và "mua thường xuyên" tính theo từng món**, phần chưa chia tính vào danh mục của hoá đơn. Lịch sử vẫn hiện hoá đơn là một khoản, kèm dòng tóm tắt các món.
- Lọc lịch sử theo danh mục sẽ ra cả hoá đơn có món thuộc danh mục đó, và chỉ cộng phần của danh mục đó. Tìm kiếm tìm cả tên món.
- Các món cộng lại không được vượt tổng; app chặn lưu và gợi ý "Đặt tổng = …".
- Xuất CSV: mỗi món một dòng, cột *Hoá đơn* cho biết thuộc khoản nào.

## Bảo mật

Lần đầu mở app, bạn tạo một mật khẩu (ít nhất 8 ký tự). Từ đó **mọi thứ ghi xuống trình duyệt đều là bản mã**:

| Lưu trong trình duyệt | Dạng |
|---|---|
| Từng khoản chi / thu (tên, số tiền, ngày, câu nói gốc) | AES-256-GCM, mỗi khoản một IV ngẫu nhiên, gắn với id để không tráo được |
| Danh mục tự thêm, từ khoá, phần đã học | AES-256-GCM |
| Khoản ghi lúc đang khoá (hộp chờ) | ECIES: ECDH P-256 + HKDF + AES-256-GCM |
| Muối, khoá đã bọc, khoá công khai | dạng thường (không lộ gì nếu không có mật khẩu) |
| Cài đặt tiếng lóng / tự lưu / thời gian tự khoá | dạng thường (không nhạy cảm) |

Cách hoạt động ([js/vault.js](js/vault.js)):

```
mật khẩu ──PBKDF2-SHA256, 600.000 vòng──► khoá bọc (không bao giờ lưu)
   ├─ bọc ─► khoá dữ liệu AES-256 ngẫu nhiên ─► mã hoá từng khoản
   └─ bọc ─► khoá riêng ECDH ─► mở hộp chờ
khoá công khai ECDH (để dạng thường) ─► ghi khoản mới khi đang khoá
```

- **Đang khoá vẫn ghi bằng giọng nói được.** Khoản mới được mã hoá một chiều bằng khoá công khai; chỉ khi nhập mật khẩu mới đọc được và được gộp vào sổ.
- Khoá chỉ nằm trong bộ nhớ khi app đang mở và **tự khoá** khi bạn rời app quá thời gian chọn trong Cài đặt (mặc định 5 phút). Khi khoá, dữ liệu đã giải mã bị xoá khỏi bộ nhớ và màn hình.
- Bàn phím tiếng Việt gõ dấu kiểu dựng sẵn hay tổ hợp đều ra cùng một mật khẩu (chuẩn hoá NFC).
- Chính sách CSP chỉ cho chạy script của chính app, cộng đúng thư viện đăng nhập của Google (`accounts.google.com/gsi/client`) — thư viện này chỉ được tải khi bạn dùng đồng bộ Google Drive.
- Các form không bao giờ tự gửi đi (kể cả khi bấm lúc app chưa tải xong), nên mật khẩu không thể lọt lên thanh địa chỉ.

**Vì sao cần mã hoá dù dữ liệu chỉ nằm trên máy:** mọi trang GitHub Pages của cùng một tài khoản (`daydreamersy.github.io/...`) dùng **chung một origin**, nên trang khác của bạn (hoặc code bị chèn vào trang đó) đọc được IndexedDB của Coin Manager. Mã hoá khiến thứ đọc được chỉ là bản mã.

**Giới hạn — hãy biết trước:**

- **Quên mật khẩu là mất dữ liệu.** Không có cửa sau.
- Mã hoá không chống được kẻ đã chiếm được chính trang này (sửa code trong repo, hoặc một service worker ở gốc `daydreamersy.github.io` nếu sau này bạn tạo repo `DaydreamerSY.github.io`). Giữ tài khoản GitHub có 2FA.
- Mật khẩu yếu có thể bị dò nếu ai đó lấy được bản mã. App chặn mật khẩu < 8 ký tự và dãy số ngắn; một câu ngắn chỉ bạn biết là tốt nhất.
- Số lượng khoản và kích thước xấp xỉ mỗi khoản vẫn nhìn thấy được (nội dung thì không).
- Đổi mật khẩu chỉ bọc lại khoá: **bản sao lưu cũ vẫn mở được bằng mật khẩu cũ**.

## Đồng bộ Google Drive (nhiều thiết bị)

**Cài đặt → ☁️ Đồng bộ Google Drive → Đồng bộ ngay.** Lần đầu đăng nhập Google và cho phép app lưu vào Drive.

- App chỉ dùng **thư mục ẩn riêng của app** trên Drive (quyền `drive.appdata`) — không thấy trong Drive của bạn, không đụng tới file nào khác — và chỉ ghi **một file bản sao lưu đã mã hoá**. Google không đọc được nội dung.
- **Thêm máy mới:** mở app → *Lấy dữ liệu từ Google Drive* → mở khoá bằng cùng mật khẩu. Nếu máy đó lỡ tạo mật khẩu riêng rồi, bấm đồng bộ sẽ hỏi mật khẩu của dữ liệu trên Drive, gộp lại, và từ đó máy đó dùng chung mật khẩu.
- **Gộp:** cùng một khoản thì bản sửa sau cùng thắng; khoản xoá ở máy này cũng bị xoá ở máy kia (app lưu "dấu xoá" đã mã hoá). Đổi mật khẩu ở một máy → máy kia nhận mật khẩu mới ở lần đồng bộ sau.
- **App cài trên màn hình chính (Android):** cửa sổ đăng nhập Google mở ra tab Chrome riêng và không liên lạc được với app, nên app dùng trang chuyển tiếp `oauth.html` — đăng nhập xong quay lại app là đồng bộ tự chạy tiếp. Cần khai báo `https://daydreamersy.github.io/Coin-Manager/oauth.html` trong *Authorized redirect URIs* của OAuth client. Mở trong trình duyệt thì dùng thư viện Google như bình thường.
- **Tự đồng bộ khi mở khoá** (tối đa 6 giờ một lần). Không có máy chủ nên quyền Google chỉ sống ~1 giờ và phải có một lần bấm để xin lại — khi mở khoá có thể chớp một cửa sổ Google rồi tự đóng.
- Ngắt kết nối: *Ngắt kết nối* trong Cài đặt. Muốn xoá hẳn dữ liệu trên Drive: Google Drive → Cài đặt → Quản lý ứng dụng.

## Sao lưu

Dữ liệu chỉ nằm trong Chrome trên điện thoại. Xoá dữ liệu Chrome hoặc gỡ app là mất. Vào **Cài đặt → Sao lưu (đã mã hoá)** định kỳ (app hiện số ngày kể từ lần sao lưu gần nhất).

- File sao lưu **vẫn là bản mã**; mở bằng mật khẩu lúc sao lưu.
- **Đổi điện thoại:** mở app trên máy mới → *Khôi phục từ bản sao lưu* ngay ở màn tạo mật khẩu → mở khoá bằng mật khẩu cũ.
- Nhập file từ một kho khoá khác (mật khẩu khác): app hỏi mật khẩu của file rồi mã hoá lại bằng khoá hiện tại.
- **Xuất Excel (CSV)** để mở bằng Excel / Google Sheets — file này **không mã hoá**, app sẽ hỏi lại trước khi xuất.

## Cài lên điện thoại

Mở <https://daydreamersy.github.io/Coin-Manager/> bằng Chrome → menu ⋮ → *Thêm vào màn hình chính* / *Cài đặt ứng dụng*. Lần đầu bấm micro, Chrome sẽ hỏi quyền dùng micro.

Dùng như app điện thoại: nút **Back** đóng hộp thoại / bảng ghi nhanh / chế độ chọn để gộp (không thoát app); các bảng trượt từ dưới lên **vuốt xuống để đóng**.

**Cập nhật:** `git push` lên nhánh `main`. App trên điện thoại tải bản mới ở nền, **lần mở kế tiếp** sẽ dùng bản mới.

## Chạy thử trên máy tính

```bash
python -m http.server 8765
```

- App: <http://localhost:8765/>. Nhận giọng nói chạy trong Chrome trên máy tính; ô gõ tay dùng chung bộ phân tích.
- Ở `localhost` app **không bật chế độ offline** để luôn thấy code mới; thêm `?sw` vào URL nếu muốn thử offline.
- Test: <http://localhost:8765/tests/> — bộ phân tích câu nói + mã hoá. Tiêu đề tab hiện `PASS n/n` hoặc `FAIL`.

## Cấu trúc

```
index.html             giao diện (tạo mật khẩu, mở khoá, 4 tab: Ghi, Lịch sử, Thống kê, Cài đặt)
js/parser.js           đọc số tiền tiếng Việt + tách nhiều khoản trong một câu
js/categories.js       danh mục, từ khoá, phân loại + ghi nhớ
js/vault.js            mã hoá: PBKDF2, AES-GCM, ECIES (Web Crypto, không thư viện)
js/store.js            lưu trữ đã mã hoá, hộp chờ, sao lưu
js/sync.js             gộp dữ liệu giữa các máy (bản sửa sau thắng, dấu xoá)
js/gdrive.js           đăng nhập Google + thư mục ẩn của app trên Drive
js/db.js               IndexedDB thô
js/app.js              điều khiển giao diện, khoá/mở khoá, thống kê
js/voice.js            Web Speech API (vi-VN)
js/charts.js           biểu đồ cột theo ngày, donut tỉ lệ (SVG, không thư viện)
js/recurring.js        khoản cố định hằng tháng (tính ngày tới hạn, ghi bù)
js/wallets.js          ví nhỏ / chia hũ (số dư, gợi ý chia tiền theo tỉ lệ)
js/assets.js           tài sản (nhận diện "tiền mặt", "bằng momo" trong câu nói, số dư, chuyển / điều chỉnh)
js/refunds.js          chi hộ bạn bè: ai nợ, ai trả lại ("đã được anh Lâm trả lại 257k"), chi thực
js/discounts.js        giảm giá / voucher ("pizza 300 giảm 50", "giảm 20%")
js/datepicker.js       lịch chọn ngày theo theme
js/sheets.js           nút Back đóng hộp thoại, vuốt xuống để đóng bảng
js/strips.js           cuộn hàng Ví / Tài sản bằng chuột trên máy tính (lăn chuột, nhấn giữ kéo)
icons/duck*.svg        linh vật vịt (vẽ tay bằng SVG)
fonts/                 Nunito (SIL OFL 1.1, xem fonts/OFL.txt) — tự host, không tải từ Google
sw.js                  chạy offline
tests/                 test (mở bằng trình duyệt)
```

## Hướng phát triển

- Đồng bộ điện thoại ↔ máy tính (Tailscale hoặc file sao lưu) để xem dashboard trên PC.
- Báo cáo cuối tháng bằng AI chạy trên máy: `gemma3:12b` qua Ollama (thử 10/10 câu tiếng lóng đúng; `qwen3:8b` chỉ 7/10 và có lần đọc "15 ca" thành 15 triệu). Nguyên tắc: code tính số, AI chỉ viết nhận xét.
