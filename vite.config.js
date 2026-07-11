import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 部署到 GitHub Pages 時，網址會長這樣：https://你的帳號.github.io/repo名稱/
// 所以 base 要設成 "/repo名稱/"（注意前後都要有斜線）。
// 把下面的 REPO_NAME 換成你在 GitHub 上建立的 repository 名稱。
// 如果不是要部署到 GitHub Pages（例如只是本機 npm run dev），這個設定不影響本機開發。
const REPO_NAME = "caiyuan-erp";

export default defineConfig({
  plugins: [react()],
  base: `/${REPO_NAME}/`,
});
