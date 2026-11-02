const Stats = window.XFP_Stats;
const LIMITS = window.XFP_LIMITS;
const UI = window.XFP_UI;
const $ = (id) => document.getElementById(id);
let events = [];
let follows = {};
let settings = Object.assign({}, Stats.DEFAULTS);
let clearArmed = false;
let revokeArmed = false;
let consented = false;
const progress = UI.mount($("progress").attachShadow({ mode: "open" }), {});
// 外观：auto 跟系统，light/dark 固定；弹窗和进度组件同步
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const effectiveTheme = () => (settings.theme === "light" || settings.theme === "dark" ? settings.theme : (darkQuery.matches ? "dark" : "light"));
function syncTheme() {
  const th = effectiveTheme();
  document.documentElement.dataset.theme = th;
  progress.card.dataset.theme = th;
  const btn = $("themeBtn");
  btn.innerHTML = UI.icon(th === "dark" ? "sun" : "moon", 16);
  btn.title = th === "dark" ? "切换到浅色" : "切换到深色";
  btn.setAttribute("aria-label", btn.title);
  document.querySelectorAll("#themeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === (settings.theme || "auto"))));
}
darkQuery.addEventListener("change", syncTheme);
syncTheme();

// 主页检查清单：勾选状态存在 settings.checklist
const CHECKS = [
  { k: "avatar", t: "头像清晰", d: "真人照片或一眼能认出的标识，别用默认头像" },
  { k: "bio", t: "简介一句话说清你是谁", d: "做什么的、关注你能得到什么，带上你领域的关键词" },
  { k: "pinned", t: "置顶一条代表作", d: "别人点进主页，第一眼看到你最好的一条帖子" },
  { k: "banner", t: "设置横幅图", d: "空横幅看起来像新号或小号" },
  { k: "active", t: "最近 3 天发过帖或回复", d: "对方点进来看到的是活跃账号，回关意愿更高" }
];

const pct = (r) => Math.round(r * 100) + "%";

function renderFollowBack(now) {
  const fb = Stats.followBack(follows, now);
  if (!fb.tracked) {
    $("fb").innerHTML = `<div class="empty">还没有记录。之后你每关注一个人，插件会记下是在哪个页面关注的；你平时刷 X 时，顺带看出谁回关了你。</div>`;
    return;
  }
  const best = fb.byCat.filter((c) => c.known >= 10).sort((a, b) => b.rate - a.rate)[0];
  const rows = fb.byCat.map((c) => `<li class="${best && c.cat === best.cat ? "best" : ""}">
      <span class="name" title="${esc(c.label)}">${esc(c.label)}</span>
      <span class="track"><i style="width:${c.rate == null ? 0 : Math.max(3, Math.round(c.rate * 100))}%"></i></span>
      <span class="num">${c.rate == null ? `待确认 ${c.n}` : `${pct(c.rate)} · ${c.yes}/${c.known}`}</span></li>`).join("");
  const vias = fb.byVia.map((v) => `<li><span class="name">@${esc(v.via)}</span>
      <span class="track"><i style="width:${Math.max(3, Math.round(v.rate * 100))}%"></i></span>
      <span class="num">${pct(v.rate)} · ${v.yes}/${v.known}</span></li>`).join("");
  $("fb").innerHTML = `
    <div class="fbhead"><b>${fb.rate == null ? "—" : pct(fb.rate)}</b>
      <span>${fb.known ? `已确认的 ${fb.known} 人里有 ${fb.yes} 人回关` : "还没读到回关状态"}</span></div>
    <div class="sub-h">按关注来源</div>
    <ul class="srcs">${rows}</ul>
    ${vias ? `<div class="sub-h">在谁的名单里关注，回关最多</div><ul class="srcs">${vias}</ul>` : ""}
    <div class="meta">共记录 ${fb.tracked} 个关注，已读到 ${fb.known} 人的回关状态，待确认 ${fb.pending} 人。
      <br>${best ? `目前「${esc(best.label)}」回关率最高，名额优先花在这里。` : "某个来源确认满 10 人后，会标出回关率最高的来源。"}
      ${fb.stale ? `<br>${fb.stale} 人关注超过 7 天还没回关。别成批取关他们，见下方取关护栏。` : ""}</div>`;
}

function renderChurn(now) {
  const ch = Stats.churn(events, now);
  $("unf24").textContent = ch.unfollow24h;
  $("quick24").textContent = ch.quick24h;
  const g = $("guard");
  g.className = "guard-msg " + (ch.level === "ok" ? "" : ch.level);
  const rule = `X 规则禁止"关注后又大量取关来涨粉"（follow churn），违者可能被封号。`;
  g.innerHTML = ch.level === "ok"
    ? `${rule}没回关的人慢慢清理，每天少量即可，刚关注几天内尽量别取关。<br><span style="opacity:.8">提醒线是本插件自定的（3 天内取关 ${ch.lines.warnQuick} 个或一天取关 ${ch.lines.warnTotal} 个），X 没有公布具体数字。</span>`
    : `<b>${ch.level === "high" ? "取关太集中了，今天先停一停。" : "取关有点多，放慢一些。"}</b><br>${rule}<a href="https://help.x.com/rules-and-policies/platform-manipulation" target="_blank">查看规则</a>`;
}

function renderChecks() {
  const done = new Set(settings.checklist || []);
  $("checkProg").textContent = `${CHECKS.filter((c) => done.has(c.k)).length}/${CHECKS.length}`;
}

function buildChecks() {
  $("checks").innerHTML = CHECKS.map((c) => `<li><label><input type="checkbox" data-k="${c.k}"><span><b>${esc(c.t)}</b><small>${esc(c.d)}</small></span></label></li>`).join("");
  $("checks").addEventListener("change", (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const done = new Set(settings.checklist || []);
    if (e.target.checked) done.add(k); else done.delete(k);
    saveSettings({ checklist: [...done] });
  });
}

function syncChecks() {
  const done = new Set(settings.checklist || []);
  document.querySelectorAll("#checks input").forEach((i) => { i.checked = done.has(i.dataset.k); });
  renderChecks();
}

const PHASE_TEXT = { idle: "待开始", going: "进行中", near: "快满了", full: "本轮完成", cooling: "冷却中", ready: "可以再试" };

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function clock(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const mins = (ms) => Math.max(1, Math.round(ms / Stats.MIN));

// 下限有效且小于上限时给区间，否则只给上限
function waitRange(min, max) {
  if (max == null) return null;
  return min != null && min > 0 && mins(min) < mins(max) ? `${mins(min)}–${mins(max)}` : `≤ ${mins(max)}`;
}

function render() {
  const now = Date.now();
  const s = Stats.compute(events, now);
  const ph = Stats.phase(s, settings);

  $("onboard").hidden = events.length > 0;
  const pill = $("pill");
  pill.className = "pill " + ph.name;
  pill.textContent = PHASE_TEXT[ph.name];

  progress.update(s, settings, now);
  $("who").textContent = s.lastFollow ? `最近一次：${s.lastFollow.user ? "@" + s.lastFollow.user + "，" : ""}${clock(s.lastFollow.ts)}` : "还没有关注记录";
  $("m15").textContent = s.follow15m;
  $("m30").textContent = s.follow30m;
  $("h1").textContent = s.follow1h;
  $("h24").textContent = s.follow24h;

  renderFollowBack(now);
  renderChurn(now);

  const r = Stats.rhythm(s);
  if (!r) {
    $("rhythm").innerHTML = `<div class="empty">还没撞过限制。撞到一次、再解封之后，这里会告诉你每轮大概能关注几个、要等多久。</div>`;
    $("rounds").innerHTML = "";
    $("rhint").hidden = true;
  } else {
    const w = waitRange(r.waitMin, r.waitMax);
    $("rhythm").innerHTML = `<div class="rhythm">
      <div class="fig"><span>实测每轮（参考）</span><b>${r.typical != null ? r.typical : "—"}</b><small>个</small></div>
      <div class="fig"><span>撞限后需等</span>${w ? `<b>${w}</b><small>分钟</small>` : `<b>—</b><small>解封后算出</small>`}</div>
    </div>`;
    const maxBatch = Math.max.apply(null, s.rounds.map((x) => x.batch).concat(1));
    $("rounds").innerHTML = s.rounds.slice(-5).reverse().map((x) => {
      const wait = x.end == null
        ? `<span class="wait live">冷却中</span>`
        : `<span class="wait">等 ${waitRange(x.cooldownMin, x.cooldownMax)} 分</span>`;
      return `<li><span class="when">${clock(x.start)}</span>
        <span class="rb"><i style="width:${Math.round((x.batch / maxBatch) * 90)}px"></i>${x.batch} 个</span>${wait}</li>`;
    }).join("");
    $("rhint").hidden = false;
  }

  const ft = document.querySelector('.lt[data-k="follow"]');
  ft.querySelector(".val").innerHTML = `<b>${s.follow24h}</b><span>/ 400 · 近 24 小时</span>`;
  ft.querySelector(".mini").style.setProperty("--p", Math.min(1, s.follow24h / LIMITS.followPerDay));

  const rs = Stats.roundSize(s, settings);
  $("roundVal").textContent = `${rs.size} 个`;
  $("roundFrom").textContent = rs.from === "默认" ? "默认 15，可按你的实测调整" : `手动设置（默认 ${Stats.DEFAULT_ROUND}）`;
}

function renderStatic() {
  $("ltiles").innerHTML = LIMITS.tiles.map((x) => `
    <div class="lt" data-k="${x.key}">
      <div class="top">${UI.icon(x.icon, 14)}${esc(x.label)}</div>
      <div class="val"><b>${esc(x.value)}</b><span>${esc(x.unit)}</span></div>
      ${x.key === "follow" ? `<div class="mini"><b></b></div>` : `<div class="note">${esc(x.note)}</div>`}
    </div>`).join("");
  $("chev").innerHTML = UI.icon("chevron", 12);
  $("notes").innerHTML = LIMITS.notes.map((n) => `<li>${esc(n)}</li>`).join("");
  $("src").innerHTML = `来源：<a href="${LIMITS.source}" target="_blank">X Limits</a> · <a href="${LIMITS.followSource}" target="_blank">关注上限说明</a>（核对于 ${LIMITS.checkedAt} 的官方页面存档）`;
}

function syncControls() {
  syncTheme();
  syncChecks();
  $("badge").checked = settings.showBadge !== false;
  $("sound").checked = settings.sound !== false;
  $("notify").checked = settings.notify !== false;
  $("volume").value = Math.round(settings.volume * 100);
  $("volume").disabled = !$("sound").checked;
}

function saveSettings(patch) {
  settings = Object.assign({}, settings, patch);
  chrome.storage.local.set({ settings });
  syncControls();
  render();
}

renderStatic();
buildChecks();
// 没同意数据说明时只显示提示卡片；本机若还留着撤回前的记录，顺带给一个删除按钮
function syncConsent(hasData) {
  document.body.classList.toggle("noconsent", !consented);
  $("needConsent").hidden = consented;
  $("leftover").hidden = consented || !hasData;
}
const DATA_KEYS = ["events", "follows", "following", "keep", "me", "followingCount", "notifiedFor", "badgePos"];
const hasAnyData = (d) => (d.events && d.events.length) || Object.keys(d.follows || {}).length || Object.keys(d.following || {}).length;

chrome.storage.local.get(["events", "settings", "follows", "following", "consent"], (data) => {
  consented = Stats.hasConsent(data.consent);
  syncConsent(hasAnyData(data));
  events = data.events || [];
  follows = data.follows || {};
  settings = Object.assign({}, Stats.DEFAULTS, data.settings || {});
  syncControls();
  render();
});
chrome.storage.onChanged.addListener((c) => {
  if (c.consent || c.events || c.following) {
    if (c.consent) consented = Stats.hasConsent(c.consent.newValue);
    chrome.storage.local.get(["events", "follows", "following"], (d) => syncConsent(hasAnyData(d)));
  }
  if (c.events) events = c.events.newValue || [];
  if (c.follows) follows = c.follows.newValue || {};
  if (c.settings) {
    settings = Object.assign({}, Stats.DEFAULTS, c.settings.newValue || {});
    syncControls();
  }
  render();
});

$("badge").addEventListener("change", (e) => saveSettings({ showBadge: e.target.checked }));
$("sound").addEventListener("change", (e) => saveSettings({ sound: e.target.checked }));
$("notify").addEventListener("change", (e) => saveSettings({ notify: e.target.checked }));
$("volume").addEventListener("change", (e) => {
  saveSettings({ volume: Number(e.target.value) / 100 });
  window.XFP_Sound.follow(0.9, settings.volume);
});
const demo = () => window.XFP_Sound.demo(settings.volume);
$("demo1").addEventListener("click", demo);
$("demo2").addEventListener("click", demo);
$("themeBtn").addEventListener("click", () => saveSettings({ theme: effectiveTheme() === "dark" ? "light" : "dark" }));
document.querySelectorAll("#themeSeg button").forEach((b) => b.addEventListener("click", () => saveSettings({ theme: b.dataset.v })));
function syncPos(p) {
  const custom = !!p;
  $("posText").textContent = custom ? "已拖到自定义位置" : "左下角（默认）";
  $("resetPos").disabled = !custom;
  $("resetPos").style.opacity = custom ? "" : ".5";
}
chrome.storage.local.get(["badgePos"], (d) => syncPos(d.badgePos));
chrome.storage.onChanged.addListener((c) => { if (c.badgePos) syncPos(c.badgePos.newValue); });
$("resetPos").addEventListener("click", () => chrome.storage.local.remove("badgePos"));
$("openList").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("list.html") }));
$("openX").addEventListener("click", () => chrome.tabs.create({ url: "https://x.com/" }));

