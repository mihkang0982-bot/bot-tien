# DAQ (Discord Auto Quest) Mobile

Ứng dụng React Native (Expo) giúp tự động hoàn thành và claim Discord Quests trên Android.

## Tính năng chính
- Chạy nhiều session (nhiều token) tuần tự; chọn từng session để xem quest/log.
- Start/Stop trên session đang chọn; auto-claim; hiển thị Orbs.
- Background fetch (tùy OS) đánh thức định kỳ để xử lý quest.
- Cảnh báo ToS, liên kết nguồn:
  - Official: https://github.com/Nguoibianhz/Discord-Auto-Quests
  - Android:  https://github.com/ducknogit/discord-auto-quests-mobile

## Yêu cầu
- Node ≥ 18
- Expo CLI / Expo Go (test nhanh)
- EAS (build APK)

## Chạy thử nhanh
```bash
cd mobile
npm install
npm start   # mở bằng Expo Go hoặc web
```

## Build APK (EAS)
```bash
npm ci
eas build -p android --profile preview
```

## Lưu ý
- Sử dụng user token có thể vi phạm ToS của Discord; bạn tự chịu trách nhiệm.
- Nền tảng background fetch phụ thuộc OS, không đảm bảo chạy liên tục như foreground.
