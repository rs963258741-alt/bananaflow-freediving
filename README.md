# bananaflow-freediving
蕉流 Freediving 官方網站

## 網站後台（/admin/）

網址：`https://bananaflow-freediving.vercel.app/admin/`

在後台修改 → 按「發佈到網站」→ 後台直接把內容存進 GitHub → Vercel 自動更新（約 1 分鐘）。
**不需要再上傳壓縮檔到 GitHub。**

### 可以做什麼
- **上方選單大項**：介紹影片、教練、課程、小琉球導潛、折扣產品、相片集、報名、國外潛旅
  - 可新增／刪除／排序大項，排序＝選單與網頁的順序
  - 每個大項都能新增「下一層細項」，細項還能再往下新增（例：相片集 → 賽事 → 2026 PRC）
  - 大項可設定：直接顯示／點擊展開、是否出現在選單、是否只出現在選單（國外潛旅）、選單下拉列出細項
  - 「國外潛旅」底下的細項：填網址就連到該網址（例：`miyako/`）；留空會自動產生獨立頁面 `p/<網址代稱>/`
- **每個內容區塊都可以獨立修改**：文字段落、小標題、圖片、影片、相簿、價格卡片、價目表格、重點提醒框、
  項目清單、按鈕、聯絡連結、教練人物卡片、產品／折扣介紹、自訂 HTML（可貼外部嵌入碼）
  - 圖片可直接上傳（自動縮圖到 2000px，存到 `uploads/`），也可以貼外部圖片網址
  - 影片可貼 YouTube／Vimeo／Instagram Reels／.mp4 網址，選擇「封面＋播放鍵」或「直接嵌入」
  - 相簿可「一次上傳多張照片」
- **預覽**：發佈前可以用手機／電腦寬度預覽
- 修改會自動暫存在這台裝置，關掉瀏覽器也不會不見；按「發佈」才會更新正式網站

### 第一次使用：建立 GitHub Token
1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
2. Repository access：Only select repositories → 選 `bananaflow-freediving`
3. Permissions → Repository permissions → **Contents：Read and write**
4. 產生後複製 token，貼到後台的「連線設定」（只會存在該裝置的瀏覽器）

> Token 等同網站的修改權限，請勿分享；裝置遺失時，到 GitHub 刪除該 token 即可。

## 運作方式（給維護者）
- `content/site.json`：網站全部內容（後台編輯的就是這個檔案）
- `cms/render.js`：把 site.json 轉成 HTML 的渲染器，後台預覽、發佈與本機建置共用同一份，畫面一致
- `cms/site.css`：網站樣式（修改樣式請改這裡，下次發佈時會套用）
- `index.html`、`p/*/index.html`：由渲染器產生，**請勿手動修改**（下次發佈會被覆蓋）
- `miyako/`：宮古島獨立頁面（手工頁面，後台不會動到）
- 本機重新產生：`node scripts/build.js`（只用 Node 內建模組，不需 npm install）
- Vercel 設定不需要更改：仍是純靜態網站，Build Command 留空。
