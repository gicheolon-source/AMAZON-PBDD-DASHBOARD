# 2026 PBDD 대시보드 (Google Sheet → Vercel)

구글시트 `2026 PBDD`의 플랜/실시간 시트를 서버리스 함수가 읽어서 목표 대비 달성률·예상 매출을 보여줍니다.

## 구조
- `public/index.html` — 대시보드 화면 (5분마다 `/api/data` 자동 갱신)
- `api/data.js` — 구글시트 CSV를 읽어 JSON으로 가공 (CDN 캐시 5분)

## 사전 조건
구글시트 공유 설정이 **"링크가 있는 모든 사용자 → 뷰어"** 여야 합니다. (API 키 없이 읽습니다)
회사 계정 전용으로 잠가야 하면 `api/data.js`에 서비스계정 방식으로 바꿔야 합니다.

## 자동배포 세팅 (GitHub → Vercel)
1. 이 폴더를 GitHub 저장소로 올립니다.
   ```bash
   git init && git add . && git commit -m "PBDD dashboard"
   git branch -M main
   git remote add origin https://github.com/<계정>/pbdd-dashboard.git
   git push -u origin main
   ```
2. https://vercel.com/new → 방금 올린 저장소 Import → Framework는 "Other" 그대로 → Deploy.
3. 이후 `main`에 push할 때마다 자동 재배포됩니다. PR을 열면 프리뷰 URL이 따로 생깁니다.

## 설정값
- 시트 ID를 바꾸려면 Vercel 프로젝트 Settings → Environment Variables에 `SHEET_ID` 추가.
- 국가별 이벤트 시작/종료 시각(KST)은 `api/data.js`의 `COUNTRIES`에서 수정.
- 호주는 실시간 시트 A3의 자체 목표를 쓰고, 나머지는 `PBDD 플랜 › 최종 목표` 표(44~52행)를 읽습니다. 표 위치가 바뀌면 `PLAN_ROWS`도 맞춰주세요.

## 로컬 확인
```bash
npm i -g vercel
vercel dev
```
