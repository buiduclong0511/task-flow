# TaskFlow — Time Tracker

Time tracking app dành cho các workflow bị gián đoạn. Quản lý task theo kiểu stack: khi có task mới đến, task hiện tại tự động pause và đẩy vào pending stack.

## Tính năng

- **Task tracking**: Thêm, pause, resume, hoàn thành task
- **Stack-based workflow**: Task mới tự động pause task đang chạy
- **Priority levels**: High / Medium / Low
- **Real-time timer**: Đếm thời gian chính xác cho mỗi task
- **Google Auth**: Đăng nhập bằng tài khoản Google
- **Firebase Firestore sync**: Đồng bộ tasks real-time trên mọi thiết bị
- **Offline support**: localStorage cache, hoạt động khi mất mạng

## Tech Stack

- Single HTML file (vanilla JS, no framework)
- Firebase Authentication (Google Sign-In)
- Cloud Firestore (real-time sync)
- JetBrains Mono + Syne fonts
- Dark theme with grid background

## Cài đặt

### 1. Clone repo

```bash
git clone git@github.com:buiduclong0511/task-flow.git
cd task-flow
```

### 2. Chạy local server

```bash
npx serve .
```

Hoặc:

```bash
python3 -m http.server 8080
```

Mở `http://localhost:8080` trên trình duyệt.

### 3. Firebase setup

1. Vào [Firebase Console](https://console.firebase.google.com) > chọn project
2. **Authentication** > **Sign-in method** > Bật **Google**
3. **Firestore Database** > Tạo database > Thêm security rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Cấu trúc dữ liệu Firestore

```
users/{uid}
  ├── tasks: [{ id, name, priority, status, elapsed, startedAt, createdAt, completedAt }]
  ├── activeId: string | null
  └── updatedAt: timestamp
```

## License

MIT
