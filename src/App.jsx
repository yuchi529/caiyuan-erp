import React, { useState, useMemo, useRef, useEffect, useContext, createContext } from "react";
import Papa from "papaparse";
import {
  LayoutDashboard, Users, Package, ShoppingCart, Truck, Printer,
  AlertTriangle, Plus, X, Trash2, Pencil, Search, Gauge, ChevronRight,
  Building2, TrendingUp, TrendingDown, Clock, CheckCircle2, ArrowUpRight, Menu, Receipt,
  Wallet, ArrowRightLeft, Banknote, Landmark, AlertCircle, CheckSquare, Square,
  Upload, Download, FileWarning, FileCheck2, CreditCard, Minus, ShoppingBag, CloudOff, Cloud, UserCog
} from "lucide-react";

/* ---------------------------------- Supabase 連線設定 ----------------------------------
 * 部署時請改用環境變數（例如 Vite 的 import.meta.env.VITE_SUPABASE_URL），
 * 這裡先用常數示範，實際使用前務必換成你自己 Supabase 專案的 URL 與 anon public key
 * （Supabase 專案 → Settings → API）。schema 請先執行 supabase-schema.sql。
 *
 * 注意：這裡刻意不使用 @supabase/supabase-js —— Claude 的 artifact 預覽沙盒只允許固定白名單的
 * 套件，supabase-js 不在清單內，載入官方 SDK 會讓預覽直接失敗。以下用瀏覽器原生 fetch()
 * 直接打 Supabase 的 REST（PostgREST）與 Auth（GoTrue）API，做出一個「介面很像官方 SDK」的
 * 輕量替代品，讓下面既有的 supabase.from(...) / supabase.auth.* 呼叫完全不用改。
 * ------------------------------------------------------------------------------------ */
const SUPABASE_URL = "https://izwdedpdnnthemfdypll.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6d2RlZHBkbm50aGVtZmR5cGxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NDg1MzAsImV4cCI6MjA5OTMyNDUzMH0.6v_EeT3Dqu61jEc1Kz_FPKCpTwCtPPucPS6vugdO-cM";

function createSupabaseLite(url, anonKey) {
  let session = null; // 只存在記憶體中（不用 localStorage），重新整理頁面就需要重新登入
  let authListeners = [];
  let refreshPromise = null;

  const setSession = (s, event) => {
    session = s;
    authListeners.forEach((cb) => cb(event, session));
  };

  const doRefresh = async () => {
    if (!session?.refresh_token) return;
    try {
      const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      const body = await res.json();
      if (!res.ok) {
        // refresh token 也失效了（例如太久沒用），只能請使用者重新登入
        setSession(null, "SIGNED_OUT");
        return;
      }
      setSession(
        {
          access_token: body.access_token,
          refresh_token: body.refresh_token,
          user: body.user,
          expires_at: Date.now() + (body.expires_in || 3600) * 1000,
        },
        "TOKEN_REFRESHED"
      );
    } catch (e) {
      // 網路暫時性錯誤：不清掉 session，下次請求再試一次即可
      console.error("[supabase] token 刷新失敗", e);
    }
  };

  // 每次要打 API 前先確認 token 沒有快過期（剩不到 60 秒就先刷新），同一時間只會發一次刷新請求
  const ensureFreshSession = async () => {
    if (!session?.expires_at) return;
    if (Date.now() < session.expires_at - 60000) return;
    if (!refreshPromise) refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
    await refreshPromise;
  };

  const authHeaders = async () => {
    await ensureFreshSession();
    return {
      apikey: anonKey,
      Authorization: `Bearer ${session?.access_token || anonKey}`,
      "Content-Type": "application/json",
    };
  };

  const parseErr = async (res) => {
    try {
      const body = await res.json();
      return { message: body.error_description || body.msg || body.message || body.error || res.statusText, code: body.code };
    } catch (e) {
      return { message: res.statusText };
    }
  };

  const from = (table) => {
    const state = { select: "*", filters: [] };
    const buildQs = () => {
      const parts = [`select=${encodeURIComponent(state.select)}`, ...state.filters];
      return parts.join("&");
    };
    const runSelect = async () => {
      const res = await fetch(`${url}/rest/v1/${table}?${buildQs()}`, { headers: await authHeaders() });
      if (!res.ok) return { data: null, error: await parseErr(res) };
      return { data: await res.json(), error: null };
    };
    const builder = {
      select(cols) {
        state.select = cols || "*";
        return builder;
      },
      eq(col, val) {
        state.filters.push(`${col}=eq.${encodeURIComponent(val)}`);
        return builder;
      },
      async single() {
        const { data, error } = await runSelect();
        if (error) return { data: null, error };
        return { data: (data && data[0]) || null, error: null };
      },
      // 讓 `await supabase.from(x).select("*")`（不接 .single()）也能直接運作
      then(resolve, reject) {
        runSelect().then(resolve, reject);
      },
      async insert(rows) {
        const res = await fetch(`${url}/rest/v1/${table}`, {
          method: "POST",
          headers: { ...(await authHeaders()), Prefer: "return=minimal" },
          body: JSON.stringify(rows),
        });
        if (!res.ok) return { error: await parseErr(res) };
        return { error: null };
      },
      async upsert(rows) {
        const res = await fetch(`${url}/rest/v1/${table}`, {
          method: "POST",
          headers: { ...(await authHeaders()), Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows),
        });
        if (!res.ok) return { error: await parseErr(res) };
        return { error: null };
      },
      delete() {
        return {
          async in(col, values) {
            if (!values || values.length === 0) return { error: null };
            const list = values.map((v) => `"${v}"`).join(",");
            const res = await fetch(`${url}/rest/v1/${table}?${col}=in.(${list})`, {
              method: "DELETE",
              headers: { ...(await authHeaders()), Prefer: "return=minimal" },
            });
            if (!res.ok) return { error: await parseErr(res) };
            return { error: null };
          },
        };
      },
    };
    return builder;
  };

  const auth = {
    async signInWithPassword({ email, password }) {
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) return { error: { message: body.error_description || body.msg || "登入失敗" } };
      setSession(
        {
          access_token: body.access_token,
          refresh_token: body.refresh_token,
          user: body.user,
          expires_at: Date.now() + (body.expires_in || 3600) * 1000,
        },
        "SIGNED_IN"
      );
      return { error: null };
    },
    async signUp({ email, password, options }) {
      const res = await fetch(`${url}/auth/v1/signup`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, data: options?.data || {} }),
      });
      const body = await res.json();
      if (!res.ok) return { error: { message: body.error_description || body.msg || "註冊失敗" } };
      return { error: null };
    },
    async getSession() {
      await ensureFreshSession();
      return { data: { session } };
    },
    onAuthStateChange(cb) {
      authListeners.push(cb);
      return { data: { subscription: { unsubscribe: () => { authListeners = authListeners.filter((f) => f !== cb); } } } };
    },
    async signOut() {
      setSession(null, "SIGNED_OUT");
      return { error: null };
    },
    async updateUser({ password, data }) {
      if (!session) return { error: { message: "尚未登入" } };
      await ensureFreshSession();
      if (!session) return { error: { message: "登入已逾期，請重新登入後再試一次" } };
      const body = {};
      if (password) body.password = password;
      if (data) body.data = data;
      const res = await fetch(`${url}/auth/v1/user`, {
        method: "PUT",
        headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await res.json();
      if (!res.ok) {
        if (resBody.code === "session_not_found" || /session/i.test(resBody.msg || "")) {
          setSession(null, "SIGNED_OUT");
          return { error: { message: "登入已逾期，請重新登入後再試一次" } };
        }
        return { error: { message: resBody.error_description || resBody.msg || "更新失敗" } };
      }
      session = { ...session, user: resBody };
      return { data: { user: resBody }, error: null };
    },
  };

  return { from, auth };
}

const supabase = SUPABASE_URL.includes("YOUR-PROJECT") ? null : createSupabaseLite(SUPABASE_URL, SUPABASE_ANON_KEY);

// 呼叫後端的 admin-users Edge Function（新增/修改/刪除人員帳號）。
// 這些操作需要 service role 權限才能呼叫 Supabase Auth 的管理 API，
// service role key 絕對不能放在前端程式碼裡，所以改成呼叫一個部署在 Supabase 的 Edge Function，
// 由 Edge Function 在伺服器端驗證呼叫者真的是 admin 之後，才用 service role key 執行實際操作。
async function callAdminUsersFn(action, payload) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { error: { message: "尚未登入" } };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: { message: body.error || res.statusText } };
  return { data: body.data, error: null };
}

/* ---------------------------------- 工具函式 ---------------------------------- */
const fmt = (n) => "NT$ " + Math.round(Number(n || 0)).toLocaleString("zh-TW");
const todayStr = () => new Date().toISOString().slice(0, 10);
const addMonths = (dateStr, m) => {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + m);
  return d.toISOString().slice(0, 10);
};
const daysUntil = (dateStr) => {
  const diff = new Date(dateStr) - new Date(todayStr());
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};
const currentPeriodLabel = () => {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const pad = (n) => String(n).padStart(2, "0");
  const start = `${y}-${pad(m + 1)}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const end = `${y}-${pad(m + 1)}-${pad(lastDay)}`;
  return `${start} ~ ${end}`;
};
const LOGO_DATA_URI = "data:image/png;base64,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";

let idCounter = 1000;
const nextId = (prefix) => `${prefix}-${String(idCounter++).padStart(4, "0")}`;

// 用隱藏的 iframe 局部列印：不需要開新分頁，是瀏覽器「只印某個區塊」的通用做法。
const printHtml = (innerHtml, title = "列印") => {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  document.body.appendChild(iframe);

  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  let doc;
  try {
    doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans TC', sans-serif; margin: 0; }
  .tabular-nums { font-variant-numeric: tabular-nums; }
  @page { margin: 12mm; }
</style>
</head>
<body>${innerHtml}</body>
</html>`);
    doc.close();
  } catch (e) {
    cleanup();
    alert("列印區塊建立失敗，請改用瀏覽器選單的「列印」功能。");
    return;
  }

  const triggerPrint = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      try { window.print(); } catch (e2) {}
    }
    setTimeout(cleanup, 1500);
  };

  if (doc.readyState === "complete") {
    setTimeout(triggerPrint, 600);
  } else {
    iframe.onload = () => setTimeout(triggerPrint, 600);
  }
};

// 複製要列印的區塊，並把 input/textarea/select 目前使用者輸入的值同步進去
// （outerHTML 只會反映初始 value/checked 屬性，不會反映使用者實際輸入的內容，需手動同步）
const cloneWithFormValues = (root) => {
  const clone = root.cloneNode(true);
  const liveEls = root.querySelectorAll("input, textarea, select");
  const cloneEls = clone.querySelectorAll("input, textarea, select");
  liveEls.forEach((live, i) => {
    const c = cloneEls[i];
    if (!c) return;
    if (live.type === "checkbox" || live.type === "radio") {
      if (live.checked) c.setAttribute("checked", "checked");
      else c.removeAttribute("checked");
    } else if (live.tagName === "SELECT") {
      Array.from(live.options).forEach((opt, oi) => {
        if (c.options[oi]) {
          if (opt.selected) c.options[oi].setAttribute("selected", "selected");
          else c.options[oi].removeAttribute("selected");
        }
      });
    } else {
      c.setAttribute("value", live.value);
    }
  });
  return clone;
};

// ---------- Supabase 讀寫同步：camelCase(JS) <-> snake_case(DB 欄位) 自動轉換 ----------
const camelToSnake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
const snakeToCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const toDbRow = (obj) => {
  const out = {};
  Object.keys(obj).forEach((k) => { out[camelToSnake(k)] = obj[k]; });
  return out;
};
const fromDbRow = (row) => {
  const out = {};
  Object.keys(row).forEach((k) => { out[snakeToCamel(k)] = row[k]; });
  return out;
};

async function syncTableDiff(table, prev, next, idKey) {
  const prevMap = new Map(prev.map((r) => [r[idKey], r]));
  const nextMap = new Map(next.map((r) => [r[idKey], r]));
  const toDelete = [...prevMap.keys()].filter((id) => !nextMap.has(id));
  const toUpsert = next.filter((r) => {
    const old = prevMap.get(r[idKey]);
    return !old || JSON.stringify(old) !== JSON.stringify(r);
  });
  let ok = true;
  if (toDelete.length) {
    const { error } = await supabase.from(table).delete().in(idKey, toDelete);
    if (error) {
      ok = false;
      console.error(`[supabase] 刪除 ${table} 失敗`, error);
      alert(error.code === "42501" || /row-level security/i.test(error.message || "")
        ? "刪除失敗：你的帳號權限不足（此操作僅限管理員），已還原畫面上的資料。"
        : `刪除失敗：${error.message}（已還原畫面上的資料）`);
    }
  }
  if (toUpsert.length) {
    const { error } = await supabase.from(table).upsert(toUpsert.map(toDbRow));
    if (error) {
      ok = false;
      console.error(`[supabase] 寫入 ${table} 失敗`, error);
      alert(error.code === "42501" || /row-level security/i.test(error.message || "")
        ? "儲存失敗：你的帳號權限不足，已還原畫面上的資料。"
        : `儲存失敗：${error.message}（已還原畫面上的資料）`);
    }
  }
  return ok;
}

// 通用「讀寫 Supabase」資料 hook，介面比照 useState，可直接取代 useState(seedX)。
// - 尚未設定 Supabase 連線時（SUPABASE_URL/KEY 還是預設佔位字串），自動退回純前端記憶體模式，不會壞掉。
// - 掛載時從 Supabase 讀取整張表；若表是空的，把種子資料寫進去做第一次初始化。
// - 訂閱 Supabase Realtime：其他使用者／裝置的異動會即時同步進來（這就是「串流」）。
// - setData 用法與 useState 的 setter 相同（可傳新陣列或 updater function），
//   內部會比對新舊陣列，自動把新增/修改/刪除同步寫回 Supabase。
function useSupabaseTable(table, seed, idKey = "id") {
  const [data, setDataState] = useState(seed);
  const [synced, setSynced] = useState(!supabase);
  const seededRef = useRef(false);
  const lastJsonRef = useRef(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    const load = async () => {
      const { data: rows, error } = await supabase.from(table).select("*");
      if (!active) return;
      if (error) {
        console.error(`[supabase] 讀取 ${table} 失敗`, error);
        setSynced(true);
        return;
      }
      if (rows && rows.length > 0) {
        const mapped = rows.map(fromDbRow);
        const json = JSON.stringify(mapped);
        if (json !== lastJsonRef.current) {
          lastJsonRef.current = json;
          setDataState(mapped);
        }
      } else if (!seededRef.current && seed && seed.length > 0) {
        seededRef.current = true;
        const { error: insErr } = await supabase.from(table).insert(seed.map(toDbRow));
        if (insErr) console.error(`[supabase] 初始化種子資料失敗 ${table}`, insErr);
      }
      setSynced(true);
    };

    load();
    // 沒有官方 SDK 就沒有 WebSocket realtime 頻道，改用定期輪詢達到「串流／多裝置同步」的效果。
    const timer = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  const setData = (updater) => {
    setDataState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (supabase) {
        lastJsonRef.current = JSON.stringify(next);
        syncTableDiff(table, prev, next, idKey).then((ok) => {
          if (!ok) {
            lastJsonRef.current = JSON.stringify(prev);
            setDataState(prev);
          }
        });
      }
      return next;
    });
  };

  return [data, setData, synced];
}

/* ---------------------------------- 種子資料 ---------------------------------- */
const seedCustomers = [
  { id: "C-0001", name: "誠品股份有限公司", taxId: "12345678", contact: "林小姐", phone: "02-2775-1234", address: "台北市信義區松高路11號", type: "一般+租賃" },
  { id: "C-0002", name: "群光電子股份有限公司", taxId: "23456781", contact: "陳經理", phone: "03-666-1888", address: "桃園市龜山區文化二路", type: "一般" },
  { id: "C-0003", name: "東吳大學", taxId: "34567812", contact: "王組長", phone: "02-2881-9471", address: "台北市士林區臨溪路70號", type: "租賃" },
  { id: "C-0004", name: "王品餐飲集團", taxId: "45678123", contact: "張副理", phone: "04-2359-8888", address: "台中市西屯區台灣大道", type: "一般+租賃" },
  { id: "C-0005", name: "台北市立圖書館", taxId: "56781234", contact: "李館員", phone: "02-2331-7788", address: "台北市中正區公園路", type: "租賃" },
];

