蕉流 Freediving｜Vercel 正式部署檔

資料夾結構
- index.html            蕉流 Freediving 首頁（含「國外潛旅 → 宮古島」選單）
- assets/               蕉流首頁使用的圖片
- miyako/index.html     最新版 MIYAKO BLUE 宮古島獨立頁面
- miyako/assets/        宮古島頁面使用的 9 張圖片
- vercel.json           Vercel 靜態路由設定

部署方式（保留現有正式專案）
1. 解壓縮本 ZIP，進入 bananaflow-vercel-production 資料夾。
2. 使用 Vercel CLI 登入：vercel login
3. 首次連結時執行：vercel link
   選擇你原本的 bananaflow-freediving 專案，不要建立新的專案。
4. 確認連結正確後，正式發布：vercel --prod

此網站是純 HTML/CSS/JavaScript 靜態網站，不需要 npm install、build command 或框架。
Vercel 專案的 Root Directory 請設為此資料夾根目錄；Framework Preset 選 Other；Build Command 留空；Output Directory 使用預設根目錄（或留空）。

發布後網址預期為：
- 首頁：https://bananaflow-freediving.vercel.app/
- 宮古島：https://bananaflow-freediving.vercel.app/miyako/

注意：此 ZIP 是部署檔案，下載本檔不會自動修改線上網站。發布前請確認 Vercel CLI 已連結原本的正式專案。
