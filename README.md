# 彩苑科技 ERP — 本機執行說明

這是一個最小的 Vite + React 專案骨架，把 `caiyuan-erp.tsx`（也就是 `src/App.jsx`）包起來，
讓你可以在**自己的電腦、真正的 Chrome 瀏覽器**裡執行，不再受 Claude 對話預覽畫面的沙盒限制
（列印、彈出視窗、對外連線到 Supabase 這些功能都需要在真正的瀏覽器環境才能正常運作）。

## 需要先安裝

- [Node.js](https://nodejs.org/)（建議 18 版以上）— 安裝好之後，終端機打 `node -v` 應該要能看到版本號

## 執行步驟

1. 打開終端機（Terminal / 命令提示字元），切到這個資料夾
   ```bash
   cd caiyuan-erp-app
   ```
2. 安裝套件（第一次執行才需要，之後不用重複做）
   ```bash
   npm install
   ```
3. 啟動開發伺服器
   ```bash
   npm run dev
   ```
4. 終端機會顯示一個網址，通常是：
   ```
   http://localhost:5173
   ```
   直接用 Chrome 打開這個網址，就是完整、沒有沙盒限制的版本了。登入、列印、跟 Supabase 的資料同步都會是真正運作的狀態。

5. 不用的時候，在終端機按 `Ctrl + C` 就可以關掉伺服器。

## 如果想要一個「網路上任何人都能打開」的公開網址（用 GitHub Pages，完全免費）

1. 到 [github.com](https://github.com) 建一個新的 repository（例如叫 `caiyuan-erp`，public 或 private 都可以，但 GitHub Pages 免費方案要 public repo 才能開啟）

2. 打開 `vite.config.js`，把裡面的 `REPO_NAME` 改成你剛剛建立的 repository 名稱（要跟 GitHub 上的名字完全一樣）

3. 把這個資料夾推上 GitHub（在資料夾內執行）：
   ```bash
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/yuchi529/caiyuan-erp.git
   git push -u origin main
   ```

4. 安裝套件並部署：
   ```bash
   npm install
   npm run deploy
   ```
   這行指令會自動把專案 build 好，並推到一個叫 `gh-pages` 的分支上。

5. 到 GitHub 上這個 repository 的 **Settings → Pages**，「Source」選擇 `Deploy from a branch`，Branch 選擇 `gh-pages` / `root`，存檔。

6. 等 1-2 分鐘，網址會是：
   ```
   https://yuchi529.github.io/caiyuan-erp/
   ```
   之後任何人都能打開這個網址，不是只有你自己的電腦看得到。

以後程式碼有更新，只要重新執行 `npm run deploy` 就會覆蓋上去，不用重複第 3 步（除非有新檔案要加入版本控制）。

### 也可以改用 Vercel / Netlify
如果不想用 GitHub Pages，也可以把同一個 GitHub repository 匯入 Vercel 或 Netlify，兩者都能偵測到是 Vite 專案並自動部署，網址會是 `https://your-project.vercel.app` 這種格式，且不用自己設定 `base` 路徑（把 `vite.config.js` 裡的 `base` 那行拿掉即可）。

## 之後修改程式碼

之後如果請 Claude 繼續調整 ERP 系統的功能，把更新後的 `caiyuan-erp.tsx` 檔案內容整個覆蓋掉
`src/App.jsx` 就可以了，其他檔案（`package.json`、`vite.config.js` 等）不用動。