const seedProducts = [
  { id: "P-0001", name: "Canon iR-ADV C3530 彩色事務機", category: "機器", spec: "A3彩色雷射複合機", cost: 68000, price: 98000, stock: 6, unit: "台", reorder: 2 },
  { id: "P-0002", name: "HP LaserJet Pro M404dn", category: "機器", spec: "A4黑白雷射印表機", cost: 6200, price: 9800, stock: 14, unit: "台", reorder: 5 },
  { id: "P-0003", name: "Canon NPG-67 黑色碳粉匣", category: "耗材", spec: "適用 iR-ADV C3530", cost: 1450, price: 2380, stock: 22, unit: "支", reorder: 10 },
  { id: "P-0004", name: "Canon NPG-67 彩色碳粉匣(CMY)", category: "耗材", spec: "適用 iR-ADV C3530", cost: 1680, price: 2680, stock: 8, unit: "支", reorder: 10 },
  { id: "P-0005", name: "HP CF259A 碳粉匣", category: "耗材", spec: "適用 M404dn", cost: 1150, price: 1880, stock: 30, unit: "支", reorder: 15 },
  { id: "P-0006", name: "定影組 Fuser Unit", category: "零件", spec: "適用 iR-ADV 系列", cost: 4200, price: 6500, stock: 3, unit: "組", reorder: 3 },
  { id: "P-0007", name: "感光滾筒 Drum Unit", category: "零件", spec: "適用 M404dn", cost: 980, price: 1600, stock: 9, unit: "支", reorder: 5 },
];

const seedSalesOrders = [
  { id: "SO-0001", date: "2026-06-08", customerId: "C-0002", status: "已出貨", items: [{ productId: "P-0002", qty: 3, price: 9800 }, { productId: "P-0005", qty: 6, price: 1880 }] },
  { id: "SO-0002", date: "2026-06-20", customerId: "C-0004", status: "待出貨", items: [{ productId: "P-0003", qty: 4, price: 2380 }] },
  { id: "SO-0003", date: "2026-07-01", customerId: "C-0001", status: "已出貨", items: [{ productId: "P-0001", qty: 1, price: 98000 }] },
];

const seedPurchaseOrders = [
  { id: "PO-0001", date: "2026-06-05", supplier: "台灣佳能股份有限公司", status: "已入庫", items: [{ productId: "P-0003", qty: 20, cost: 1450 }, { productId: "P-0004", qty: 10, cost: 1680 }] },
  { id: "PO-0002", date: "2026-06-25", supplier: "惠普科技台灣分公司", status: "訂購中", items: [{ productId: "P-0005", qty: 40, cost: 1150 }] },
];

const seedLeases = [
  { id: "L-0001", customerId: "C-0001", machineName: "Canon iR-ADV C3530", serial: "SN-2024-8871", machineType: "雷射", startDate: "2025-09-01", endDate: "2027-08-31", monthlyRent: 3200, meterRate: 0.8, lastMeter: 128400, currentMeter: 141200, status: "租賃中" },
  { id: "L-0002", customerId: "C-0003", machineName: "Canon iR-ADV C3530", serial: "SN-2024-9012", machineType: "雷射", startDate: "2024-03-01", endDate: "2026-07-15", monthlyRent: 2800, meterRate: 0.7, lastMeter: 220100, currentMeter: 235600, status: "租賃中" },
  { id: "L-0003", customerId: "C-0005", machineName: "HP LaserJet Enterprise M528", serial: "SN-2023-3345", machineType: "雷射", startDate: "2023-05-01", endDate: "2026-07-20", monthlyRent: 1800, meterRate: 0.5, lastMeter: 88000, currentMeter: 91200, status: "租賃中" },
  { id: "L-0004", customerId: "C-0004", machineName: "Canon iR-ADV C3330", serial: "SN-2022-1187", machineType: "雷射", startDate: "2022-01-01", endDate: "2026-01-01", monthlyRent: 2500, meterRate: 0.7, lastMeter: 340000, currentMeter: 340000, status: "已到期" },
  { id: "L-0005", customerId: "C-0001", machineName: "HP LaserJet Pro M404dn", serial: "SN-2025-4471", machineType: "雷射", startDate: "2025-11-01", endDate: "2027-10-31", monthlyRent: 900, meterRate: 0.4, lastMeter: 15200, currentMeter: 19800, status: "租賃中" },
  { id: "L-0006", customerId: "C-0001", machineName: "Canon iR-ADV C3330", serial: "SN-2024-6620", machineType: "雷射", startDate: "2024-12-01", endDate: "2026-11-30", monthlyRent: 2400, meterRate: 0.65, lastMeter: 96000, currentMeter: 103500, status: "租賃中" },
  { id: "L-0007", customerId: "C-0002", machineName: "Epson WorkForce Pro WF-C5790 噴墨事務機", serial: "SN-2025-7734", machineType: "噴墨", startDate: "2025-06-01", endDate: "2027-05-31", monthlyRent: 1200, meterRate: 0, lastMeter: 0, currentMeter: 0, status: "租賃中" },
];

/* ---------------------------------- 應收帳款 / 預收款種子資料 ---------------------------------- */
const seedArRecords = [
  { id: "AR-0001", sourceType: "銷售", sourceNo: "SO-0001", customerId: "C-0002", docDate: "2026-06-08", dueDate: addMonths("2026-06-08", 1), amount: 3 * 9800 + 6 * 1880, paidAmount: 3 * 9800 + 6 * 1880 },
  { id: "AR-0002", sourceType: "銷售", sourceNo: "SO-0003", customerId: "C-0001", docDate: "2026-07-01", dueDate: addMonths("2026-07-01", 1), amount: 98000, paidAmount: 0 },
  { id: "AR-0003", sourceType: "租賃", sourceNo: "L-0004", customerId: "C-0004", docDate: "2026-05-20", dueDate: "2026-06-05", amount: 2500 + (340000 - 320000) * 0.7, paidAmount: 0 },
  { id: "AR-0004", sourceType: "租賃", sourceNo: "L-0002", customerId: "C-0003", docDate: "2026-06-01", dueDate: "2026-06-16", amount: 2800 + (220100 - 205000) * 0.7, paidAmount: 8000 },
];

const seedPrepayments = [
  { id: "PP-0001", customerId: "C-0005", amount: 20000, balance: 20000, date: "2026-05-10", note: "圖書館租賃訂金" },
];

/* ---------------------------------- 共用小元件 ---------------------------------- */
const Badge = ({ children, tone = "slate" }) => {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-100 text-amber-700",
    teal: "bg-teal-100 text-teal-700",
    red: "bg-rose-100 text-rose-700",
    green: "bg-emerald-100 text-emerald-700",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
};

