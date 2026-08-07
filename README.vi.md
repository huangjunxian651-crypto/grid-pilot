# GridPilot

> Nền tảng giao dịch **lưới động (dynamic grid)** cho hợp đồng vĩnh cửu ETH/USDT · Tương thích Binance / Gate.io / OKX

**Robot lưới có sẵn của sàn là sản phẩm của một thời đã qua.**

Nó treo cả dàn lệnh lên sổ lệnh rồi mặc kệ — vào lệnh chẳng hỏi giá, cắt lỗ một nhát sạch sành sanh, giá nhảy gap thì chỉ ăn được cái giá chết ngay trên đường lưới. GridPilot là một trader túc trực bảng giá 24/7: **mỗi nhịp giá đập, nó lại đánh giá lại xem có nên ra tay không, và ra tay ở giá nào.**

[简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [Español](README.es.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md) · [한국어](README.ko.md) · [ไทย](README.th.md) · **Tiếng Việt**

---

## 📸 Xem trước giao diện

| Bảng điều khiển · Tổng quan | Phí & Hoàn phí |
|:---:|:---:|
| ![Bảng điều khiển GridPilot](docs/screenshots/vi/dashboard.png) | ![Phí & Hoàn phí](docs/screenshots/vi/fees.png) |

> Chủ đề thương hiệu xanh lam đậm · Phông chữ Space Grotesk / IBM Plex · Tích hợp sẵn 12 ngôn ngữ, giao diện đổi theo ngôn ngữ.

## 🎯 Tại sao chọn giao dịch lưới?

Giao dịch lưới chia một khoảng giá thành nhiều "đường lưới": giá giảm mỗi nấc thì mua, giá tăng mỗi nấc thì bán — **mua thấp bán cao lặp đi lặp lại trong thị trường đi ngang, biến chính sự dao động thành lợi nhuận**. Nó không dự đoán tăng giảm, chỉ kiếm chênh lệch từ các dao động qua lại trong khoảng giá, vì vậy đặc biệt phù hợp với thị trường không có xu hướng rõ ràng, lên xuống dập dềnh.

So với "mua và giữ": mua và giữ chỉ có lãi khi cuối cùng giá tăng; còn lưới tích lũy liên tục từng khoản lợi nhuận nhỏ trong giai đoạn đi ngang. Cái giá phải trả là cần quản lý lệnh liên tục và kiểm soát rủi ro — đây chính là phần mà GridPilot tự động hóa thay bạn.

> ⚠️ Giao dịch lưới không phải lúc nào cũng có lãi: khi giá giảm một chiều vẫn sẽ lỗ tạm tính, và đòn bẩy sẽ khuếch đại rủi ro. Hãy hiểu rõ chiến lược trước khi xuống tiền.

## 🤔 Trước khi chơi lưới, hãy tự hỏi mình năm câu này

**Giá vẫn đang rơi, sao lưới của bạn lại vội chất đầy vị thế ngay trên đỉnh?**
Lưới gốc cứ giá bước vào khoảng là mở vị thế ngay. GridPilot **vào lệnh theo dõi (trailing entry)**: bám đáy trước, chờ hồi phục 0.2% xác nhận đã vững mới vào lệnh — không hứng dao rơi, không đứng đỉnh. (Chỉ theo dõi khi giá bước vào cửa sổ kích hoạt theo hướng thua lỗ; nếu giá từ sâu hơn quay trở lại khoảng theo hướng chốt lời thì bỏ qua theo dõi và chạy trực tiếp.)

**Thị trường đổi từng giây, sao lệnh của bạn treo lên rồi nằm im?**
GridPilot ra quyết định lại mỗi lần giá cập nhật: cần hủy thì hủy, cần sửa thì sửa, có những thời điểm trên sổ lệnh chẳng có lệnh nào; giá thuận lợi thì bám sổ lệnh chốt giá tối ưu, giá bất lợi thà ngắt mạch từ chối lệnh, treo được Maker (0.02%) thì tuyệt đối không nộp phí Taker (0.05%) oan uổng. Việc bám giá này không có rủi ro giảm giá: nếu giá tiếp tục rơi qua giá lưới, hệ thống bám theo và mua được giá rẻ hơn nữa; nếu giá hồi lại mà chưa phá vỡ đường trên, lệnh vẫn có thể khớp ở giá gốc — theo mô hình phá sản của con bạc (gambler's ruin) chuẩn, xác suất thực sự lỡ khớp lệnh là rất nhỏ — lợi nhuận thêm là nhặt được, không nhặt được cũng chẳng lỗ.

**Giá nhảy một phát 5–10 USDT, lưới của bạn ngoài đứng nhìn ra còn làm được gì?**
Lệnh tĩnh chỉ ăn được cái giá chết trên đường lưới. GridPilot chủ động ăn lệnh khi giá lệch khỏi giá lý thuyết của lưới vượt ngưỡng (mặc định 0.1% ≈ 2× phí Taker, có thể điều chỉnh), khóa luôn phần chênh lệch vượt bước lưới vào túi — đo thực tế cho thấy sàn nào sổ lệnh càng "xù xì" thì lợi nhuận vượt mức càng cao.

**Chỉ mới thủng nhẹ thoáng qua, sao phải xả toàn bộ vị thế bằng một lệnh thị trường?**
Xả một nhát vừa tốn phí Taker, vừa đánh mất cú hồi. GridPilot **giảm vị thế từng nấc bằng lệnh giới hạn** trong vùng đệm cắt lỗ; giá hồi lại, phần vị thế còn lại tiếp tục kiếm tiền ngay. Chỉ khi thủng đường thanh lý, lệnh điều kiện chốt chặn cuối cùng mới tiếp quản một lần.

**Giá chạy ra khỏi khoảng từ lâu, sao lưới của bạn vẫn quay không tại chỗ?**
GridPilot cấu hình sẵn nhiều khoảng giá không chồng lấn, giá bước vào khoảng nào thì kích hoạt khoảng đó; sau khi cắt lỗ sẽ vào "thời gian nguội" (cooldown), đợi xuất hiện lại tín hiệu vững giá mới bắt đầu vào lệnh theo dõi lần nữa.

## 📊 Đọ sức trực diện với lưới gốc của sàn

| Khía cạnh | Lưới gốc của sàn | GridPilot |
|------|----------------|-----------|
| **Cách ra quyết định** | Đặt lệnh tĩnh hàng loạt, treo xong không nhúc nhích | Tự động theo bảng giá: mỗi lần giá cập nhật đều đánh giá lại rồi mới đặt/sửa/hủy lệnh động, không phải lúc nào cũng có lệnh treo |
| **Chất lượng khớp lệnh** | Lệnh tĩnh chỉ ăn được giá trên đường lưới, chênh lệch vượt mức khi giá nhảy vọt trôi qua trước mắt | Bám sổ lệnh chốt giá tối ưu, giá khớp không tệ hơn giá lý thuyết; giá lệch khỏi giá lý thuyết vượt ngưỡng (mặc định ≈2× phí) thì chủ động ăn lệnh khóa lợi nhuận vượt mức; giá bất lợi ngắt mạch từ chối lệnh |
| **Thời điểm vào lệnh** | Vào khoảng giá là mở vị thế ngay | Vào lệnh theo dõi: khi giá bước vào theo hướng thua lỗ thì bám đáy, chỉ mở vị thế sau khi xác nhận hồi phục (mặc định 0.2%) |
| **Cắt lỗ** | Xả toàn bộ bằng lệnh thị trường một lần tại một mức giá duy nhất | Vùng đệm cắt lỗ giảm vị thế từng nấc bằng lệnh giới hạn, giá hồi thì phần vị thế còn lại hưởng lợi trực tiếp; đường thanh lý giữ một lệnh điều kiện chốt chặn |
| **Thích ứng thị trường** | Một khoảng giá cố định | Nhiều khoảng giá không chồng lấn, giá vào khoảng nào kích hoạt khoảng đó, các khoảng còn lại ngủ đông |

> Giải thích đầy đủ từng đổi mới so với lưới của sàn xem tại [`docs/INNOVATIONS.en.md`](docs/INNOVATIONS.en.md); nguyên lý chiến lược đầy đủ xem tại [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md).

## ✨ Tổng quan tính năng

- **Tự lành không phụ thuộc trạng thái**: vị thế mục tiêu = f(giá hiện tại), sau sập / mất mạng / tự tay đổi vị thế, khởi động lại tự động chỉnh về đúng
- **Đẩy dữ liệu WebSocket thời gian thực**: sự kiện Ticker / khớp lệnh / máy trạng thái đồng bộ thời gian thực lên frontend
- **Hỗ trợ đa sàn**: giao diện adapter thống nhất, tương thích Binance, Gate.io, OKX
- **AI gợi ý cấu hình khung giá**: đề xuất khoảng giá và tham số ngoại tuyến, không can thiệp quyết định giao dịch thời gian thực
- **Giao diện đa ngôn ngữ**: tích hợp sẵn 12 ngôn ngữ

## 💰 Hiểu rõ phí, dùng mã mời để tiết kiệm khi đăng ký (nhà tài trợ rebateto.me)

Phí giao dịch do sàn thu, **GridPilot không lấy một xu nào**. Cùng một giao dịch, lệnh treo (Maker) ≈0.02%, lệnh ăn (Taker) ≈0.05%. Các lệnh lưới thường ngày của cả hai bên thực ra đều đi theo Maker, không có chênh lệch phí ở khớp lệnh lưới thường ngày; lợi thế phí của GridPilot nằm ở ba thời điểm then chốt — ① vào lệnh: chờ hồi phục xác nhận rồi mới treo lệnh vào, thay vì mở lệnh thị trường ngay khi vừa vào khoảng; ② cắt lỗ: giảm vị thế từng nấc bằng lệnh giới hạn, thay vì xả toàn bộ bằng một lệnh thị trường; ③ ăn lệnh: chỉ cho phép đi Taker khi chênh lệch vượt mức thực sự lớn hơn phí.

Hơn nữa: **khi đăng ký sàn điền một mã hoàn phí, bạn có thể được hoàn lại lâu dài khoảng 20% (Gate 40%) phí đã trả, tự động vào tài khoản** — coi như được giảm giá thêm cho mỗi giao dịch.

> ⚠️ Mỗi sàn chỉ đăng ký được một lần, hoàn phí chỉ có thể gắn vào lúc đăng ký, **tài khoản cũ không thể bổ sung — đây là cơ hội duy nhất**.

**Nhà tài trợ [rebateto.me](https://rebateto.me)** tổng hợp và duy trì các cổng đăng ký hoàn phí của từng sàn. Khi đăng ký vui lòng dùng mã mời:

| Sàn giao dịch | Mã mời | Tỷ lệ hoàn phí |
|--------|--------|----------|
| Binance | `fanwo20` | 20% |
| OKX | `fangeiwo` | 20% |
| Gate.io | `fangeiwo` | 40% |

> Khi đăng ký bằng App nhớ điền thủ công mã mời — bỏ sót là không nhận được hoàn phí. Mỗi căn cước chỉ mở được một tài khoản trên mỗi sàn.

## 📦 Cài đặt

**Yêu cầu trước**: Node.js ≥ 20, pnpm ≥ 9, Docker

### Cách 1: Docker dựng toàn bộ stack một lệnh (khuyến nghị tự triển khai)

```bash
git clone https://github.com/QuantiaAI/grid-pilot.git && cd grid-pilot
cp .env.example .env
# Tạo khóa mã hóa và điền vào ENCRYPTION_KEY trong .env
openssl rand -base64 32
# Khởi chạy PostgreSQL + Redis + API + Web bằng một lệnh (tự động chạy migration)
docker compose --profile full up --build -d
```

Sau khi khởi động, truy cập http://localhost:3300 .

> Khi không kèm `--profile full`, `docker compose up` chỉ khởi động hạ tầng PostgreSQL + Redis để phục vụ phát triển cục bộ.

### Cách 2: Cài đặt cục bộ (khuyến nghị cho phát triển)

```bash
git clone https://github.com/QuantiaAI/grid-pilot.git && cd grid-pilot
pnpm install
cp .env.example .env        # điều chỉnh cổng nếu cần; đặt ENCRYPTION_KEY bằng kết quả của openssl rand -base64 32
pnpm --filter @gridpilot/api exec prisma generate       # tạo Prisma Client (postinstall đã bị tắt — bước này bắt buộc)
pnpm dev:infra              # khởi động PostgreSQL + Redis
pnpm exec dotenv -e .env -- pnpm --filter @gridpilot/api exec prisma migrate deploy # chỉ lần cài đầu tiên: áp dụng các migration của cơ sở dữ liệu
pnpm dev:skip-infra         # khởi động API + Web
```

> Các bước `prisma generate` / `migrate deploy` chỉ cần chạy một lần ở lần cài đặt đầu tiên; sau đó chỉ cần `pnpm dev` để khởi động mọi thứ.

| Dịch vụ | Địa chỉ | Tùy chọn cấu hình |
|------|------|--------|
| Frontend | http://localhost:3300 | `WEB_PORT` / `WEB_HOST` |
| API backend | http://localhost:3301 | `API_PORT` / `API_HOST` |
| PostgreSQL | localhost:25432 | `DB_PORT` |
| Redis | localhost:26379 | `REDIS_PORT` |

Khởi động riêng lẻ:

```bash
pnpm dev:infra        # chỉ PostgreSQL + Redis
pnpm dev:api          # chỉ backend
pnpm dev:web          # chỉ frontend
pnpm dev:skip-infra   # API + Web, bỏ qua docker
```

## 🕹️ Hướng dẫn sử dụng

1. **Kết nối sàn giao dịch**: điền API Key/Secret trong phần cài đặt. **Chỉ cấp quyền giao dịch hợp đồng, tuyệt đối không bật quyền rút tiền.**
2. **Cấu hình lưới**: chọn cặp giao dịch và hướng (long/short), thiết lập mỏ neo giá chốt lời, số ô/bước lưới chính, số lượng mỗi ô, đòn bẩy, đệm cắt lỗ, tham số vào lệnh theo dõi (biên của hộp được suy ra tự động từ mỏ neo giá chốt lời + số ô và bước lưới).
3. **Khởi động robot**: vào vào lệnh theo dõi → chạy, frontend hiển thị thời gian thực giá, lệnh treo, khớp lệnh và máy trạng thái.
4. **Giám sát và thu dọn**: khi giá chạm đầu chốt lời, lưới chốt từng nấc và thu dọn tự nhiên, sau khi vị thế về không thì thoát chốt lời; rơi vào vùng đệm cắt lỗ thì giảm vị thế từng nấc một cách động.

Tham số then chốt:

| Tham số | Diễn giải |
|------|------|
| `takeProfitPrice` | Giá chốt lời (biên chốt lời của hộp) |
| `direction` | Hướng: LONG (mua lên) / SHORT (bán xuống) |
| `mainGridCount` / `mainGridStep` | Số ô lưới chính / bước mỗi ô (USDT) |
| `mainGridPortionSize` | Số lượng đặt lệnh mỗi ô |
| `leverage` | Hệ số đòn bẩy |
| `stopLossGridCount` / `stopLossGridStep` | Số ô vùng đệm cắt lỗ / bước lưới |
| `isolationStep` | Độ rộng dải cách ly (mặc định = bước lưới vùng cắt lỗ) |
| `activationPrice` / `trailingCallbackRate` | Giá kích hoạt khoảng (mặc định điểm giữa lưới chính) / biên độ hồi của vào lệnh theo dõi |
| `excessProfitMultiplier` | Hệ số kích hoạt vùng GTC (ngưỡng lợi nhuận vượt mức) |

Tham số đầy đủ xem tại [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md).

## ⚠️ Lưu ý

- **Miễn trừ rủi ro**: giao dịch hợp đồng có đòn bẩy cao, rủi ro cao, có thể dẫn đến mất toàn bộ vốn gốc. Dự án này là công cụ giao dịch mã nguồn mở, **không cấu thành bất kỳ lời khuyên đầu tư nào**, không chịu trách nhiệm về lãi lỗ. Hãy kiểm chứng đầy đủ với số vốn nhỏ hoặc testnet của sàn trước.
- **Quyền API**: chỉ bật quyền giao dịch hợp đồng, **đừng** bật quyền rút tiền.
- **Ràng buộc một runner**: cùng một cặp giao dịch trên cùng một tài khoản sàn, tại cùng một thời điểm chỉ có thể chạy một robot.
- **Thời điểm hoàn phí**: mã mời chỉ có thể gắn vào lúc đăng ký, tài khoản cũ không thể bổ sung.
- **An toàn khóa bí mật**: `ENCRYPTION_KEY` dùng để mã hóa thông tin xác thực của sàn, nhất định phải dùng khóa mạnh sinh ngẫu nhiên và bảo quản cẩn thận.
- **Xung đột cổng**: nếu cổng 3300/3301 cục bộ bị `pnpm dev` chiếm dụng sẽ xung đột với container Docker toàn stack, hãy dừng tiến trình cục bộ trước rồi mới khởi động container, hoặc sửa cấu hình cổng trong `.env`.

## 🏗️ Ngăn xếp công nghệ & Kiến trúc

| Tầng | Công nghệ |
|------|------|
| Frontend | Next.js 16 · React 19 · Tailwind CSS v4 · Zustand · React Query · Recharts |
| Backend | NestJS 10 · Prisma 5 · BullMQ · Socket.IO |
| Hạ tầng | PostgreSQL 16 · Redis 7 · Docker Compose |
| Dùng chung | TypeScript · pnpm Workspaces · Turborepo |

```
apps/web/          # Next.js frontend (giao diện tối, 12 ngôn ngữ)
apps/api/          # NestJS backend
packages/shared-types/  # kiểu dùng chung giữa frontend và backend
docs/              # STRATEGY_SPEC.md (đặc tả chiến lược) · ARCHITECTURE.md (ánh xạ thành phần)
docker-compose.yml # hạ tầng mặc định; --profile full cho toàn stack
```

**Máy trạng thái chiến lược**: `TRAILING_ENTRY → RUNNING → LIQUIDATING → LIQUIDATED`, `RUNNING` có thể rẽ nhánh sang `TAKE_PROFIT`; nhánh vận hành gồm `PAUSED` (có thể `USER_RESUME` để khôi phục), `CANCELLED`, `HOLD`.

**Lệnh phát triển**:

```bash
pnpm dev          # khởi động tất cả dịch vụ bằng một lệnh
pnpm build        # build
pnpm test         # kiểm thử
pnpm lint         # Lint
```

**Cơ sở dữ liệu** (phát triển cục bộ):

```bash
cd apps/api
pnpm prisma migrate dev    # chạy migration
pnpm prisma studio         # xem dữ liệu
```

## Mục lục tài liệu

| Tài liệu | Diễn giải |
|------|------|
| [`docs/INNOVATIONS.en.md`](docs/INNOVATIONS.en.md) | Giải thích đầy đủ các đổi mới cốt lõi (so sánh từng điểm với lưới gốc của sàn) |
| [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md) | Tài liệu đặc tả chiến lược đầy đủ (tham chiếu chuẩn) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Chỉ mục ánh xạ từ thành phần mã nguồn tới chương đặc tả |
| [`docs/fees-and-funding.md`](docs/fees-and-funding.md) | Giải thích phí giao dịch và phí vốn (funding) |
