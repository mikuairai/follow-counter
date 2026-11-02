const Stats = window.XFP_Stats;
const $ = (id) => document.getElementById(id);
const DAY = 24 * 60 * Stats.MIN;
const PAGE = 200;
const EXT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`;

let data = { following: {}, follows: {}, events: [], settings: {}, me: "", followingCount: null, keep: {}, consent: null };
let filter = "all";
let shown = PAGE;
let resetArmed = false;

// 保留名单里的人只出现在"保留名单"筛选里
const FILTERS = [
  { k: "all", t: "全部未回关", f: (r) => !r.keep },
  { k: "old", t: "关注超过 7 天", f: (r) => !r.keep && (r.followedAt == null || r.age > 7 * DAY) },
  { k: "fresh", t: "3 天内刚关注", f: (r) => !r.keep && r.fresh },
  { k: "unknown", t: "状态未知", f: (r) => !r.keep && r.fb == null },
  { k: "keep", t: "保留名单", f: (r) => r.keep }
];

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function ago(ms) {
  if (ms < 60 * Stats.MIN) return Math.max(1, Math.round(ms / Stats.MIN)) + " 分钟";
  if (ms < DAY) return Math.round(ms / (60 * Stats.MIN)) + " 小时";
  return Math.round(ms / DAY) + " 天";
}
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2800);
}

function applyTheme() {
  const th = data.settings.theme === "light" || data.settings.theme === "dark"
    ? data.settings.theme : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = th;
}

function renderCover() {
  const total = Object.keys(data.following).length;
  $("seen").innerHTML = `${total}<small>人已读取</small>`;
  const c = data.followingCount;
  const pctVal = c && c.n ? Math.min(1, total / c.n) : 0;
  $("coverBar").style.width = Math.round(pctVal * 100) + "%";
  const btn = $("openFollowing");
  // 没同意数据说明时，按钮改成去看说明
  if (!Stats.hasConsent(data.consent)) {
    btn.disabled = false;
    btn.textContent = "查看数据说明";
    $("coverText").textContent = "插件还没开始工作：需要你先看一下数据说明并同意，之后浏览关注列表时才会记录。";
    return;
  }
  btn.textContent = "打开我的关注列表";
  btn.disabled = !data.me;
  $("coverText").textContent = !data.me
    ? "先在 x.com 上随便打开一个页面，插件认出你的账号后，这里会出现「打开我的关注列表」。"
    : c
      ? `你一共关注了${c.approx ? "约 " : " "}${c.n} 人，已读到 ${Math.round(pctVal * 100)}%。打开关注列表一直往下滑到底，插件会顺带记下每个人有没有关注你。`
      : "打开你的关注列表一直往下滑到底，插件会顺带记下每个人有没有关注你。";
}

function renderGuard() {
  const ch = Stats.churn(data.events, Date.now());
  const g = $("guard");
  g.className = "guard " + (ch.level === "ok" ? "" : ch.level);
  const rule = `X 规则禁止"关注后又大量取关来涨粉"（follow churn），违者可能被封号。<a href="https://help.x.com/rules-and-policies/platform-manipulation" target="_blank" rel="noopener">查看规则</a>`;
  g.innerHTML = ch.level === "ok"
    ? `近 24 小时取关 <b>${ch.unfollow24h}</b> 个。清理建议：每天少量、分几次，优先关注了很久都没回关的人，刚关注几天内的再等等。<br>${rule}`
    : `<b>${ch.level === "high" ? "今天取关太集中了，先停一停。" : "今天取关有点多，放慢一些。"}</b> 近 24 小时取关 ${ch.unfollow24h} 个，其中 ${ch.quick24h} 个是刚关注 3 天内就取关。<br>${rule}`;
}

function currentRows() {
  const all = Stats.nonFollowers(data.following, data.follows, Date.now(), data.keep);
  const q = $("q").value.trim().replace(/^@/, "").toLowerCase();
  const counts = {};
  FILTERS.forEach((f) => { counts[f.k] = all.filter(f.f).length; });
  const rows = all.filter(FILTERS.find((f) => f.k === filter).f).filter((r) => !q || r.key.includes(q));
  return { rows, counts, total: all.length };
}

function renderChips(counts) {
  $("chips").innerHTML = FILTERS.map((f) =>
    `<button class="chip" type="button" data-k="${f.k}" aria-pressed="${f.k === filter}">${f.t}<span>${counts[f.k]}</span></button>`).join("");
}

// 「保留」的说明跟着筛选变：平时讲它是什么，进了保留名单讲怎么撤销
function renderHelp() {
  $("help").innerHTML = filter === "keep"
    ? `<span class="k">保留</span><span>这里是你标记了<b>不打算取关</b>的人。他们不算进未回关人数，也不会被复制出来；关注列表页上挂绿色「保留」，自动往下读时不会在他们身上停。想重新放回未回关名单，点「移出保留」。</span>`
    : `<span class="k">保留</span><span>朋友、偶像、新闻号这类<b>没回关也不打算取关</b>的人，点右边「保留」做个记号。之后他们只出现在「保留名单」里，清理名单时不用每次再认一遍。只记在插件里，X 上不会有任何变化，对方也看不到。</span>`;
}

function renderRows() {
  const now = Date.now();
  const { rows, counts, total } = currentRows();
  renderChips(counts);
  renderHelp();
  if (!rows.length) {
    $("rows").innerHTML = `<li class="empty">${filter === "keep" ? "还没有保留的人。好友、偶像、新闻号这类不打算取关的，点「保留」后就不会再出现在未回关名单里。" : total ? "这个筛选下没有人。" : Object.keys(data.following).length ? "读到的人都回关你了。" : "还没读到你的关注列表。点上面的「打开我的关注列表」，往下滑一遍就有了。"}</li>`;
    $("more").hidden = true;
    return;
  }
  $("rows").innerHTML = rows.slice(0, shown).map((r) => {
    const from = r.followedAt == null
      ? "安装插件前就已关注"
      : `关注了 ${ago(r.age)}` + (r.src ? ` · 来自${r.via && /followers|following|engagers|replies/.test(r.src) ? ` @${esc(r.via)} 的` : ""}${esc(Stats.SOURCE_LABELS[r.src] || "其他").replace(/^某人的/, "")}` : "");
    const tag = r.fresh ? `<span class="tag fresh">刚关注，再等等</span>`
      : r.fb == null ? `<span class="tag">状态未知</span>` : `<span class="tag no">未回关</span>`;
    const tagHtml = r.keep ? `<span class="tag keep">保留</span>` : tag;
    // 所有主页都在同一个标签页里打开，点多少人都不会开一堆标签
    return `<li><div><a href="https://x.com/${encodeURIComponent(r.name)}" target="xfp-profile" rel="noopener" title="打开 @${esc(r.name)} 的主页，在那里关注或取关">@${esc(r.name)}${EXT}</a>
      <div class="meta">${from} · ${ago(now - r.seenAt)}前读到</div></div>
      <div class="acts">${tagHtml}<button class="btn small" type="button" data-keep="${esc(r.key)}" title="${r.keep ? "放回未回关名单" : "不打算取关这个人：标记后不再出现在未回关名单里"}">${r.keep ? "移出保留" : "保留"}</button></div></li>`;
  }).join("");
  $("more").hidden = rows.length <= shown;
  $("more").textContent = `显示更多（还有 ${rows.length - shown} 人）`;
}

function renderAll() {
  applyTheme();
  renderCover();
  renderGuard();
  renderRows();
}

chrome.storage.local.get(["following", "follows", "events", "settings", "me", "followingCount", "keep", "consent"], (d) => {
  data = Object.assign(data, {
    following: d.following || {}, follows: d.follows || {}, events: d.events || [], keep: d.keep || {},
    settings: d.settings || {}, me: d.me || "", followingCount: d.followingCount || null, consent: d.consent || null
  });
  renderAll();
});
chrome.storage.onChanged.addListener((c) => {
  for (const k of ["following", "follows", "events", "settings", "me", "followingCount", "keep", "consent"]) {
    if (c[k]) data[k] = c[k].newValue != null ? c[k].newValue : (k === "events" ? [] : k === "me" ? "" : k === "followingCount" || k === "consent" ? null : {});
  }
  renderAll();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

$("chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  filter = b.dataset.k;
  shown = PAGE;
  renderRows();
});
$("rows").addEventListener("click", (e) => {
  const b = e.target.closest("[data-keep]");
  if (!b) return;
  const k = b.dataset.keep;
  const keep = Object.assign({}, data.keep);
  if (keep[k]) delete keep[k]; else keep[k] = true;
  data.keep = keep;
  chrome.storage.local.set({ keep });
  const nm = "@" + ((data.following[k] && data.following[k].name) || k);
  toast(keep[k] ? `已保留 ${nm}，不再出现在未回关名单里` : `${nm} 已放回未回关名单`);
  renderRows();
});
$("q").addEventListener("input", () => { shown = PAGE; renderRows(); });
$("more").addEventListener("click", () => { shown += PAGE; renderRows(); });
$("openFollowing").addEventListener("click", () => {
  if (!Stats.hasConsent(data.consent)) return chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  if (data.me) chrome.tabs.create({ url: `https://x.com/${encodeURIComponent(data.me)}/following` });
});
$("copy").addEventListener("click", async () => {
  const names = currentRows().rows.map((r) => "@" + r.name).join("\n");
  if (!names) return toast("当前列表是空的");
  await navigator.clipboard.writeText(names);
  toast(`已复制 ${names.split("\n").length} 个用户名`);
});
$("reset").addEventListener("click", () => {
  const btn = $("reset");
  if (!resetArmed) {
    resetArmed = true;
    btn.textContent = "再点一次确认清空";
    setTimeout(() => { resetArmed = false; btn.textContent = "清空名单，重新读取"; }, 3000);
    return;
  }
  resetArmed = false;
  btn.textContent = "清空名单，重新读取";
  chrome.storage.local.set({ following: {} });
  toast("已清空，重新打开关注列表滑一遍即可");
});

setInterval(renderRows, 60 * 1000);