const RegMark = ({ size = 18, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.4" />
    <line x1="12" y1="0" x2="12" y2="6" stroke="currentColor" strokeWidth="1.4" />
    <line x1="12" y1="18" x2="12" y2="24" stroke="currentColor" strokeWidth="1.4" />
    <line x1="0" y1="12" x2="6" y2="12" stroke="currentColor" strokeWidth="1.4" />
    <line x1="18" y1="12" x2="24" y2="12" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const Modal = ({ title, onClose, children, wide }) => (
  <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div className={`bg-white rounded-xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} overflow-y-auto`} style={{ maxHeight: "88vh" }}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-xl">
        <h3 className="font-semibold text-slate-800" style={{ fontFamily: "'Noto Sans TC', sans-serif" }}>{title}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);

const Field = ({ label, children }) => (
  <label className="block mb-3">
    <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
    {children}
  </label>
);

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800/30 focus:border-slate-800";

const StatCard = ({ icon: Icon, label, value, tone, sub }) => (
  <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
    <div className="flex items-center justify-between mb-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${tone}`}>
        <Icon size={17} className="text-white" />
      </div>
    </div>
    <div className="text-2xl font-bold text-slate-800 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{value}</div>
    <div className="text-xs text-slate-500 mt-1">{label}</div>
    {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
  </div>
);

/* ---------------------------------- 登入驗證 ---------------------------------- */
const AuthContext = createContext({ session: null, profile: null, role: "staff", signOut: () => {} });
const useAuth = () => useContext(AuthContext);

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (e2) {
      console.error("[登入失敗]", e2);
      if (e2 instanceof TypeError) {
        // fetch() 本身被擋下（連不到 Supabase），常見於預覽/沙盒環境限制對外連線
        setErr("無法連線到 Supabase（網路請求被目前環境擋下）。若在 Claude 的預覽畫面中測試，這類對外連線可能會被沙盒限制；請改成部署到你自己的網站後再試一次。");
      } else {
        setErr(e2.message === "Invalid login credentials" ? "帳號或密碼錯誤" : e2.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4" style={{ fontFamily: "'Noto Sans TC', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap');`}</style>
      <div className="w-full max-w-sm bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-1">
            <img src={LOGO_DATA_URI} alt="彩苑科技 logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="font-bold text-sm text-slate-800">彩苑科技有限公司</div>
            <div className="text-xs text-slate-400">ERP 系統登入</div>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Email">
            <input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </Field>
          <Field label="密碼">
            <input type="password" required minLength={6} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 碼" />
          </Field>
          {err && <div className="text-xs text-rose-500">{err}</div>}
          <button type="submit" disabled={busy} className="w-full bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-900 disabled:bg-slate-300">
            {busy ? "處理中…" : "登入"}
          </button>
        </form>
        <p className="text-xs text-slate-400 mt-4">
          沒有帳號嗎？請洽系統管理員在「人員帳號管理」裡幫你建立。
        </p>
      </div>
    </div>
  );
}

function ChangePasswordModal({ onClose }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (pw1.length < 6) { setErr("密碼至少需要 6 碼"); return; }
    if (pw1 !== pw2) { setErr("兩次輸入的密碼不一致"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      setOk(true);
    } catch (e2) {
      setErr(e2.message || "變更失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="變更密碼" onClose={onClose}>
      {ok ? (
        <div className="space-y-4">
          <p className="text-sm text-teal-600">密碼已變更成功。</p>
          <button onClick={onClose} className="w-full bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-900">關閉</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="新密碼">
            <input type="password" required minLength={6} className={inputCls} value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="至少 6 碼" />
          </Field>
          <Field label="再次輸入新密碼">
            <input type="password" required minLength={6} className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          {err && <div className="text-xs text-rose-500">{err}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
            <button type="submit" disabled={busy} className="flex-1 bg-slate-800 text-white rounded-lg py-2 text-sm font-medium hover:bg-slate-900 disabled:bg-slate-300">
              {busy ? "處理中…" : "確認變更"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = 讀取中, null = 未登入
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadProfile = () => {
    if (!supabase || !session) { setProfile(null); return; }
    supabase.from("profiles").select("*").eq("id", session.user.id).single()
      .then(({ data, error }) => {
        if (error) {
          console.error("[讀取個人資料失敗]", error);
          setProfileError(error.message || JSON.stringify(error));
          return;
        }
        setProfileError(null);
        setProfile(data);
      })
      .catch((e) => {
        console.error("[讀取個人資料時發生例外]", e);
        setProfileError(e.message || String(e));
      });
  };

  useEffect(loadProfile, [session]);

  // 尚未設定 Supabase 連線：直接放行，維持純本機模式可用
  if (!supabase) {
    return <AuthContext.Provider value={{ session: null, profile: null, role: "admin", signOut: () => {}, refreshProfile: () => {}, profileError: null }}>{children}</AuthContext.Provider>;
  }

  if (session === undefined) {
    return <div className="min-h-screen flex items-center justify-center bg-stone-50 text-slate-400 text-sm">載入中…</div>;
  }

  if (!session) return <LoginScreen />;

  const role = profile?.role || "staff";
  const signOut = () => supabase.auth.signOut();

  return <AuthContext.Provider value={{ session, profile, role, signOut, profileError, refreshProfile: loadProfile }}>{children}</AuthContext.Provider>;
}

/* ---------------------------------- 主程式 ---------------------------------- */
function ErpApp() {
  const { session, profile, role, signOut, profileError, refreshProfile } = useAuth();
  const [tab, setTab] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [customers, setCustomers] = useSupabaseTable("customers", seedCustomers);
  const [products, setProducts] = useSupabaseTable("products", seedProducts);
  const [salesOrders, setSalesOrders] = useSupabaseTable("sales_orders", seedSalesOrders);
  const [posSales, setPosSales] = useSupabaseTable("pos_sales", []);
  const [purchaseOrders, setPurchaseOrders] = useSupabaseTable("purchase_orders", seedPurchaseOrders);
  const [leases, setLeases] = useSupabaseTable("leases", seedLeases);
  const [arRecords, setArRecords] = useSupabaseTable("ar_records", seedArRecords);
  const [prepayments, setPrepayments] = useSupabaseTable("prepayments", seedPrepayments);
  const [reconciliations, setReconciliations] = useSupabaseTable("reconciliations", []);
  const [categoryRows, setCategoryRows] = useSupabaseTable(
    "categories",
    DEFAULT_PRODUCT_CATEGORIES.map((name) => ({ name })),
    "name"
  );
  const categories = categoryRows.map((r) => r.name);
  // categories 對外維持「純字串陣列」的介面（跟改動前一樣），內部再轉換成 {name} 物件寫回 Supabase
  const setCategories = (updater) => {
    setCategoryRows((prevRows) => {
      const prevNames = prevRows.map((r) => r.name);
      const nextNames = typeof updater === "function" ? updater(prevNames) : updater;
      return nextNames.map((name) => ({ name }));
    });
  };

  const custName = (id) => customers.find((c) => c.id === id)?.name || "—";
  const prodName = (id) => products.find((p) => p.id === id)?.name || "—";

  /* 依銷售單/租賃出帳自動產生應收帳款（避免重複產生） */
  const addArRecord = (rec) => {
    setArRecords((prev) => {
      if (prev.some((a) => a.sourceNo === rec.sourceNo && a.docDate === rec.docDate)) return prev;
      return [{ id: nextId("AR"), paidAmount: 0, ...rec }, ...prev];
    });
  };

  /* ---------- 衍生統計 ---------- */
  const stats = useMemo(() => {
    const thisMonth = todayStr().slice(0, 7);
    const today = todayStr();
    const salesTotal = salesOrders
      .filter((o) => o.date.slice(0, 7) === thisMonth && o.status !== "已取消")
      .reduce((s, o) => s + o.items.reduce((a, i) => a + i.qty * i.price, 0), 0);
    const purchaseTotal = purchaseOrders
      .filter((o) => o.date.slice(0, 7) === thisMonth)
      .reduce((s, o) => s + o.items.reduce((a, i) => a + i.qty * i.cost, 0), 0);
    const activeLeases = leases.filter((l) => l.status === "租賃中");
    const rentDue = activeLeases.reduce((s, l) => {
      const usage = l.machineType === "雷射" ? Math.max(0, l.currentMeter - l.lastMeter) : 0;
      return s + l.monthlyRent + usage * l.meterRate;
    }, 0);
    const lowStock = products.filter((p) => p.stock <= p.reorder);
    const expiring = leases.filter((l) => l.status === "租賃中" && daysUntil(l.endDate) <= 30);
    const arUnpaid = arRecords.filter((a) => a.amount - a.paidAmount > 0);
    const arOverdue = arUnpaid.filter((a) => daysUntil(a.dueDate) < 0);
    const arTotal = arUnpaid.reduce((s, a) => s + (a.amount - a.paidAmount), 0);
    const todaySalesOrderTotal = salesOrders
      .filter((o) => o.date === today && o.status !== "已取消")
      .reduce((s, o) => s + o.items.reduce((a, i) => a + i.qty * i.price, 0), 0);
    const todayPosSales = posSales.filter((s) => s.date === today);
    const todayPosTotal = todayPosSales.reduce((s, r) => s + r.total, 0);
    const todayRevenue = todaySalesOrderTotal + todayPosTotal;
    return {
      salesTotal, purchaseTotal, activeLeases: activeLeases.length, rentDue, lowStock, expiring, arUnpaid, arOverdue, arTotal,
      todayRevenue, todaySalesOrderTotal, todayPosTotal, todayPosCount: todayPosSales.length,
    };
  }, [salesOrders, purchaseOrders, leases, products, arRecords, posSales]);

  const navItems = [
    { key: "dashboard", label: "儀表板", icon: LayoutDashboard },
    { key: "customers", label: "客戶管理", icon: Users },
    { key: "products", label: "商品庫存", icon: Package },
    { key: "sales", label: "銷售訂單", icon: ShoppingCart },
    { key: "pos", label: "銷售單", icon: CreditCard },
    { key: "purchase", label: "採購訂單", icon: Truck },
    { key: "lease", label: "租賃管理", icon: Printer },
    { key: "ar", label: "應收帳款", icon: Receipt },
    { key: "prepay", label: "預收款", icon: Wallet },
    ...(role === "admin" ? [{ key: "staff", label: "人員帳號管理", icon: UserCog }] : []),
  ];

  return (
    <div className="min-h-screen flex bg-stone-50 overflow-x-hidden" style={{ fontFamily: "'Noto Sans TC', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .tabular-nums { font-variant-numeric: tabular-nums; }
        @media print {
          body * { visibility: hidden; }
          .invoice-print-area, .invoice-print-area * { visibility: visible; }
          .invoice-print-area { position: fixed; inset: 0; background: #fff; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* 手機版遮罩 */}
      {navOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-30 sm:hidden" onClick={() => setNavOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed sm:static inset-y-0 left-0 z-40 w-60 shrink-0 bg-slate-900 flex flex-col transform transition-transform duration-300 ease-in-out sm:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-6 border-b border-white/10 flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg bg-white flex items-center justify-center shrink-0 p-1">
            <img src={LOGO_DATA_URI} alt="OK ink logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="font-bold text-sm leading-tight" style={{ color: "#FFFFFF" }}>彩苑科技有限公司</div>
            <div className="text-xs tracking-wide flex items-center gap-1" style={{ color: "#B9C2D0" }}>
              {supabase ? <Cloud size={11} /> : <CloudOff size={11} />}
              {supabase ? "已連接 Supabase" : "尚未連接（本機模式）"}
            </div>
          </div>
          <button onClick={() => setNavOpen(false)} className="ml-auto text-white/50 hover:text-white sm:hidden">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 py-4 px-2 space-y-1">
          {navItems.map((n) => (
            <button
              key={n.key}
              onClick={() => { setTab(n.key); setNavOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
                tab === n.key ? "bg-white/10 text-white font-medium" : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              <n.icon size={16} />
              {n.label}
              {n.key === "products" && stats.lowStock.length > 0 && (
                <span className="ml-auto w-4 h-4 rounded-full bg-amber-600 text-xs flex items-center justify-center">{stats.lowStock.length}</span>
              )}
              {n.key === "lease" && stats.expiring.length > 0 && (
                <span className="ml-auto w-4 h-4 rounded-full bg-amber-400 text-xs text-slate-900 flex items-center justify-center">{stats.expiring.length}</span>
              )}
              {n.key === "ar" && stats.arOverdue.length > 0 && (
                <span className="ml-auto w-4 h-4 rounded-full bg-rose-500 text-xs text-white flex items-center justify-center">{stats.arOverdue.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-white/10">
          {session ? (
            <div>
              <div className="flex items-center gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-white/80 truncate">{profile?.display_name || session.user.email}</div>
                  <div className="text-[10px] text-white/40">{role === "admin" ? "管理員" : "一般人員"}</div>
                </div>
                <button onClick={signOut} className="ml-auto text-white/40 hover:text-white text-xs px-2 py-1 rounded hover:bg-white/10">登出</button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => setShowChangePassword(true)} className="text-[11px] text-white/50 hover:text-white underline underline-offset-2">變更密碼</button>
                {profileError && (
                  <button onClick={refreshProfile} className="text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2">角色讀取失敗，點此重試</button>
                )}
              </div>
              {profileError && (
                <div className="text-[10px] text-amber-400/80 mt-1 break-words">除錯訊息：{profileError}</div>
              )}
            </div>
          ) : (
            <div className="text-xs text-white/40">印表機 · 事務機 銷售與租賃</div>
          )}
        </div>
      </aside>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <header className="bg-white border-b border-slate-100 px-4 sm:px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setNavOpen(true)} className="sm:hidden text-slate-500 shrink-0">
              <Menu size={22} />
            </button>
            <h1 className="text-lg font-bold text-slate-800 truncate">{navItems.find((n) => n.key === tab)?.label}</h1>
          </div>
          <div className="text-xs text-slate-400 tabular-nums shrink-0" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{todayStr()}</div>
        </header>
        <div className="p-4 sm:p-8">
          {tab === "dashboard" && <Dashboard stats={stats} salesOrders={salesOrders} leases={leases} customers={customers} custName={custName} />}
          {tab === "customers" && <CustomersTab customers={customers} setCustomers={setCustomers} />}
          {tab === "products" && <ProductsTab products={products} setProducts={setProducts} categories={categories} setCategories={setCategories} />}
          {tab === "sales" && <SalesTab salesOrders={salesOrders} setSalesOrders={setSalesOrders} customers={customers} products={products} custName={custName} prodName={prodName} addArRecord={addArRecord} />}
          {tab === "pos" && <PosTab posSales={posSales} setPosSales={setPosSales} customers={customers} products={products} setProducts={setProducts} custName={custName} prodName={prodName} />}
          {tab === "purchase" && <PurchaseTab purchaseOrders={purchaseOrders} setPurchaseOrders={setPurchaseOrders} products={products} setProducts={setProducts} prodName={prodName} />}
          {tab === "lease" && <LeaseTab leases={leases} setLeases={setLeases} customers={customers} custName={custName} addArRecord={addArRecord} />}
          {tab === "ar" && (
            <ArTab
              arRecords={arRecords} setArRecords={setArRecords}
              customers={customers} custName={custName}
              prepayments={prepayments} setPrepayments={setPrepayments}
              reconciliations={reconciliations} setReconciliations={setReconciliations}
            />
          )}
          {tab === "prepay" && (
            <PrepayTab prepayments={prepayments} setPrepayments={setPrepayments} customers={customers} custName={custName} />
          )}
          {tab === "staff" && role === "admin" && <StaffTab currentUserId={session.user.id} />}
        </div>
      </main>
    </div>
  );
}

/* ---------------------------------- 儀表板 ---------------------------------- */
function Dashboard({ stats, salesOrders, leases, custName }) {
  const recent = [...salesOrders].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard icon={Banknote} label="本日營業收入" value={fmt(stats.todayRevenue)} tone="bg-indigo-600" sub={`銷售單 ${fmt(stats.todayPosTotal)}（${stats.todayPosCount} 筆）· 銷售訂單 ${fmt(stats.todaySalesOrderTotal)}`} />
        <StatCard icon={TrendingUp} label="本月銷售額" value={fmt(stats.salesTotal)} tone="bg-slate-800" />
        <StatCard icon={TrendingDown} label="本月採購額" value={fmt(stats.purchaseTotal)} tone="bg-teal-600" />
        <StatCard icon={Printer} label="租賃中機台數" value={stats.activeLeases} tone="bg-amber-600" />
        <StatCard icon={Gauge} label="本期應收租金(含計數)" value={fmt(stats.rentDue)} tone="bg-emerald-600" />
        <StatCard icon={AlertTriangle} label="低庫存品項" value={stats.lowStock.length} tone="bg-rose-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm text-slate-700">近期銷售訂單</h3>
            <ChevronRight size={15} className="text-slate-300" />
          </div>
          <div className="space-y-2.5">
            {recent.map((o) => {
              const total = o.items.reduce((a, i) => a + i.qty * i.price, 0);
              return (
                <div key={o.id} className="flex items-center justify-between text-sm border-b border-slate-50 pb-2.5 last:border-0">
                  <div>
                    <div className="font-medium text-slate-700">{custName(o.customerId)}</div>
                    <div className="text-xs text-slate-400">{o.id} · {o.date}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(total)}</div>
                    <Badge tone={o.status === "已出貨" ? "green" : "amber"}>{o.status}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm text-slate-700">租約到期提醒（30 天內）</h3>
            <Clock size={15} className="text-slate-300" />
          </div>
          {stats.expiring.length === 0 && <div className="text-sm text-slate-400 py-6 text-center">目前沒有即將到期的租約</div>}
          <div className="space-y-2.5">
            {stats.expiring.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-sm border-b border-slate-50 pb-2.5 last:border-0">
                <div>
                  <div className="font-medium text-slate-700">{custName(l.customerId)} · {l.machineName}</div>
                  <div className="text-xs text-slate-400">序號 {l.serial}</div>
                </div>
                <Badge tone="red">{daysUntil(l.endDate)} 天後到期</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      {stats.lowStock.length > 0 && (
        <div className="bg-white rounded-xl border border-rose-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={15} className="text-rose-500" />
            <h3 className="font-semibold text-sm text-slate-700">低庫存警示</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {stats.lowStock.map((p) => (
              <Badge key={p.id} tone="red">{p.name}（庫存 {p.stock} {p.unit}）</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- 客戶管理 ---------------------------------- */
/* ---------------------------------- 通用 CSV 批次匯入元件 ---------------------------------- */
function downloadCsvTemplate(headers, sampleRows, filename) {
  const csv = [headers.join(","), ...sampleRows.map((r) => r.join(","))].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function CsvImportModal({ title, hint, headers, sampleRows, previewCols, normalizeRows, onConfirm, onClose, templateFileName }) {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState("");

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        if (!res.data || res.data.length === 0) { setErr("檔案內沒有可匯入的資料列"); setRows([]); return; }
        setRows(normalizeRows(res.data));
      },
      error: (e2) => setErr("檔案解析失敗：" + e2.message),
    });
  };

  const toggleInclude = (idx) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, include: !r.include } : r)));
  const validCount = rows.filter((r) => r.ok && r.include).length;
  const errorCount = rows.filter((r) => !r.ok).length;
  const confirm = () => {
    const toAdd = rows.filter((r) => r.ok && r.include);
    if (toAdd.length === 0) return;
    onConfirm(toAdd);
  };

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-500 leading-relaxed">{hint}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => downloadCsvTemplate(headers, sampleRows, templateFileName)} className="flex items-center gap-1.5 border border-slate-200 text-slate-600 text-sm px-3.5 py-2 rounded-lg hover:bg-slate-50">
            <Download size={14} /> 下載匯入範本
          </button>
          <label className="flex items-center gap-1.5 bg-slate-800 text-white text-sm px-3.5 py-2 rounded-lg hover:bg-slate-900 cursor-pointer">
            <Upload size={14} /> 選擇 CSV 檔案
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </label>
          {fileName && <span className="text-xs text-slate-400">已選擇：{fileName}</span>}
        </div>

        {err && (
          <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">
            <AlertCircle size={15} /> {err}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                共 {rows.length} 列，
                <span className="text-emerald-600 font-medium">可匯入 {rows.filter((r) => r.ok).length} 筆</span>
                {errorCount > 0 && <span className="text-rose-500 font-medium ml-1">・錯誤 {errorCount} 筆</span>}
              </span>
              <span>已勾選匯入：<b className="text-slate-700">{validCount}</b> 筆</span>
            </div>
            <div className="rounded-lg border border-slate-200 overflow-hidden max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-slate-400 border-b border-slate-100">
                    <th className="px-2 py-2 w-8"></th>
                    {previewCols.map((c) => <th key={c.key} className="px-2 py-2 font-medium">{c.label}</th>)}
                    <th className="px-2 py-2 font-medium">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-b border-slate-50 ${r.ok ? "" : "bg-rose-50/40"}`}>
                      <td className="px-2 py-1.5">
                        <input type="checkbox" disabled={!r.ok} checked={r.include} onChange={() => toggleInclude(i)} />
                      </td>
                      {previewCols.map((c) => (
                        <td key={c.key} className="px-2 py-1.5 text-slate-700">{c.format ? c.format(r) : r[c.key]}</td>
                      ))}
                      <td className="px-2 py-1.5">
                        {r.ok ? (
                          <span className="flex items-center gap-1 text-emerald-600"><FileCheck2 size={12} /> 可匯入</span>
                        ) : (
                          <span className="flex items-center gap-1 text-rose-500"><FileWarning size={12} /> {r.errors.join("、")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm font-medium hover:bg-slate-50">取消</button>
          <button
            onClick={confirm}
            disabled={validCount === 0}
            className="flex-1 bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-900 disabled:opacity-40"
          >
            確認匯入（{validCount} 筆）
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------- 可搜尋商品選擇器 ---------------------------------- */
function ProductSearchSelect({ products, value, onChange, placeholder = "搜尋商品名稱、規格或分類" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);

  const selected = products.find((p) => p.id === value);

  useEffect(() => {
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? products.filter((p) => `${p.name}${p.spec}${p.category}`.toLowerCase().includes(q))
    : products;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQuery(""); }}
        className={inputCls + " text-left flex items-center justify-between gap-2"}
      >
        <span className={`truncate ${selected ? "text-slate-700" : "text-slate-400"}`}>
          {selected ? selected.name : "選擇商品"}
        </span>
        <Search size={13} className="text-slate-300 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-800/20"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-3 text-xs text-slate-400">找不到符合的商品</div>}
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onChange(p.id); setOpen(false); setQuery(""); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between gap-2 ${p.id === value ? "bg-slate-50" : ""}`}
              >
                <span className="min-w-0">
                  <span className="font-medium text-slate-700">{p.name}</span>
                  <span className="text-xs text-slate-400 ml-1.5">{p.spec}</span>
                </span>
                <span className="text-xs text-slate-400 tabular-nums shrink-0" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(p.price)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const CUSTOMER_TYPES = ["一般", "租賃", "一般+租賃"];
const CUSTOMER_CSV_HEADERS = ["客戶名稱", "統一編號", "聯絡人", "電話", "地址", "類型"];

function CustomersTab({ customers, setCustomers }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [q, setQ] = useState("");
  const [taxIdError, setTaxIdError] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const openAdd = () => { setForm({ name: "", taxId: "", contact: "", phone: "", address: "", type: "一般" }); setTaxIdError(""); setModal("add"); };
  const openEdit = (c) => { setForm(c); setTaxIdError(""); setModal("edit"); };
  const validateTaxId = (taxId, selfId) => {
    if (!taxId) return "統一編號為必填";
    if (!/^\d{8}$/.test(taxId)) return "統一編號須為 8 碼數字";
    if (customers.some((c) => c.taxId === taxId && c.id !== selfId)) return "此統一編號已被其他客戶使用";
    return "";
  };
  const save = () => {
    if (!form.name) return;
    const err = validateTaxId(form.taxId, modal === "edit" ? form.id : null);
    if (err) { setTaxIdError(err); return; }
    if (modal === "add") setCustomers([...customers, { ...form, id: nextId("C") }]);
    else setCustomers(customers.map((c) => (c.id === form.id ? form : c)));
    setModal(null);
  };
  const remove = (id) => setCustomers(customers.filter((c) => c.id !== id));
  const filtered = customers.filter((c) => c.name.includes(q) || c.contact.includes(q) || (c.taxId || "").includes(q));

  /* -------- 批次匯入 -------- */
  const normalizeCustomerRows = (data) => {
    const seenTaxIds = new Set();
    return data.map((raw) => {
      const name = (raw["客戶名稱"] || raw["name"] || "").trim();
      const taxId = (raw["統一編號"] || raw["taxId"] || "").toString().replace(/\D/g, "").slice(0, 8);
      const contact = (raw["聯絡人"] || raw["contact"] || "").trim();
      const phone = (raw["電話"] || raw["phone"] || "").trim();
      const address = (raw["地址"] || raw["address"] || "").trim();
      let type = (raw["類型"] || raw["type"] || "一般").trim();
      if (!CUSTOMER_TYPES.includes(type)) type = "一般";

      const errors = [];
      if (!name) errors.push("缺少客戶名稱");
      if (!taxId) errors.push("缺少統一編號");
      else if (!/^\d{8}$/.test(taxId)) errors.push("統一編號須為 8 碼數字");
      else if (customers.some((c) => c.taxId === taxId)) errors.push("統一編號與現有客戶重複");
      else if (seenTaxIds.has(taxId)) errors.push("與檔案中其他列統一編號重複");
      if (taxId) seenTaxIds.add(taxId);

      return { name, taxId, contact, phone, address, type, errors, ok: errors.length === 0, include: errors.length === 0 };
    });
  };

  const confirmImportCustomers = (toAdd) => {
    const newCustomers = toAdd.map((r) => ({
      id: nextId("C"), name: r.name, taxId: r.taxId, contact: r.contact, phone: r.phone, address: r.address, type: r.type,
    }));
    setCustomers([...customers, ...newCustomers]);
    setImportOpen(false);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between p-4 border-b border-slate-100 flex-wrap gap-2">
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-300" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋客戶名稱、聯絡人或統一編號" className={inputCls + " pl-8"} />
        </div>
        <div className="flex gap-2">
          <button onClick={() => setImportOpen(true)} className="flex items-center gap-1.5 border border-slate-200 text-slate-600 text-sm px-3.5 py-2 rounded-lg hover:bg-slate-50">
            <Upload size={15} /> 批次匯入
          </button>
          <button onClick={openAdd} className="flex items-center gap-1.5 bg-slate-800 text-white text-sm px-3.5 py-2 rounded-lg hover:bg-slate-900">
            <Plus size={15} /> 新增客戶
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
<table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 text-xs border-b border-slate-100">
            <th className="px-4 py-2.5 font-medium">客戶編號</th>
            <th className="px-4 py-2.5 font-medium">名稱</th>
            <th className="px-4 py-2.5 font-medium">統一編號</th>
            <th className="px-4 py-2.5 font-medium">聯絡人</th>
            <th className="px-4 py-2.5 font-medium">電話</th>
            <th className="px-4 py-2.5 font-medium">地址</th>
            <th className="px-4 py-2.5 font-medium">類型</th>
            <th className="px-4 py-2.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((c) => (
            <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="px-4 py-2.5 text-slate-400 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{c.id}</td>
              <td className="px-4 py-2.5 font-medium text-slate-700">{c.name}</td>
              <td className="px-4 py-2.5 text-slate-500 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{c.taxId || "—"}</td>
              <td className="px-4 py-2.5">{c.contact}</td>
              <td className="px-4 py-2.5">{c.phone}</td>
              <td className="px-4 py-2.5 text-slate-500">{c.address}</td>
              <td className="px-4 py-2.5"><Badge tone="teal">{c.type}</Badge></td>
              <td className="px-4 py-2.5">
                <div className="flex gap-2 justify-end">
                  <button onClick={() => openEdit(c)} className="text-slate-400 hover:text-slate-800"><Pencil size={14} /></button>
                  <button onClick={() => remove(c.id)} className="text-slate-400 hover:text-rose-500"><Trash2 size={14} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
</div>

      {modal && (
        <Modal title={modal === "add" ? "新增客戶" : "編輯客戶"} onClose={() => setModal(null)}>
          <Field label="客戶名稱"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="統一編號">
            <input
              className={inputCls + (taxIdError ? " border-rose-400 focus:ring-rose-300 focus:border-rose-400" : "")}
              maxLength={8}
              value={form.taxId || ""}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 8); setForm({ ...form, taxId: v }); setTaxIdError(""); }}
              placeholder="8 碼數字，例：12345678"
            />
            {taxIdError && <div className="text-xs text-rose-500 mt-1">{taxIdError}</div>}
          </Field>
          <Field label="聯絡人"><input className={inputCls} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
          <Field label="電話"><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="地址"><input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="客戶類型">
            <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option>一般</option><option>租賃</option><option>一般+租賃</option>
            </select>
          </Field>
          <button onClick={save} className="w-full bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium mt-2 hover:bg-slate-900">儲存</button>
        </Modal>
      )}

      {importOpen && (
        <CsvImportModal
          title="批次匯入客戶（CSV）"
          hint={<>請使用 UTF-8 編碼的 CSV 檔案，欄位標題需包含：<b className="text-slate-700">客戶名稱、統一編號、聯絡人、電話、地址、類型</b>。「統一編號」須為 8 碼數字且不可與現有客戶或檔案內其他列重複。</>}
          headers={CUSTOMER_CSV_HEADERS}
          sampleRows={[["彩苑範例股份有限公司", "00000000", "陳先生", "02-1234-5678", "台北市中山區範例路1號", "一般"]]}
          templateFileName="客戶匯入範本.csv"
          normalizeRows={normalizeCustomerRows}
          previewCols={[
            { key: "name", label: "名稱" },
            { key: "taxId", label: "統一編號" },
            { key: "contact", label: "聯絡人" },
            { key: "phone", label: "電話" },
            { key: "type", label: "類型" },
          ]}
          onConfirm={confirmImportCustomers}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------- 商品庫存 ---------------------------------- */
const DEFAULT_PRODUCT_CATEGORIES = ["機器", "耗材", "零件"];
const CATEGORY_TONES = ["teal", "amber", "slate", "green", "red"];
const PRODUCT_CSV_HEADERS = ["商品名稱", "分類", "規格", "成本", "售價", "庫存數量", "單位", "安全庫存"];

function ProductsTab({ products, setProducts, categories, setCategories }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [cat, setCat] = useState("全部");
  const [importOpen, setImportOpen] = useState(false);
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  // products 透過 Supabase 非同步載入時，把資料裡新出現的分類自動併入清單
  useEffect(() => {
    const fromData = Array.from(new Set(products.map((p) => p.category).filter(Boolean)));
    setCategories((prev) => Array.from(new Set([...prev, ...fromData])));
  }, [products]);

  const categoryTone = (c) => {
    const idx = categories.indexOf(c);
    return CATEGORY_TONES[idx >= 0 ? idx % CATEGORY_TONES.length : 0];
  };

  const addCategory = (name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    if (categories.includes(trimmed)) return trimmed;
    setCategories((prev) => [...prev, trimmed]);
    return trimmed;
  };
  const submitNewCategory = () => {
    const added = addCategory(newCatName);
    if (added) { setForm((f) => (f ? { ...f, category: added } : f)); setCat(added); }
    setNewCatName("");
    setAddingCat(false);
  };
  const removeCategory = (c) => {
    if (products.some((p) => p.category === c)) return; // 仍有商品使用中，不可刪除
    setCategories((prev) => prev.filter((x) => x !== c));
    if (cat === c) setCat("全部");
  };

  const openAdd = () => { setForm({ name: "", category: categories[0] || "未分類", spec: "", cost: 0, price: 0, stock: 0, unit: "台", reorder: 5 }); setModal("add"); };
  const openEdit = (p) => { setForm(p); setModal("edit"); };
  const save = () => {
    if (!form.name) return;
    const clean = { ...form, cost: +form.cost, price: +form.price, stock: +form.stock, reorder: +form.reorder };
    if (modal === "add") setProducts([...products, { ...clean, id: nextId("P") }]);
    else setProducts(products.map((p) => (p.id === form.id ? clean : p)));
    setModal(null);
  };
  const remove = (id) => setProducts(products.filter((p) => p.id !== id));
  const cats = ["全部", ...categories];
  const filtered = cat === "全部" ? products : products.filter((p) => p.category === cat);

  /* -------- 批次匯入（CSV 內出現的新分類會自動加入分類清單） -------- */
  const normalizeProductRows = (data) => {
    const importedCats = new Set();
    const rows = data.map((raw) => {
      const name = (raw["商品名稱"] || raw["name"] || "").trim();
      let category = (raw["分類"] || raw["category"] || "").trim();
      if (!category) category = categories[0] || "未分類";
      else importedCats.add(category);
      const spec = (raw["規格"] || raw["spec"] || "").trim();
      const cost = Number((raw["成本"] || raw["cost"] || "0").toString().replace(/[^0-9.\-]/g, ""));
      const price = Number((raw["售價"] || raw["price"] || "0").toString().replace(/[^0-9.\-]/g, ""));
      const stock = Number((raw["庫存數量"] || raw["庫存"] || raw["stock"] || "0").toString().replace(/[^0-9.\-]/g, ""));
      const unit = (raw["單位"] || raw["unit"] || "個").trim() || "個";
      const reorder = Number((raw["安全庫存"] || raw["reorder"] || "0").toString().replace(/[^0-9.\-]/g, ""));

      const errors = [];
      if (!name) errors.push("缺少商品名稱");
      if (Number.isNaN(cost) || cost < 0) errors.push("成本須為數字");
      if (Number.isNaN(price) || price < 0) errors.push("售價須為數字");
      if (Number.isNaN(stock) || stock < 0) errors.push("庫存數量須為數字");
      if (Number.isNaN(reorder) || reorder < 0) errors.push("安全庫存須為數字");
      if (products.some((p) => p.name === name && p.spec === spec) && name) errors.push("與現有商品名稱+規格重複");

      return { name, category, spec, cost, price, stock, unit, reorder, errors, ok: errors.length === 0, include: errors.length === 0, isNewCategory: importedCats.has(category) && !categories.includes(category) };
    });
    return rows;
  };

  const confirmImportProducts = (toAdd) => {
    const newProducts = toAdd.map((r) => ({
      id: nextId("P"), name: r.name, category: r.category, spec: r.spec, cost: r.cost, price: r.price, stock: r.stock, unit: r.unit, reorder: r.reorder,
    }));
    const newCats = Array.from(new Set(toAdd.map((r) => r.category))).filter((c) => !categories.includes(c));
    if (newCats.length) setCategories((prev) => [...prev, ...newCats]);
    setProducts([...products, ...newProducts]);
    setImportOpen(false);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between p-4 border-b border-slate-100 flex-wrap gap-2">
        <div className="flex items-center flex-wrap gap-1.5">
          {cats.map((c) => (
            <div key={c} className="group relative">
              <button onClick={() => setCat(c)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${cat === c ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                {c}
              </button>
              {c !== "全部" && !products.some((p) => p.category === c) && (
                <button
                  onClick={() => removeCategory(c)}
                  title="刪除此分類（無商品使用中）"
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-300 text-white text-[10px] leading-4 opacity-0 group-hover:opacity-100 hover:bg-rose-500"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {addingCat ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-28"
                placeholder="新分類名稱"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitNewCategory(); if (e.key === "Escape") { setAddingCat(false); setNewCatName(""); } }}
              />
              <button onClick={submitNewCategory} className="text-xs bg-slate-800 text-white rounded-lg px-2 py-1.5">新增</button>
              <button onClick={() => { setAddingCat(false); setNewCatName(""); }} className="text-slate-300 hover:text-slate-600"><X size={14} /></button>
            </div>
          ) : (
            <button onClick={() => setAddingCat(true)} className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-dashed border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600 flex items-center gap-1">
              <Plus size={12} /> 新增分類
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setImportOpen(true)} className="flex items-center gap-1.5 border border-slate-200 text-slate-600 text-sm px-3.5 py-2 rounded-lg hover:bg-slate-50">
            <Upload size={15} /> 批次匯入
          </button>
          <button onClick={openAdd} className="flex items-center gap-1.5 bg-slate-800 text-white text-sm px-3.5 py-2 rounded-lg hover:bg-slate-900">
            <Plus size={15} /> 新增商品
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
<table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 text-xs border-b border-slate-100">
            <th className="px-4 py-2.5 font-medium">編號</th>
            <th className="px-4 py-2.5 font-medium">品名 / 規格</th>
            <th className="px-4 py-2.5 font-medium">分類</th>
            <th className="px-4 py-2.5 font-medium">成本</th>
            <th className="px-4 py-2.5 font-medium">售價</th>
            <th className="px-4 py-2.5 font-medium">庫存</th>
            <th className="px-4 py-2.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="px-4 py-2.5 text-slate-400 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{p.id}</td>
              <td className="px-4 py-2.5">
                <div className="font-medium text-slate-700">{p.name}</div>
                <div className="text-xs text-slate-400">{p.spec}</div>
              </td>
              <td className="px-4 py-2.5"><Badge tone={categoryTone(p.category)}>{p.category}</Badge></td>
              <td className="px-4 py-2.5 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(p.cost)}</td>
              <td className="px-4 py-2.5 tabular-nums font-medium" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(p.price)}</td>
              <td className="px-4 py-2.5">
                <span className={`tabular-nums font-medium ${p.stock <= p.reorder ? "text-rose-500" : "text-slate-700"}`} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  {p.stock} {p.unit}
                </span>
                {p.stock <= p.reorder && <AlertTriangle size={12} className="inline ml-1.5 text-rose-500" />}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex gap-2 justify-end">
                  <button onClick={() => openEdit(p)} className="text-slate-400 hover:text-slate-800"><Pencil size={14} /></button>
                  <button onClick={() => remove(p.id)} className="text-slate-400 hover:text-rose-500"><Trash2 size={14} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
</div>

      {modal && (
        <Modal title={modal === "add" ? "新增商品" : "編輯商品"} onClose={() => setModal(null)}>
          <Field label="品名"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="規格"><input className={inputCls} value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} /></Field>
          <Field label="分類">
            <div className="flex gap-2">
              <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button
                type="button"
                onClick={() => {
                  const name = window.prompt("輸入新分類名稱");
                  const added = addCategory(name);
                  if (added) setForm((f) => ({ ...f, category: added }));
                }}
                className="shrink-0 px-3 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700 text-sm"
              >
                <Plus size={14} />
              </button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="成本"><input type="number" className={inputCls} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
            <Field label="售價"><input type="number" className={inputCls} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="庫存數量"><input type="number" className={inputCls} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></Field>
            <Field label="單位"><input className={inputCls} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
            <Field label="安全庫存"><input type="number" className={inputCls} value={form.reorder} onChange={(e) => setForm({ ...form, reorder: e.target.value })} /></Field>
          </div>
          <button onClick={save} className="w-full bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium mt-2 hover:bg-slate-900">儲存</button>
        </Modal>
      )}

      {importOpen && (
        <CsvImportModal
          title="批次匯入商品（CSV）"
          hint={<>請使用 UTF-8 編碼的 CSV 檔案，欄位標題需包含：<b className="text-slate-700">商品名稱、分類、規格、成本、售價、庫存數量、單位、安全庫存</b>。「分類」可自由填寫，若為新分類會自動加入分類清單（留空則預設第一個分類），數字欄位需為數字。</>}
          headers={PRODUCT_CSV_HEADERS}
          sampleRows={[["Canon NPG-99 碳粉匣", "耗材", "適用 iR-ADV 系列", "1200", "1980", "20", "支", "10"]]}
          templateFileName="商品匯入範本.csv"
          normalizeRows={normalizeProductRows}
          previewCols={[
            { key: "name", label: "名稱" },
            { key: "category", label: "分類", format: (r) => (r.isNewCategory ? `${r.category}（新分類）` : r.category) },
            { key: "spec", label: "規格" },
            { key: "cost", label: "成本", format: (r) => fmt(r.cost) },
            { key: "price", label: "售價", format: (r) => fmt(r.price) },
            { key: "stock", label: "庫存", format: (r) => `${r.stock} ${r.unit}` },
          ]}
          onConfirm={confirmImportProducts}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
/* ---------------------------------- 銷售訂單 ---------------------------------- */
const SALES_STATUSES = ["待出貨", "已出貨", "已取消"];
const SALES_CSV_HEADERS = ["訂單編號", "日期", "客戶統一編號", "客戶名稱", "商品編號", "商品名稱", "數量", "單價", "狀態"];
const PAYMENT_METHODS = ["現金", "匯款轉帳", "信用卡"];

function SalesTab({ salesOrders, setSalesOrders, customers, products, custName, prodName, addArRecord }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const openAdd = () => setForm({ date: todayStr(), customerId: customers[0]?.id || "", status: "待出貨", items: [{ productId: products[0]?.id || "", qty: 1, price: products[0]?.price || 0 }] });
  const addItem = () => setForm({ ...form, items: [...form.items, { productId: products[0]?.id || "", qty: 1, price: products[0]?.price || 0 }] });
  const updItem = (i, key, val) => {
    const items = [...form.items];
    items[i] = { ...items[i], [key]: val };
    if (key === "productId") items[i].price = products.find((p) => p.id === val)?.price || 0;
    setForm({ ...form, items });
  };
  const rmItem = (i) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });
  const save = () => {
    setSalesOrders([{ ...form, id: nextId("SO") }, ...salesOrders]);
    setModal(false);
  };
  const remove = (id) => setSalesOrders(salesOrders.filter((o) => o.id !== id));
  const setStatus = (id, status) => {
    setSalesOrders(salesOrders.map((o) => (o.id === id ? { ...o, status } : o)));
    if (status === "已出貨") {
      const o = salesOrders.find((x) => x.id === id);
      if (o) {
        const total = o.items.reduce((a, i) => a + i.qty * i.price, 0);
        addArRecord({ sourceType: "銷售", sourceNo: o.id, customerId: o.customerId, docDate: o.date, dueDate: addMonths(o.date, 1), amount: total });
      }
    }
  };

  /* -------- 批次匯入（同「訂單編號」的多列會合併成同一張訂單的多個品項） -------- */
  const resolveSalesCustomer = (raw) => {
    const taxId = (raw["客戶統一編號"] || raw["taxId"] || "").toString().replace(/\D/g, "");
    const name = (raw["客戶名稱"] || raw["customerName"] || "").trim();
    if (taxId) { const c = customers.find((c) => c.taxId === taxId); if (c) return c; }
    if (name) { const c = customers.find((c) => c.name === name); if (c) return c; }
    return null;
  };
  const resolveSalesProduct = (raw) => {
    const pid = (raw["商品編號"] || raw["productId"] || "").trim();
    const pname = (raw["商品名稱"] || raw["productName"] || "").trim();
    if (pid) { const p = products.find((p) => p.id === pid); if (p) return p; }
    if (pname) { const p = products.find((p) => p.name === pname); if (p) return p; }
    return null;
  };

  const normalizeSalesRows = (data) => {
    const prelim = data.map((raw, idx) => {
      const groupKeyRaw = (raw["訂單編號"] || raw["orderRef"] || "").trim();
      const groupKey = groupKeyRaw || `__row_${idx}`;
      let date = (raw["日期"] || raw["date"] || "").trim() || todayStr();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = todayStr();

      const customer = resolveSalesCustomer(raw);
      const product = resolveSalesProduct(raw);
      const qty = Number((raw["數量"] || raw["qty"] || "").toString().replace(/[^0-9.\-]/g, ""));
      const priceRaw = (raw["單價"] || raw["price"] || "").toString().trim();
      const price = priceRaw ? Number(priceRaw.replace(/[^0-9.\-]/g, "")) : product?.price;
      let status = (raw["狀態"] || raw["status"] || "待出貨").trim();
      if (!SALES_STATUSES.includes(status)) status = "待出貨";

      const errors = [];
      if (!customer) errors.push("找不到客戶（統一編號或名稱）");
      if (!product) errors.push("找不到商品（編號或名稱）");
      if (!qty || Number.isNaN(qty) || qty <= 0) errors.push("數量須為大於 0 的數字");
      if (price === undefined || Number.isNaN(price) || price < 0) errors.push("單價須為數字");

      return {
        groupKey, groupKeyRaw, date, status,
        customerId: customer?.id, customerName: customer?.name,
        productId: product?.id, productName: product?.name,
        qty, price, errors,
      };
    });

    const groups = {};
    prelim.forEach((r) => { (groups[r.groupKey] = groups[r.groupKey] || []).push(r); });
    Object.values(groups).forEach((rowsInGroup) => {
      const ref = rowsInGroup.find((r) => r.errors.length === 0) || rowsInGroup[0];
      rowsInGroup.forEach((r) => {
        if (r.errors.length > 0 || r === ref) return;
        if (r.customerId !== ref.customerId) r.errors.push("與同單號其他列客戶不一致");
        if (r.date !== ref.date) r.errors.push("與同單號其他列日期不一致");
        if (r.status !== ref.status) r.errors.push("與同單號其他列狀態不一致");
      });
    });

    return prelim.map((r) => ({ ...r, ok: r.errors.length === 0, include: r.errors.length === 0 }));
  };

  const confirmImportSales = (toAddRows) => {
    const groups = {};
    toAddRows.forEach((r) => { (groups[r.groupKey] = groups[r.groupKey] || []).push(r); });
    const newOrders = Object.values(groups).map((rowsInGroup) => ({
      id: nextId("SO"),
      date: rowsInGroup[0].date,
      customerId: rowsInGroup[0].customerId,
      status: rowsInGroup[0].status,
      items: rowsInGroup.map((r) => ({ productId: r.productId, qty: r.qty, price: r.price })),
    }));
    setSalesOrders([...newOrders, ...salesOrders]);
    newOrders.forEach((o) => {
      if (o.status === "已出貨") {
        const total = o.items.reduce((a, i) => a + i.qty * i.price, 0);
        addArRecord({ sourceType: "銷售", sourceNo: o.id, customerId: o.customerId, docDate: o.date, dueDate: addMonths(o.date, 1), amount: total });
      }
    });
    setImportOpen(false);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between p-4 border-b border-slate-100 flex-wrap gap-2">
        <h3 className="text-sm text-slate-500">共 {salesOrders.length} 筆訂單</h3>
        <div className="flex gap-2">
          <button onClick={() => setImportOpen(true)} className="flex items-center gap-1.5 border border-slate-200 text-slate-600 text-sm px-3.5 py-2 rounded-lg hover:bg-slate-50">
            <Upload size={15} /> 批次匯入
          </button>
          <button onClick={() => { openAdd(); setModal(true); }} className="flex items-center gap-1.5 bg-slate-800 text-white text-sm px-3.5 py-2 rounded-lg hover:bg-slate-900">
            <Plus size={15} /> 新增銷售訂單
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
<table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 text-xs border-b border-slate-100">
            <th className="px-4 py-2.5 font-medium">訂單編號</th>
            <th className="px-4 py-2.5 font-medium">日期</th>
            <th className="px-4 py-2.5 font-medium">客戶</th>
            <th className="px-4 py-2.5 font-medium">品項</th>
            <th className="px-4 py-2.5 font-medium">總金額</th>
            <th className="px-4 py-2.5 font-medium">狀態</th>
            <th className="px-4 py-2.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {salesOrders.map((o) => {
            const total = o.items.reduce((a, i) => a + i.qty * i.price, 0);
            return (
              <tr key={o.id} className="border-b border-slate-50 hover:bg-slate-50/60 align-top">
                <td className="px-4 py-2.5 text-slate-400 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{o.id}</td>
                <td className="px-4 py-2.5">{o.date}</td>
                <td className="px-4 py-2.5 font-medium text-slate-700">{custName(o.customerId)}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">
                  {o.items.map((i, idx) => <div key={idx}>{prodName(i.productId)} × {i.qty}</div>)}
                </td>
                <td className="px-4 py-2.5 font-semibold tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(total)}</td>
                <td className="px-4 py-2.5">
                  <select value={o.status} onChange={(e) => setStatus(o.id, e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1">
                    <option>待出貨</option><option>已出貨</option><option>已取消</option>
                  </select>
                </td>
                <td className="px-4 py-2.5"><button onClick={() => remove(o.id)} className="text-slate-400 hover:text-rose-500"><Trash2 size={14} /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
</div>

      {modal && form && (
        <Modal title="新增銷售訂單" onClose={() => setModal(false)} wide>
          <div className="grid grid-cols-2 gap-3">
            <Field label="日期"><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="客戶">
              <select className={inputCls} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-2">
            <div className="text-xs font-medium text-slate-500 mb-2">訂單品項</div>
            {form.items.map((it, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <div className="flex-1 min-w-0">
                  <ProductSearchSelect products={products} value={it.productId} onChange={(val) => updItem(i, "productId", val)} />
                </div>
                <div className="w-20 shrink-0">
                  <input type="number" min="1" className={inputCls} value={it.qty} onChange={(e) => updItem(i, "qty", +e.target.value)} />
                </div>
                <div className="w-28 shrink-0">
                  <input type="number" className={inputCls} value={it.price} onChange={(e) => updItem(i, "price", +e.target.value)} />
                </div>
                <button onClick={() => rmItem(i)} className="text-slate-300 hover:text-rose-500"><X size={16} /></button>
              </div>
            ))}
            <button onClick={addItem} className="text-xs text-slate-800 font-medium flex items-center gap-1 mt-1"><Plus size={13} /> 新增品項</button>
          </div>
          <div className="text-right font-semibold mt-4 mb-2 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
            合計：{fmt(form.items.reduce((a, i) => a + i.qty * i.price, 0))}
          </div>
          <button onClick={save} className="w-full bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-900">建立訂單</button>
        </Modal>
      )}

      {importOpen && (
        <CsvImportModal
          title="批次匯入銷售訂單（CSV）"
          hint={
            <>
              請使用 UTF-8 編碼的 CSV 檔案，一列代表一個品項；<b className="text-slate-700">同「訂單編號」的多列會合併成同一張訂單的多個品項</b>（訂單編號留空則每列各自成一張訂單）。
              客戶可用「客戶統一編號」或「客戶名稱」比對，商品可用「商品編號」或「商品名稱」比對；「單價」留空則自動帶入商品目前售價。同一訂單編號的客戶／日期／狀態需一致。
            </>
          }
          headers={SALES_CSV_HEADERS}
          sampleRows={[
            ["ORDER-A", "2026-07-05", "23456781", "群光電子股份有限公司", "P-0002", "HP LaserJet Pro M404dn", "2", "9800", "待出貨"],
            ["ORDER-A", "2026-07-05", "23456781", "群光電子股份有限公司", "P-0005", "HP CF259A 碳粉匣", "4", "1880", "待出貨"],
          ]}
          templateFileName="銷售訂單匯入範本.csv"
          normalizeRows={normalizeSalesRows}
          previewCols={[
            { key: "groupKeyRaw", label: "訂單參照", format: (r) => r.groupKeyRaw || "（單列成單）" },
            { key: "date", label: "日期" },
            { key: "customerName", label: "客戶", format: (r) => r.customerName || "—" },
            { key: "productName", label: "商品", format: (r) => r.productName || "—" },
            { key: "qty", label: "數量" },
            { key: "price", label: "單價", format: (r) => (r.price !== undefined && !Number.isNaN(r.price) ? fmt(r.price) : "—") },
            { key: "status", label: "狀態" },
          ]}
          onConfirm={confirmImportSales}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------- 銷售單（現場結帳） ---------------------------------- */
function PosTab({ posSales, setPosSales, customers, products, setProducts, custName, prodName }) {
  const blankCart = () => ({ date: todayStr(), customerId: "", paymentMethod: PAYMENT_METHODS[0], items: [{ productId: products[0]?.id || "", qty: 1, price: products[0]?.price || 0 }] });
  const [cart, setCart] = useState(blankCart());
  const [receipt, setReceipt] = useState(null);
  const [voidTarget, setVoidTarget] = useState(null);

  const addItem = () => setCart({ ...cart, items: [...cart.items, { productId: products[0]?.id || "", qty: 1, price: products[0]?.price || 0 }] });
  const updItem = (i, key, val) => {
    const items = [...cart.items];
    items[i] = { ...items[i], [key]: val };
    if (key === "productId") items[i].price = products.find((p) => p.id === val)?.price || 0;
    setCart({ ...cart, items });
  };
  const rmItem = (i) => setCart({ ...cart, items: cart.items.filter((_, idx) => idx !== i) });

  const total = cart.items.reduce((a, i) => a + i.qty * i.price, 0);
  const stockOf = (id) => products.find((p) => p.id === id)?.stock ?? 0;
  const overStockItems = cart.items.filter((it) => it.productId && it.qty > stockOf(it.productId));
  const canCheckout = !!cart.date && cart.items.length > 0 && cart.items.every((it) => it.productId && it.qty > 0) && overStockItems.length === 0;

  const checkout = () => {
    if (!canCheckout) return;
    const sale = {
      id: nextId("POS"),
      date: cart.date || todayStr(),
      time: cart.date && cart.date !== todayStr() ? "—" : new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }),
      customerId: cart.customerId || null,
      paymentMethod: cart.paymentMethod,
      items: cart.items.map((it) => ({ ...it })),
      total,
    };
    setPosSales([sale, ...posSales]);
    setProducts(products.map((p) => {
      const it = sale.items.find((i) => i.productId === p.id);
      return it ? { ...p, stock: p.stock - it.qty } : p;
    }));
    setCart(blankCart());
    setReceipt(sale);
  };

  const confirmVoid = () => {
    if (!voidTarget) return;
    setPosSales(posSales.filter((s) => s.id !== voidTarget.id));
    setProducts(products.map((p) => {
      const it = voidTarget.items.find((i) => i.productId === p.id);
      return it ? { ...p, stock: p.stock + it.qty } : p;
    }));
    setVoidTarget(null);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5"><ShoppingBag size={15} /> 現場結帳</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div className="min-w-0">
            <Field label="交易日期">
              <input type="date" className={inputCls + " min-w-0"} value={cart.date} onChange={(e) => setCart({ ...cart, date: e.target.value })} />
            </Field>
          </div>
          <div className="min-w-0">
            <Field label="客戶（可留空為現場客戶）">
              <select className={inputCls} value={cart.customerId} onChange={(e) => setCart({ ...cart, customerId: e.target.value })}>
                <option value="">現場客戶（不指定）</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="min-w-0">
            <Field label="付款方式">
              <select className={inputCls} value={cart.paymentMethod} onChange={(e) => setCart({ ...cart, paymentMethod: e.target.value })}>
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <div className="text-xs font-medium text-slate-500 mb-2">商品項目</div>
        {cart.items.map((it, i) => {
          const over = it.productId && it.qty > stockOf(it.productId);
          return (
            <div key={i} className="mb-2">
              <div className="flex gap-2 items-center">
                <div className="flex-1 min-w-0">
                  <ProductSearchSelect products={products} value={it.productId} onChange={(val) => updItem(i, "productId", val)} />
                </div>
                <div className="w-20 shrink-0">
                  <input type="number" min="1" className={inputCls} value={it.qty} onChange={(e) => updItem(i, "qty", +e.target.value)} />
                </div>
                <div className="w-28 shrink-0">
                  <input type="number" className={inputCls} value={it.price} onChange={(e) => updItem(i, "price", +e.target.value)} />
                </div>
                <button onClick={() => rmItem(i)} className="text-slate-300 hover:text-rose-500"><X size={16} /></button>
              </div>
              {over && <div className="text-xs text-rose-500 mt-1">庫存不足（現有 {stockOf(it.productId)}，庫存量無法完成此筆數量）</div>}
            </div>
          );
        })}
        <button onClick={addItem} className="text-xs text-slate-800 font-medium flex items-center gap-1 mt-1"><Plus size={13} /> 新增品項</button>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
          <div className="text-sm text-slate-500">共 {cart.items.length} 項</div>
          <div className="text-right font-semibold tabular-nums text-lg" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
            合計：{fmt(total)}
          </div>
        </div>
        <button
          onClick={checkout}
          disabled={!canCheckout}
          className="w-full mt-3 bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-900 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          <CreditCard size={15} /> 完成結帳
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h3 className="text-sm text-slate-500">今日已結帳 {posSales.filter((s) => s.date === todayStr()).length} 筆 · 共 {posSales.length} 筆歷史紀錄</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs border-b border-slate-100">
                <th className="px-4 py-2.5 font-medium">單號</th>
                <th className="px-4 py-2.5 font-medium">日期時間</th>
                <th className="px-4 py-2.5 font-medium">客戶</th>
                <th className="px-4 py-2.5 font-medium">品項</th>
                <th className="px-4 py-2.5 font-medium">付款方式</th>
                <th className="px-4 py-2.5 font-medium">總金額</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {posSales.length === 0 && (
                <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-400 text-sm">尚無結帳紀錄</td></tr>
              )}
              {posSales.map((s) => (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/60 align-top">
                  <td className="px-4 py-2.5 text-slate-400 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{s.id}</td>
                  <td className="px-4 py-2.5">{s.date} {s.time}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-700">{s.customerId ? custName(s.customerId) : "現場客戶"}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">
                    {s.items.map((i, idx) => <div key={idx}>{prodName(i.productId)} × {i.qty}</div>)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 text-xs">{s.paymentMethod}</td>
                  <td className="px-4 py-2.5 font-semibold tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(s.total)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setReceipt(s)} className="text-slate-400 hover:text-slate-700" title="檢視 / 列印"><Receipt size={14} /></button>
                      <button onClick={() => setVoidTarget(s)} className="text-slate-400 hover:text-rose-500" title="作廢並回補庫存"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {receipt && (
        <ReceiptPreview
          sale={receipt}
          customer={receipt.customerId ? customers.find((c) => c.id === receipt.customerId) : null}
          prodName={prodName}
          onClose={() => setReceipt(null)}
        />
      )}

      {voidTarget && (
        <Modal title="作廢銷售單" onClose={() => setVoidTarget(null)}>
          <p className="text-sm text-slate-600 mb-4">
            確定要作廢單號 <span className="font-medium text-slate-800">{voidTarget.id}</span> 嗎？作廢後將自動回補對應商品庫存，且此動作無法復原。
          </p>
          <div className="flex gap-2">
            <button onClick={() => setVoidTarget(null)} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
            <button onClick={confirmVoid} className="flex-1 bg-rose-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-rose-700">確定作廢</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ReceiptPreview({ sale, customer, prodName, onClose }) {
  const printRef = useRef(null);
  const handlePrint = () => printRef.current && printHtml(cloneWithFormValues(printRef.current).outerHTML, `銷售單 ${sale.id}`);
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-y-auto" style={{ maxHeight: "90vh" }}>
        <div className="no-print flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-xl z-10">
          <div>
            <h3 className="font-semibold text-slate-800">銷售單預覽</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="flex items-center gap-1.5 bg-slate-800 text-white text-sm px-4 py-2 rounded-lg hover:bg-slate-900">
              <Receipt size={15} /> 列印 / 另存 PDF
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-2"><X size={18} /></button>
          </div>
        </div>

        <div ref={printRef} className="invoice-print-area bg-white text-slate-800 p-6">
          <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-11 h-11 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-1">
                <img src={LOGO_DATA_URI} alt="彩苑科技 logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <div className="text-base font-bold">彩苑科技有限公司</div>
                <div className="text-xs text-slate-500">CAIYUAN TECHNOLOGY CO., LTD.</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold tracking-wide">銷售單</div>
              <div className="text-xs text-slate-500">RECEIPT</div>
            </div>
          </div>

          <div className="text-sm space-y-1 mb-4">
            <div className="flex justify-between"><span className="text-slate-500">單號</span><span className="tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{sale.id}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">日期時間</span><span>{sale.date} {sale.time}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">客戶</span><span>{customer ? customer.name : "現場客戶"}</span></div>
            {customer?.taxId && <div className="flex justify-between"><span className="text-slate-500">統一編號</span><span>{customer.taxId}</span></div>}
            <div className="flex justify-between"><span className="text-slate-500">付款方式</span><span>{sale.paymentMethod}</span></div>
          </div>

          <table className="w-full text-sm border border-slate-300 mb-4">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-2 py-1.5">品名</th>
                <th className="border border-slate-300 px-2 py-1.5 text-right">數量</th>
                <th className="border border-slate-300 px-2 py-1.5 text-right">單價</th>
                <th className="border border-slate-300 px-2 py-1.5 text-right">小計</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((it, idx) => (
                <tr key={idx}>
                  <td className="border border-slate-300 px-2 py-1.5">{prodName(it.productId)}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right">{it.qty}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{fmt(it.price)}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{fmt(it.qty * it.price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3" className="border border-slate-300 px-2 py-1.5 text-right font-semibold">總計</td>
                <td className="border border-slate-300 px-2 py-1.5 text-right font-bold tabular-nums">{fmt(sale.total)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="text-center text-xs text-slate-400 mt-6">感謝您的惠顧 · 本單據為交易憑證</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- 採購訂單 ---------------------------------- */
function PurchaseTab({ purchaseOrders, setPurchaseOrders, products, setProducts, prodName }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(null);

  const openAdd = () => setForm({ date: todayStr(), supplier: "", status: "訂購中", items: [{ productId: products[0]?.id || "", qty: 1, cost: products[0]?.cost || 0 }] });
  const addItem = () => setForm({ ...form, items: [...form.items, { productId: products[0]?.id || "", qty: 1, cost: products[0]?.cost || 0 }] });
  const updItem = (i, key, val) => {
    const items = [...form.items];
    items[i] = { ...items[i], [key]: val };
    if (key === "productId") items[i].cost = products.find((p) => p.id === val)?.cost || 0;
    setForm({ ...form, items });
  };
  const rmItem = (i) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });
  const save = () => {
    setPurchaseOrders([{ ...form, id: nextId("PO") }, ...purchaseOrders]);
    setModal(false);
  };
  const remove = (id) => setPurchaseOrders(purchaseOrders.filter((o) => o.id !== id));
  const setStatus = (o, status) => {
    if (status === "已入庫" && o.status !== "已入庫") {
      setProducts(products.map((p) => {
        const it = o.items.find((i) => i.productId === p.id);
        return it ? { ...p, stock: p.stock + it.qty } : p;
      }));
    }
    setPurchaseOrders(purchaseOrders.map((x) => (x.id === o.id ? { ...x, status } : x)));
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <h3 className="text-sm text-slate-500">共 {purchaseOrders.length} 筆採購單（狀態改為「已入庫」將自動加回庫存）</h3>
        <button onClick={() => { openAdd(); setModal(true); }} className="flex items-center gap-1.5 bg-slate-800 text-white text-sm px-3.5 py-2 rounded-lg hover:bg-slate-900">
          <Plus size={15} /> 新增採購單
        </button>
      </div>
      <div className="overflow-x-auto">
<table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 text-xs border-b border-slate-100">
            <th className="px-4 py-2.5 font-medium">採購編號</th>
            <th className="px-4 py-2.5 font-medium">日期</th>
            <th className="px-4 py-2.5 font-medium">供應商</th>
            <th className="px-4 py-2.5 font-medium">品項</th>
            <th className="px-4 py-2.5 font-medium">總金額</th>
            <th className="px-4 py-2.5 font-medium">狀態</th>
            <th className="px-4 py-2.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {purchaseOrders.map((o) => {
            const total = o.items.reduce((a, i) => a + i.qty * i.cost, 0);
            return (
              <tr key={o.id} className="border-b border-slate-50 hover:bg-slate-50/60 align-top">
                <td className="px-4 py-2.5 text-slate-400 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{o.id}</td>
                <td className="px-4 py-2.5">{o.date}</td>
                <td className="px-4 py-2.5 font-medium text-slate-700">{o.supplier}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">
                  {o.items.map((i, idx) => <div key={idx}>{prodName(i.productId)} × {i.qty}</div>)}
                </td>
                <td className="px-4 py-2.5 font-semibold tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(total)}</td>
                <td className="px-4 py-2.5">
                  <select value={o.status} onChange={(e) => setStatus(o, e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1">
                    <option>訂購中</option><option>已入庫</option><option>已取消</option>
                  </select>
                </td>
                <td className="px-4 py-2.5"><button onClick={() => remove(o.id)} className="text-slate-400 hover:text-rose-500"><Trash2 size={14} /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
</div>

      {modal && form && (
        <Modal title="新增採購單" onClose={() => setModal(false)} wide>
          <div className="grid grid-cols-2 gap-3">
            <Field label="日期"><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="供應商"><input className={inputCls} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="例如：台灣佳能股份有限公司" /></Field>
          </div>
          <div className="mt-2">
            <div className="text-xs font-medium text-slate-500 mb-2">採購品項</div>
            {form.items.map((it, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <select className={inputCls + " flex-1 min-w-0"} value={it.productId} onChange={(e) => updItem(i, "productId", e.target.value)}>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div className="w-20 shrink-0">
                  <input type="number" min="1" className={inputCls} value={it.qty} onChange={(e) => updItem(i, "qty", +e.target.value)} />
                </div>
                <div className="w-28 shrink-0">
                  <input type="number" className={inputCls} value={it.cost} onChange={(e) => updItem(i, "cost", +e.target.value)} />
                </div>
                <button onClick={() => rmItem(i)} className="text-slate-300 hover:text-rose-500"><X size={16} /></button>
              </div>
            ))}
            <button onClick={addItem} className="text-xs text-slate-800 font-medium flex items-center gap-1 mt-1"><Plus size={13} /> 新增品項</button>
          </div>
          <div className="text-right font-semibold mt-4 mb-2 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
            合計：{fmt(form.items.reduce((a, i) => a + i.qty * i.cost, 0))}
          </div>
          <button onClick={save} className="w-full bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-900">建立採購單</button>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------- 租賃管理 ---------------------------------- */
function LeaseTab({ leases, setLeases, customers, custName, addArRecord }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [meterModal, setMeterModal] = useState(null);
  const [meterVal, setMeterVal] = useState(0);
  const [invoiceModal, setInvoiceModal] = useState(null);

  const doPrint = (lease, meterOverride) => {
    const customer = customers.find((c) => c.id === lease.customerId);
    setInvoiceModal({ customer, items: [{ lease, meter: meterOverride !== undefined ? meterOverride : lease.currentMeter }] });
  };

  const doPrintCustomer = (customerId) => {
    const customer = customers.find((c) => c.id === customerId);
    const items = leases.filter((l) => l.customerId === customerId).map((l) => ({ lease: l, meter: l.currentMeter }));
    setInvoiceModal({ customer, items });
  };

  const groups = useMemo(() => {
    const order = [];
    const map = {};
    leases.forEach((l) => {
      if (!map[l.customerId]) { map[l.customerId] = []; order.push(l.customerId); }
      map[l.customerId].push(l);
    });
    return order.map((customerId) => ({ customerId, items: map[customerId] }));
  }, [leases]);

  const openAdd = () => {
    setForm({
      customerId: customers[0]?.id || "", machineName: "", serial: "", machineType: "雷射",
      startDate: todayStr(), endDate: addMonths(todayStr(), 12),
      monthlyRent: 2000, meterRate: 0.7, lastMeter: 0, currentMeter: 0, status: "租賃中",
    });
    setModal("add");
  };
  const openEdit = (l) => { setForm(l); setModal("edit"); };
  const save = () => {
    if (!form.machineName) return;
    const isLaser = (form.machineType || "雷射") === "雷射";
    const clean = {
      ...form,
      machineType: form.machineType || "雷射",
      monthlyRent: +form.monthlyRent,
      meterRate: isLaser ? +form.meterRate || 0 : 0,
      lastMeter: isLaser ? +form.lastMeter || 0 : 0,
      currentMeter: isLaser ? +form.currentMeter || 0 : 0,
    };
    if (modal === "add") setLeases([...leases, { ...clean, id: nextId("L") }]);
    else setLeases(leases.map((l) => (l.id === form.id ? clean : l)));
    setModal(null);
  };
  const remove = (id) => setLeases(leases.filter((l) => l.id !== id));

  const openMeter = (l) => { setMeterModal(l); setMeterVal(l.currentMeter); };
  const confirmBilling = () => {
    const l = meterModal;
    const isLaser = l.machineType === "雷射";
    const usage = isLaser ? Math.max(0, +meterVal - l.lastMeter) : 0;
    const amount = l.monthlyRent + usage * l.meterRate;
    addArRecord({
      sourceType: "租賃", sourceNo: l.id, customerId: l.customerId,
      docDate: todayStr(), dueDate: addMonths(todayStr(), 1), amount,
    });
    setLeases(leases.map((x) => (x.id === meterModal.id ? { ...x, lastMeter: x.currentMeter, currentMeter: +meterVal } : x)));
    setMeterModal(null);
  };
  const saveMeterReading = () => {
    setLeases(leases.map((l) => (l.id === meterModal.id ? { ...l, currentMeter: +meterVal } : l)));
    setMeterModal(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm text-slate-500">共 {leases.length} 台租賃機台 · 依張數（計數器）+ 月租金計費</h3>
        <button onClick={() => { openAdd(); }} className="flex items-center gap-1.5 bg-slate-800 text-white text-sm px-3.5 py-2 rounded-lg hover:bg-slate-900">
          <Plus size={15} /> 新增租賃合約
        </button>
      </div>

      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.customerId}>
            <div className="flex items-center justify-between mb-2.5 px-1">
              <div className="flex items-center gap-2">
                <Building2 size={15} className="text-slate-400" />
                <span className="font-semibold text-slate-700 text-sm">{custName(g.customerId)}</span>
                <Badge tone="slate">{g.items.length} 台機器</Badge>
              </div>
              {g.items.length > 1 && (
                <button onClick={() => doPrintCustomer(g.customerId)} className="flex items-center gap-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">
                  <Receipt size={13} /> 列印此客戶合併請款單（{g.items.length} 台）
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {g.items.map((l) => {
                const isLaser = l.machineType === "雷射";
                const usage = isLaser ? Math.max(0, l.currentMeter - l.lastMeter) : 0;
                const billing = l.monthlyRent + usage * l.meterRate;
                const dleft = daysUntil(l.endDate);
                return (
                  <div key={l.id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-semibold text-slate-800 flex items-center gap-2">
                          <Printer size={15} className="text-amber-600" /> {l.machineName}
                          <Badge tone={isLaser ? "teal" : "slate"}>{l.machineType || "雷射"}</Badge>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">序號 {l.serial}</div>
                      </div>
                      <Badge tone={l.status === "租賃中" ? (dleft <= 30 ? "amber" : "green") : "slate"}>
                        {l.status === "租賃中" && dleft <= 30 ? `${dleft}天後到期` : l.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-y-1.5 text-xs text-slate-500 mb-3">
                      <div>合約期間：{l.startDate} ~ {l.endDate}</div>
                      <div>月租金：<span className="text-slate-700 font-medium">{fmt(l.monthlyRent)}</span></div>
                      {isLaser ? (
                        <>
                          <div>每張計費：NT$ {l.meterRate}/張</div>
                          <div>本期用量：<span className="tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{usage.toLocaleString()}</span> 張</div>
                        </>
                      ) : (
                        <div className="col-span-2 text-slate-400">噴墨機僅收月租金，不計張數</div>
                      )}
                    </div>
                    <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 mb-3">
                      <span className="text-xs text-slate-500">本期應收合計</span>
                      <span className="font-bold text-slate-800 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(billing)}</span>
                    </div>
                    <div className="flex gap-2 text-xs">
                      {isLaser && (
                        <button onClick={() => openMeter(l)} className="flex-1 flex items-center justify-center gap-1 border border-slate-200 rounded-lg py-1.5 text-slate-600 hover:bg-slate-50"><Gauge size={13} /> 抄表 / 出帳</button>
                      )}
                      {!isLaser && (
                        <button
                          onClick={() => addArRecord({ sourceType: "租賃", sourceNo: l.id, customerId: l.customerId, docDate: todayStr(), dueDate: addMonths(todayStr(), 1), amount: billing })}
                          className="flex-1 flex items-center justify-center gap-1 border border-slate-200 rounded-lg py-1.5 text-slate-600 hover:bg-slate-50"
                        >
                          <Receipt size={13} /> 本期出帳（產生應收）
                        </button>
                      )}
                      <button onClick={() => doPrint(l)} className="flex-1 flex items-center justify-center gap-1 border border-slate-200 rounded-lg py-1.5 text-slate-600 hover:bg-slate-50"><Receipt size={13} /> 列印請款單</button>
                      <button onClick={() => openEdit(l)} className="flex items-center justify-center gap-1 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50"><Pencil size={13} /></button>
                      <button onClick={() => remove(l.id)} className="flex items-center justify-center gap-1 border border-slate-200 rounded-lg px-3 py-1.5 text-rose-500 hover:bg-rose-50"><Trash2 size={13} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <Modal title={modal === "add" ? "新增租賃合約" : "編輯租賃合約"} onClose={() => setModal(null)} wide>
          <div className="grid grid-cols-2 gap-3">
            <Field label="客戶">
              <select className={inputCls} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="狀態">
              <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option>租賃中</option><option>已到期</option><option>已終止</option>
              </select>
            </Field>
            <Field label="機型名稱"><input className={inputCls} value={form.machineName} onChange={(e) => setForm({ ...form, machineName: e.target.value })} /></Field>
            <Field label="機器序號"><input className={inputCls} value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} /></Field>
            <Field label="機器類型">
              <select className={inputCls} value={form.machineType || "雷射"} onChange={(e) => setForm({ ...form, machineType: e.target.value })}>
                <option value="雷射">雷射印表機（計張數 + 月租金）</option>
                <option value="噴墨">噴墨印表機（僅收月租金）</option>
              </select>
            </Field>
            <div></div>
            <Field label="合約起日"><input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="合約迄日"><input type="date" className={inputCls} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
            <Field label="月租金 (NT$)"><input type="number" className={inputCls} value={form.monthlyRent} onChange={(e) => setForm({ ...form, monthlyRent: e.target.value })} /></Field>
            {(form.machineType || "雷射") === "雷射" && (
              <>
                <Field label="每張計費 (NT$/張)"><input type="number" step="0.1" className={inputCls} value={form.meterRate} onChange={(e) => setForm({ ...form, meterRate: e.target.value })} /></Field>
                <Field label="上期計數器讀數"><input type="number" className={inputCls} value={form.lastMeter} onChange={(e) => setForm({ ...form, lastMeter: e.target.value })} /></Field>
                <Field label="本期計數器讀數"><input type="number" className={inputCls} value={form.currentMeter} onChange={(e) => setForm({ ...form, currentMeter: e.target.value })} /></Field>
              </>
            )}
          </div>
          <button onClick={save} className="w-full bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium mt-3 hover:bg-slate-900">儲存合約</button>
        </Modal>
      )}

      {meterModal && (
        <Modal title={`抄表 / 出帳 — ${meterModal.machineName}`} onClose={() => setMeterModal(null)}>
          <div className="text-xs text-slate-500 mb-3">上期讀數：<span className="font-medium text-slate-700 tabular-nums">{meterModal.lastMeter.toLocaleString()}</span> 張</div>
          <Field label="本期計數器讀數">
            <input type="number" className={inputCls} value={meterVal} onChange={(e) => setMeterVal(e.target.value)} />
          </Field>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-sm space-y-1 mb-4">
            <div className="flex justify-between text-slate-500"><span>本期用量</span><span className="tabular-nums text-slate-700">{Math.max(0, meterVal - meterModal.lastMeter).toLocaleString()} 張</span></div>
            <div className="flex justify-between text-slate-500"><span>張數費用</span><span className="tabular-nums text-slate-700">{fmt(Math.max(0, meterVal - meterModal.lastMeter) * meterModal.meterRate)}</span></div>
            <div className="flex justify-between text-slate-500"><span>月租金</span><span className="tabular-nums text-slate-700">{fmt(meterModal.monthlyRent)}</span></div>
            <div className="flex justify-between font-semibold text-slate-800 pt-1 border-t border-slate-200"><span>應收合計</span><span className="tabular-nums">{fmt(meterModal.monthlyRent + Math.max(0, meterVal - meterModal.lastMeter) * meterModal.meterRate)}</span></div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveMeterReading} className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm font-medium hover:bg-slate-50">僅更新讀數</button>
            <button onClick={confirmBilling} className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-900"><CheckCircle2 size={14} /> 確認出帳</button>
          </div>
          <button onClick={() => doPrint(meterModal, meterVal)} className="w-full flex items-center justify-center gap-1.5 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm font-medium mt-2 hover:bg-slate-50">
            <Receipt size={14} /> 列印本期請款單
          </button>
        </Modal>
      )}

      {invoiceModal && <InvoicePreview data={invoiceModal} onClose={() => setInvoiceModal(null)} />}
    </div>
  );
}

/* ---------------------------------- 租賃請款單預覽 / 列印 ---------------------------------- */
function InvoicePreview({ data, onClose }) {
  const { customer, items } = data;
  const rows = items.map(({ lease, meter }) => {
    const isLaser = lease.machineType === "雷射";
    const usage = isLaser ? Math.max(0, meter - lease.lastMeter) : 0;
    const meterFee = isLaser ? usage * lease.meterRate : 0;
    return { lease, meter, usage, meterFee, isLaser, subtotal: lease.monthlyRent + meterFee };
  });
  const total = rows.reduce((s, r) => s + r.subtotal, 0);
  const period = todayStr().slice(0, 7).replace("-", "");
  const invoiceNo = `INV-${customer?.id || "C"}-${period}`;
  const periodLabel = currentPeriodLabel();

  const [notes, setNotes] = useState({});
  const [remit, setRemit] = useState({ toCompany: true, account: "彩苑科技有限公司 · 台北富邦銀行長安東路分行 (代碼012) · 帳號 002-031-02601414" });
  const printRef = useRef(null);
  const handlePrint = () => printRef.current && printHtml(cloneWithFormValues(printRef.current).outerHTML, invoiceNo);

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-y-auto" style={{ maxHeight: "90vh" }}>
        <div className="no-print flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-xl z-10">
          <div>
            <h3 className="font-semibold text-slate-800">請款單預覽</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="flex items-center gap-1.5 bg-slate-800 text-white text-sm px-4 py-2 rounded-lg hover:bg-slate-900">
              <Receipt size={15} /> 列印 / 另存 PDF
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-2"><X size={18} /></button>
          </div>
        </div>

        <div ref={printRef} className="invoice-print-area bg-white text-slate-800 p-8">
          <div className="flex items-start justify-between border-b-2 border-slate-800 pb-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-1">
                <img src={LOGO_DATA_URI} alt="彩苑科技 logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <div className="text-xl font-bold">彩苑科技有限公司</div>
                <div className="text-xs text-slate-500">CAIYUAN TECHNOLOGY CO., LTD.</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tracking-wide">租賃請款單</div>
              <div className="text-xs text-slate-500 mt-1">INVOICE</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 text-sm mb-6">
            <div className="space-y-1">
              <div className="font-semibold text-slate-700 mb-1">客戶資訊</div>
              <div>客戶名稱：{customer?.name || "—"}</div>
              <div>統一編號：{customer?.taxId || "—"}</div>
              <div>聯絡人：{customer?.contact || "—"}</div>
              <div>電話：{customer?.phone || "—"}</div>
              <div>地址：{customer?.address || "—"}</div>
            </div>
            <div className="space-y-1 text-right">
              <div>請款單編號：<span className="tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{invoiceNo}</span></div>
              <div>開立日期：{todayStr()}</div>
              <div>租賃機台數：{rows.length} 台</div>
            </div>
          </div>

          <table className="w-full text-sm border border-slate-300 mb-6">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-300 px-3 py-2">項目</th>
                <th className="border border-slate-300 px-3 py-2">說明</th>
                <th className="border border-slate-300 px-3 py-2 text-right">數量</th>
                <th className="border border-slate-300 px-3 py-2 text-right">單價</th>
                <th className="border border-slate-300 px-3 py-2 text-right">小計</th>
                <th className="border border-slate-300 px-3 py-2">機型 / 序號</th>
                <th className="border border-slate-300 px-3 py-2">備註</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ lease, meter, usage, meterFee, isLaser }) => {
                return (
                  <React.Fragment key={lease.id}>
                    <tr>
                      <td className="border border-slate-300 px-3 py-2">機台月租金</td>
                      <td className="border border-slate-300 px-3 py-2 text-slate-500">計費期間：{periodLabel}</td>
                      <td className="border border-slate-300 px-3 py-2 text-right">1</td>
                      <td className="border border-slate-300 px-3 py-2 text-right tabular-nums">{fmt(lease.monthlyRent)}</td>
                      <td className="border border-slate-300 px-3 py-2 text-right tabular-nums">{fmt(lease.monthlyRent)}</td>
                      <td className="border border-slate-300 px-3 py-2 align-top" rowSpan={isLaser ? 2 : 1}>
                        <div className="font-medium text-slate-700">{lease.machineName}</div>
                        <div className="text-xs text-slate-400 mt-0.5">序號 {lease.serial} · 合約 {lease.id} · {lease.machineType || "雷射"}機</div>
                      </td>
                      <td className="border border-slate-300 px-3 py-2 align-top" rowSpan={isLaser ? 2 : 1}>
                        <input
                          type="text"
                          className="w-full bg-transparent text-xs border-none focus:outline-none focus:ring-1 focus:ring-slate-300 rounded px-1 py-0.5"
                          placeholder="輸入備註…"
                          value={notes[lease.id] || ""}
                          onChange={(e) => setNotes({ ...notes, [lease.id]: e.target.value })}
                        />
                      </td>
                    </tr>
                    {isLaser && (
                      <tr>
                        <td className="border border-slate-300 px-3 py-2">列印張數費用</td>
                        <td className="border border-slate-300 px-3 py-2 text-slate-500">
                          上期讀數 {lease.lastMeter.toLocaleString()} → 本期讀數 {Number(meter).toLocaleString()}
                        </td>
                        <td className="border border-slate-300 px-3 py-2 text-right">{usage.toLocaleString()} 張</td>
                        <td className="border border-slate-300 px-3 py-2 text-right tabular-nums">NT$ {lease.meterRate}</td>
                        <td className="border border-slate-300 px-3 py-2 text-right tabular-nums">{fmt(meterFee)}</td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              <tr>
                <td colSpan="7" className="border border-slate-300 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-600">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={remit.toCompany}
                        onChange={(e) => setRemit({ ...remit, toCompany: e.target.checked })}
                        className="rounded border-slate-300"
                      />
                      匯款至本公司帳戶
                    </label>
                    <span className="text-slate-300">|</span>
                    <span className="text-slate-400 shrink-0">匯款帳戶：</span>
                    <input
                      type="text"
                      className="flex-1 min-w-[200px] bg-transparent border-b border-dashed border-slate-300 focus:outline-none focus:border-slate-500 px-1 py-0.5"
                      value={remit.account}
                      onChange={(e) => setRemit({ ...remit, account: e.target.value })}
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="flex justify-end mb-10">
            <div className="w-64 text-sm">
              <div className="flex justify-between py-1 border-b border-slate-200">
                <span className="text-slate-500">{rows.length} 台機器合計</span>
                <span className="tabular-nums">{fmt(total)}</span>
              </div>
              <div className="flex justify-between py-2 text-lg font-bold">
                <span>應付總額</span>
                <span className="tabular-nums">{fmt(total)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 text-xs text-slate-500 pt-8 border-t border-slate-200">
            <div>
              <div className="mb-8">出帳人簽章：＿＿＿＿＿＿＿＿＿＿</div>
            </div>
            <div>
              <div className="mb-8">客戶簽收：＿＿＿＿＿＿＿＿＿＿</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- 應收帳款報表 / 沖帳作業 ---------------------------------- */
function ArTab({ arRecords, setArRecords, customers, custName, prepayments, setPrepayments, reconciliations, setReconciliations }) {
  const [filterCustomer, setFilterCustomer] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [showModal, setShowModal] = useState(false);

  const [allocations, setAllocations] = useState({});
  const [method, setMethod] = useState("匯款");
  const [received, setReceived] = useState(0);
  const [fee, setFee] = useState(0);
  const [feeBearer, setFeeBearer] = useState("無");
  const [prepayUse, setPrepayUse] = useState(0);
  const [remit, setRemit] = useState({ bank: "", acct: "", remitter: "", date: todayStr() });
  const [operator, setOperator] = useState("");
  const [note, setNote] = useState("");

  const computed = useMemo(
    () =>
      arRecords.map((a) => {
        const balance = a.amount - a.paidAmount;
        const status = balance <= 0 ? "已結清" : a.paidAmount > 0 ? "部分收款" : "未收";
        const days = -daysUntil(a.dueDate);
        return { ...a, balance, status, agingDays: days };
      }),
    [arRecords]
  );

  const filtered = computed.filter((a) => {
    if (!showAll && a.balance <= 0) return false;
    if (filterCustomer && a.customerId !== filterCustomer) return false;
    if (q && !(a.sourceNo.toLowerCase().includes(q.toLowerCase()) || custName(a.customerId).includes(q))) return false;
    return true;
  });

  const totals = useMemo(() => {
    const unpaid = computed.filter((a) => a.balance > 0);
    const total = unpaid.reduce((s, a) => s + a.balance, 0);
    const overdue = unpaid.filter((a) => a.agingDays > 0).reduce((s, a) => s + a.balance, 0);
    const buckets = [
      { label: "未到期", color: "#0f766e", sum: unpaid.filter((a) => a.agingDays <= 0).reduce((s, a) => s + a.balance, 0) },
      { label: "0-30天", color: "#b45309", sum: unpaid.filter((a) => a.agingDays > 0 && a.agingDays <= 30).reduce((s, a) => s + a.balance, 0) },
      { label: "31-60天", color: "#c2620f", sum: unpaid.filter((a) => a.agingDays > 30 && a.agingDays <= 60).reduce((s, a) => s + a.balance, 0) },
      { label: "61-90天", color: "#c0392b", sum: unpaid.filter((a) => a.agingDays > 60 && a.agingDays <= 90).reduce((s, a) => s + a.balance, 0) },
      { label: "90天以上", color: "#7f1d1d", sum: unpaid.filter((a) => a.agingDays > 90).reduce((s, a) => s + a.balance, 0) },
    ];
    return { total, overdue, buckets, count: unpaid.length };
  }, [computed]);

  const selectedCustomerId = selectedIds.length ? computed.find((a) => a.id === selectedIds[0])?.customerId : null;
  const selectedBalanceSum = selectedIds.reduce((s, id) => s + (computed.find((a) => a.id === id)?.balance || 0), 0);

  const toggleSelect = (ar) => {
    if (selectedIds.length === 0) return setSelectedIds([ar.id]);
    if (ar.customerId !== selectedCustomerId) return setSelectedIds([ar.id]);
    setSelectedIds((prev) => (prev.includes(ar.id) ? prev.filter((x) => x !== ar.id) : [...prev, ar.id]));
  };

  const custPrepayBalance = (custId) => prepayments.filter((p) => p.customerId === custId).reduce((s, p) => s + p.balance, 0);

  const openReconcile = () => {
    const initAlloc = {};
    let sum = 0;
    selectedIds.forEach((id) => {
      const ar = computed.find((a) => a.id === id);
      initAlloc[id] = ar.balance;
      sum += ar.balance;
    });
    setAllocations(initAlloc);
    setReceived(sum);
    setFee(0);
    setFeeBearer("無");
    setMethod("匯款");
    setRemit({ bank: "", acct: "", remitter: "", date: todayStr() });
    setPrepayUse(0);
    setOperator("");
    setNote("");
    setShowModal(true);
  };

  const totalAlloc = Object.values(allocations).reduce((s, v) => s + Number(v || 0), 0);
  const availableTotal = Number(received || 0) + (feeBearer === "客戶" ? Number(fee || 0) : 0) + Number(prepayUse || 0);
  const diff = availableTotal - totalAlloc;

  const submitReconcile = () => {
    if (diff !== 0 || totalAlloc <= 0) return;
    setArRecords((prev) =>
      prev.map((a) => (allocations[a.id] != null ? { ...a, paidAmount: a.paidAmount + Number(allocations[a.id]) } : a))
    );
    if (prepayUse > 0) {
      let remain = Number(prepayUse);
      setPrepayments((prev) =>
        prev.map((p) => {
          if (p.customerId === selectedCustomerId && remain > 0 && p.balance > 0) {
            const use = Math.min(p.balance, remain);
            remain -= use;
            return { ...p, balance: p.balance - use };
          }
          return p;
        })
      );
    }
    const rec = {
      id: nextId("REC"),
      date: remit.date || todayStr(),
      customerId: selectedCustomerId,
      method, received: Number(received), fee: Number(fee), feeBearer,
      prepaymentUsed: Number(prepayUse),
      remit: method === "匯款" ? remit : null,
      allocations: selectedIds.map((id) => ({ arId: id, amount: Number(allocations[id] || 0) })),
      operator, note,
    };
    setReconciliations((prev) => [rec, ...prev]);
    setSelectedIds([]);
    setShowModal(false);
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <div className="text-xs text-slate-500 mb-1">未結清應收總額</div>
          <div className="text-2xl font-bold text-slate-800 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(totals.total)}</div>
          <div className="text-xs text-slate-400 mt-1">共 {totals.count} 筆</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <div className="text-xs text-slate-500 mb-1">逾期金額</div>
          <div className="text-2xl font-bold text-rose-600 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(totals.overdue)}</div>
          <div className="text-xs text-slate-400 mt-1">佔比 {totals.total ? Math.round((totals.overdue / totals.total) * 100) : 0}%</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <div className="text-xs text-slate-500 mb-2">帳齡分佈</div>
          <div className="flex h-3 rounded overflow-hidden mb-2">
            {totals.buckets.map((b, i) => (
              <div key={i} title={`${b.label} ${fmt(b.sum)}`} style={{ width: `${totals.total ? (b.sum / totals.total) * 100 : 0}%`, background: b.color }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {totals.buckets.map((b, i) => (
              <span key={i} className="text-[11px] text-slate-500 flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: b.color }} /> {b.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={inputCls + " pl-8"} placeholder="搜尋單號或客戶" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-48">
          <select className={inputCls} value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value)}>
            <option value="">全部客戶</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-slate-500 ml-1">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 顯示已結清單據
        </label>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs border-b border-slate-100 bg-slate-50">
                <th className="px-3 py-2.5 w-8"></th>
                <th className="px-3 py-2.5 font-medium">單號</th>
                <th className="px-3 py-2.5 font-medium">客戶</th>
                <th className="px-3 py-2.5 font-medium">單據日期</th>
                <th className="px-3 py-2.5 font-medium">到期日</th>
                <th className="px-3 py-2.5 font-medium text-right">應收金額</th>
                <th className="px-3 py-2.5 font-medium text-right">已收金額</th>
                <th className="px-3 py-2.5 font-medium text-right">未收餘額</th>
                <th className="px-3 py-2.5 font-medium">帳齡</th>
                <th className="px-3 py-2.5 font-medium">狀態</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const sel = selectedIds.includes(a.id);
                const disabled = a.balance <= 0;
                return (
                  <tr
                    key={a.id}
                    className="border-b border-slate-50 hover:bg-slate-50/60 align-top"
                    style={{
                      background: sel ? "#f1f5f9" : undefined,
                      borderLeft: a.agingDays > 60 && a.balance > 0 ? "3px solid #dc2626" : "3px solid transparent",
                    }}
                  >
                    <td className="px-3 py-2.5">
                      <button disabled={disabled} onClick={() => toggleSelect(a)} className={disabled ? "text-slate-200" : "text-slate-700"}>
                        {sel ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-700">{a.sourceNo}</div>
                      <div className="text-[11px] text-slate-400">{a.sourceType}・{a.id}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{custName(a.customerId)}</td>
                    <td className="px-3 py-2.5 text-slate-500 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{a.docDate}</td>
                    <td className="px-3 py-2.5 text-slate-500 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{a.dueDate}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(a.amount)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(a.paidAmount)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(a.balance)}</td>
                    <td className="px-3 py-2.5">
                      {a.balance <= 0 ? (
                        <span className="text-xs text-slate-300">—</span>
                      ) : a.agingDays <= 0 ? (
                        <span className="text-xs text-slate-400">未到期</span>
                      ) : (
                        <Badge tone={a.agingDays > 60 ? "red" : "amber"}>逾期 {a.agingDays} 天</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={a.status === "已結清" ? "green" : a.status === "部分收款" ? "amber" : "red"}>{a.status}</Badge>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-400">沒有符合條件的應收帳款</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700">最近沖帳紀錄</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs border-b border-slate-100 bg-slate-50">
                <th className="px-3 py-2 font-medium">日期</th>
                <th className="px-3 py-2 font-medium">客戶</th>
                <th className="px-3 py-2 font-medium">方式</th>
                <th className="px-3 py-2 font-medium text-right">實收</th>
                <th className="px-3 py-2 font-medium text-right">手續費</th>
                <th className="px-3 py-2 font-medium">負擔方</th>
                <th className="px-3 py-2 font-medium text-right">預收抵扣</th>
                <th className="px-3 py-2 font-medium">承辦人</th>
              </tr>
            </thead>
            <tbody>
              {reconciliations.slice(0, 8).map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="px-3 py-2 text-slate-500 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{r.date}</td>
                  <td className="px-3 py-2 text-slate-700">{custName(r.customerId)}</td>
                  <td className="px-3 py-2">{r.method}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(r.received)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(r.fee)}</td>
                  <td className="px-3 py-2">{r.feeBearer}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(r.prepaymentUsed)}</td>
                  <td className="px-3 py-2 text-slate-500">{r.operator || "—"}</td>
                </tr>
              ))}
              {reconciliations.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-400">尚無沖帳紀錄</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 sm:left-60 bg-white border-t border-slate-200 z-30 shadow-lg">
          <div className="px-4 sm:px-8 py-3 flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-slate-600">
              已選取 <b className="text-slate-800">{selectedIds.length}</b> 筆・{custName(selectedCustomerId)}・合計未收
              <span className="font-semibold text-rose-600 tabular-nums ml-1" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(selectedBalanceSum)}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSelectedIds([])} className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 text-slate-500 hover:bg-slate-50">取消選取</button>
              <button onClick={openReconcile} className="px-4 py-1.5 rounded-lg text-sm text-white bg-slate-800 hover:bg-slate-900 flex items-center gap-1.5">
                <ArrowRightLeft size={14} /> 執行沖帳
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <Modal title={`沖帳作業・${custName(selectedCustomerId)}`} onClose={() => setShowModal(false)} wide>
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium text-slate-500 mb-2">待沖應收單據（可調整本次沖帳金額）</div>
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                {selectedIds.map((id) => {
                  const ar = computed.find((a) => a.id === id);
                  return (
                    <div key={id} className="flex items-center justify-between px-3 py-2 border-t border-slate-100 first:border-t-0 text-sm">
                      <div>
                        <div className="font-medium text-slate-700">{ar.sourceNo}</div>
                        <div className="text-[11px] text-slate-400">未收餘額 {fmt(ar.balance)}</div>
                      </div>
                      <div className="w-36 shrink-0">
                        <input
                          type="number"
                          className={inputCls + " text-right tabular-nums"}
                          value={allocations[id] ?? 0}
                          max={ar.balance}
                          onChange={(e) => setAllocations({ ...allocations, [id]: Math.min(Number(e.target.value || 0), ar.balance) })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="text-right text-sm mt-1 text-slate-500">沖帳分配合計：<b className="text-slate-800 tabular-nums">{fmt(totalAlloc)}</b></div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="收款方式">
                <div className="flex gap-2">
                  {["現金", "匯款"].map((m) => (
                    <button
                      key={m}
                      onClick={() => setMethod(m)}
                      className={`flex-1 py-2 rounded-lg text-sm border flex items-center justify-center gap-1.5 ${method === m ? "border-slate-800 bg-slate-50 text-slate-800" : "border-slate-200 text-slate-500"}`}
                    >
                      {m === "現金" ? <Banknote size={14} /> : <Landmark size={14} />} {m}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="實際收到金額">
                <input type="number" className={inputCls + " tabular-nums"} value={received} onChange={(e) => setReceived(e.target.value)} />
              </Field>
            </div>

            {method === "匯款" && (
              <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded-lg p-3">
                <Field label="匯入銀行"><input className={inputCls} value={remit.bank} onChange={(e) => setRemit({ ...remit, bank: e.target.value })} /></Field>
                <Field label="帳號後四碼"><input className={inputCls} maxLength={4} value={remit.acct} onChange={(e) => setRemit({ ...remit, acct: e.target.value })} /></Field>
                <Field label="匯款人"><input className={inputCls} value={remit.remitter} onChange={(e) => setRemit({ ...remit, remitter: e.target.value })} /></Field>
                <Field label="匯款日期"><input type="date" className={inputCls} value={remit.date} onChange={(e) => setRemit({ ...remit, date: e.target.value })} /></Field>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="銀行手續費">
                <input type="number" className={inputCls + " tabular-nums"} value={fee} onChange={(e) => setFee(e.target.value)} />
              </Field>
              <Field label="手續費負擔方">
                <select className={inputCls} value={feeBearer} onChange={(e) => setFeeBearer(e.target.value)}>
                  <option value="無">無手續費</option>
                  <option value="客戶">客戶負擔（併入沖帳金額）</option>
                  <option value="公司">公司負擔（列為費用）</option>
                </select>
              </Field>
            </div>

            {custPrepayBalance(selectedCustomerId) > 0 && (
              <Field label={`使用預收款折抵（可用餘額 ${fmt(custPrepayBalance(selectedCustomerId))}）`}>
                <input
                  type="number"
                  className={inputCls + " tabular-nums"}
                  value={prepayUse}
                  onChange={(e) => setPrepayUse(Math.min(Number(e.target.value || 0), custPrepayBalance(selectedCustomerId)))}
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="承辦人"><input className={inputCls} value={operator} onChange={(e) => setOperator(e.target.value)} /></Field>
              <Field label="備註"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </div>

            <div className={`rounded-lg p-3 flex items-center justify-between text-sm ${diff === 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>
              <span>
                可用總額 {fmt(availableTotal)}　－　沖帳分配 {fmt(totalAlloc)}　＝　差額 {fmt(diff)}
              </span>
              {diff !== 0 && <AlertCircle size={16} />}
            </div>

            <button
              onClick={submitReconcile}
              disabled={diff !== 0 || totalAlloc <= 0}
              className="w-full bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-900 disabled:opacity-40"
            >
              確認沖帳
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------- 預收款管理 ---------------------------------- */
function PrepayTab({ prepayments, setPrepayments, customers, custName }) {
  const [form, setForm] = useState({ customerId: customers[0]?.id || "", amount: "", date: todayStr(), note: "" });

  const add = () => {
    if (!form.amount || Number(form.amount) <= 0) return;
    setPrepayments([
      { id: nextId("PP"), customerId: form.customerId, amount: Number(form.amount), balance: Number(form.amount), date: form.date, note: form.note },
      ...prepayments,
    ]);
    setForm({ ...form, amount: "", note: "" });
  };

  const totalBalance = prepayments.reduce((s, p) => s + p.balance, 0);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
        <div className="text-xs text-slate-500 mb-1">預收款可用餘額合計</div>
        <div className="text-2xl font-bold text-slate-800 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(totalBalance)}</div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
        <div className="text-sm font-semibold text-slate-700 mb-3">新增預收款</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <Field label="客戶">
            <select className={inputCls} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="金額">
            <input type="number" className={inputCls + " tabular-nums"} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" />
          </Field>
          <Field label="日期">
            <input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <button onClick={add} className="h-[38px] rounded-lg text-sm text-white bg-slate-800 hover:bg-slate-900 flex items-center justify-center gap-1.5">
            <Plus size={14} /> 新增
          </button>
        </div>
        <div className="mt-3">
          <Field label="備註"><input className={inputCls} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="例：租賃訂金" /></Field>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-2.5 font-medium">客戶</th>
                <th className="px-4 py-2.5 font-medium">日期</th>
                <th className="px-4 py-2.5 font-medium text-right">原始金額</th>
                <th className="px-4 py-2.5 font-medium text-right">剩餘餘額</th>
                <th className="px-4 py-2.5 font-medium">備註</th>
              </tr>
            </thead>
            <tbody>
              {prepayments.map((p) => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="px-4 py-2.5 text-slate-700">{custName(p.customerId)}</td>
                  <td className="px-4 py-2.5 text-slate-500 tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{p.date}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(p.amount)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${p.balance > 0 ? "text-slate-800" : "text-slate-300"}`} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(p.balance)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{p.note}</td>
                </tr>
              ))}
              {prepayments.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">尚無預收款紀錄</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- 人員帳號管理（僅管理員） ---------------------------------- */
const ROLE_LABEL = { admin: "管理員", staff: "一般人員" };

function StaffTab({ currentUserId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [modal, setModal] = useState(null); // { mode: "add" | "edit", row? }
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => {
    setLoading(true);
    setLoadErr("");
    callAdminUsersFn("list").then(({ data, error }) => {
      setLoading(false);
      if (error) { setLoadErr(error.message); return; }
      setRows(data || []);
    });
  };

  useEffect(load, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm text-slate-500">共 {rows.length} 位人員帳號</h3>
        <button
          onClick={() => setModal({ mode: "add" })}
          className="flex items-center gap-1.5 bg-slate-800 text-white text-sm px-4 py-2 rounded-lg hover:bg-slate-900"
        >
          <Plus size={15} /> 新增人員
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-x-auto">
        {loadErr && <div className="p-4 text-sm text-rose-500">讀取失敗：{loadErr}</div>}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 text-xs border-b border-slate-100">
              <th className="px-4 py-2.5 font-medium">姓名</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">電話</th>
              <th className="px-4 py-2.5 font-medium">權限</th>
              <th className="px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">載入中…</td></tr>
            )}
            {!loading && rows.length === 0 && !loadErr && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">尚無人員帳號</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-medium text-slate-700">{r.display_name || "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.email}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.phone || "—"}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={r.role === "admin" ? "teal" : "slate"}>{ROLE_LABEL[r.role] || r.role}</Badge>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setModal({ mode: "edit", row: r })} className="text-slate-400 hover:text-slate-700"><Pencil size={14} /></button>
                    <button
                      onClick={() => setDeleteTarget(r)}
                      disabled={r.id === currentUserId}
                      className="text-slate-400 hover:text-rose-500 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={r.id === currentUserId ? "無法刪除自己的帳號" : "刪除"}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <StaffFormModal
          mode={modal.mode}
          row={modal.row}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {deleteTarget && (
        <Modal title="刪除人員帳號" onClose={() => setDeleteTarget(null)}>
          <StaffDeleteConfirm target={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

function StaffDeleteConfirm({ target, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const confirm = async () => {
    setBusy(true);
    setErr("");
    const { error } = await callAdminUsersFn("delete", { id: target.id });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDeleted();
  };

  return (
    <div>
      <p className="text-sm text-slate-600 mb-4">
        確定要刪除人員帳號 <span className="font-medium text-slate-800">{target.display_name || target.email}</span>（{target.email}）嗎？此動作無法復原，該帳號將無法再登入系統。
      </p>
      {err && <div className="text-xs text-rose-500 mb-3">{err}</div>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
        <button onClick={confirm} disabled={busy} className="flex-1 bg-rose-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-rose-700 disabled:bg-rose-300">
          {busy ? "刪除中…" : "確定刪除"}
        </button>
      </div>
    </div>
  );
}

function StaffFormModal({ mode, row, onClose, onSaved }) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState({
    email: row?.email || "",
    password: "",
    displayName: row?.display_name || "",
    phone: row?.phone || "",
    role: row?.role || "staff",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!isEdit && (!form.email || !form.password)) { setErr("請填寫 Email 與密碼"); return; }
    if (form.password && form.password.length < 6) { setErr("密碼至少需要 6 碼"); return; }
    setBusy(true);
    const action = isEdit ? "update" : "create";
    const payload = isEdit
      ? { id: row.id, displayName: form.displayName, phone: form.phone, role: form.role, password: form.password || undefined }
      : { email: form.email, password: form.password, displayName: form.displayName, phone: form.phone, role: form.role };
    const { error } = await callAdminUsersFn(action, payload);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <Modal title={isEdit ? "編輯人員帳號" : "新增人員帳號"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="姓名">
          <input className={inputCls} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="王小明" />
        </Field>
        <Field label="Email">
          <input
            type="email"
            required
            disabled={isEdit}
            className={inputCls + (isEdit ? " bg-slate-50 text-slate-400" : "")}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@company.com"
          />
        </Field>
        <Field label="電話">
          <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0912-345-678" />
        </Field>
        <Field label="權限">
          <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="staff">一般人員</option>
            <option value="admin">管理員</option>
          </select>
        </Field>
        <Field label={isEdit ? "密碼（留空表示不變更）" : "密碼"}>
          <input
            type="password"
            required={!isEdit}
            minLength={6}
            className={inputCls}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={isEdit ? "留空則不變更密碼" : "至少 6 碼"}
          />
        </Field>
        {err && <div className="text-xs text-rose-500">{err}</div>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
          <button type="submit" disabled={busy} className="flex-1 bg-slate-800 text-white rounded-lg py-2 text-sm font-medium hover:bg-slate-900 disabled:bg-slate-300">
            {busy ? "處理中…" : isEdit ? "儲存變更" : "建立帳號"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function App() {
  return (
    <AuthGate>
      <ErpApp />
    </AuthGate>
  );
}