function stepRound(delta) {
  const cur = Stats.roundSize(Stats.compute(events, Date.now()), settings).size;
  saveSettings({ roundSize: Math.max(1, Math.min(400, cur + delta)) });
}
$("minus").addEventListener("click", () => stepRound(-1));
$("plus").addEventListener("click", () => stepRound(1));

$("clear").addEventListener("click", () => {
  const btn = $("clear");
  if (!clearArmed) {
    clearArmed = true;
    btn.textContent = "再点一次确认";
    btn.classList.add("armed");
    setTimeout(() => { clearArmed = false; btn.textContent = "清空"; btn.classList.remove("armed"); }, 3000);
    return;
  }
  // 清空本机保存的全部记录（关注记录、回关数据、未回关名单、保留名单），设置和同意状态保留
  chrome.storage.local.remove(DATA_KEYS.filter((k) => k !== "badgePos"));
  clearArmed = false;
  btn.textContent = "清空";
  btn.classList.remove("armed");
});

const openWelcome = () => chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
$("openWelcome").addEventListener("click", openWelcome);
$("privacy").addEventListener("click", openWelcome);
$("revoke").addEventListener("click", () => {
  const btn = $("revoke");
  if (!revokeArmed) {
    revokeArmed = true;
    btn.textContent = "再点一次确认";
    btn.classList.add("armed");
    setTimeout(() => { revokeArmed = false; btn.textContent = "撤回"; btn.classList.remove("armed"); }, 3000);
    return;
  }
  revokeArmed = false;
  btn.textContent = "撤回";
  btn.classList.remove("armed");
  chrome.storage.local.remove("consent");
});
$("wipe").addEventListener("click", () => chrome.storage.local.remove(DATA_KEYS));

setInterval(render, 1000);
