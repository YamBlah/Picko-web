# Picko Web

Picko 탑승자용 모바일 웹. 운전자가 공유한 SMS 링크를 열면 실시간으로 차량 위치를 보고 자기 위치를 공유할 수 있음.

## 구성
- `index.html` — 레이아웃 (지도 + 바텀시트)
- `style.css` — Pretendard 폰트, PICKO 디자인 토큰
- `app.js` — 세션 로드, 카카오맵, WebSocket, Geolocation, 바텀시트 드래그
- `assets/` — SVG 마커, 범례, 재센터, OG 이미지

## 개발
정적 파일만으로 돌아감. 실제 기능은 서버(`picko-server`)에 연결돼야 동작.

```bash
# 로컬 서버 띄우기 (지도만 미리보기용)
python3 -m http.server 5173
```
→ `http://localhost:5173` 접속 (세션 없이는 "링크 만료" 화면만 뜸)

## 배포
`picko-server` 의 `src/main/resources/static/` 에 복사되어 Spring Boot 가 서빙.
수정 시 그쪽에도 동기화 필요.

## 기술
- 카카오맵 JavaScript SDK
- WebSocket (raw)
- Geolocation API
- Pretendard Variable (CDN)
