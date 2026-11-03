// 接收 inject.js 的事件并存储；监听 X 的限制提示；在页面上显示可拖动的进度浮标；在发生关注的标签页里放音效。
(function () {
  // 插件刷新后，后台会把新版注入已打开的页面。旧版此时已和插件断开，新版接管；
  // 若已有一个仍然连着插件的实例在跑，就不重复启动，免得重复计数和出声。
  const alive = () => { try { return !!chrome.runtime.id; } catch (e) { return false; } };
  if (window.__xfpContent && window.__xfpContent.alive()) return;
  window.__xfpContent = { alive };
  document.querySelectorAll("#xfp-badge-host").forEach((el) => el.remove());

  const Stats = window.XFP_Stats;
  let events = [];
  let follows = {};
  let settings = Object.assign({}, Stats.DEFAULTS);
  let writing = Promise.resolve();
  let host = null;
  let ui = null;
  let pos = null;
  let timer = null;
  // 用户在插件里同意数据说明之前，不读页面、不记录，只显示一个去看说明的小提示
  let consented = false;
  let consentGeneration = 0;
  let askHost = null;
  let askDismissed = false;

  // 告诉 inject.js 现在能不能读网络响应
  function signal() {
    window.postMessage({ source: "xfp-ctl", on: consented && alive() }, "*");
  }

  chrome.storage.local.get(["events", "settings", "badgePos", "follows", "consent"], (data) => {
    consented = Stats.hasConsent(data.consent);
    signal();
    events = data.events || [];
    follows = data.follows || {};
    settings = Object.assign(settings, data.settings || {});
    pos = data.badgePos || null;
    render();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.consent) {
      const next = Stats.hasConsent(changes.consent.newValue);
      if (next !== consented) consentGeneration += 1;
      consented = next;
      if (!consented) {
        if (relTimer) clearTimeout(relTimer);
        relTimer = null;
        pendingRel.clear();
      }
      signal();
    }
    if (changes.events) events = changes.events.newValue || [];
    if (changes.follows) follows = changes.follows.newValue || {};
    if (changes.settings) settings = Object.assign({}, Stats.DEFAULTS, changes.settings.newValue || {});
    if (changes.badgePos) {
      pos = changes.badgePos.newValue || null;
      place();
    }
    render();
  });

  // 事件和关注名单一起写，排队执行，避免多个标签页同时写时互相覆盖
  function addEvent(ev) {
    const generation = consentGeneration;
    writing = writing.then(() => new Promise((resolve) => {
      if (!consented || generation !== consentGeneration) return resolve();
      chrome.storage.local.get(["events", "follows"], (data) => {
        if (!consented || generation !== consentGeneration) return resolve();
        const now = Date.now();
        const map = data.follows || {};
        const key = ev.user ? ev.user.toLowerCase() : "";
        if (ev.ok && key && ev.type === "follow") {
          const s = Stats.sourceOf(ev.path);
          map[key] = { ts: ev.ts, src: s.cat, via: s.via, fb: null, fbAt: null };
        } else if (ev.ok && key && ev.type === "unfollow" && map[key]) {
          ev.heldMs = ev.ts - map[key].ts;
          map[key].unfollowedAt = ev.ts;
        }
        if (ev.ok && key) queueRelations([{ name: ev.user, f: ev.type === "follow", self: true }]);
        const list = Stats.prune((data.events || []).concat(ev), now);
        events = list;
        follows = Stats.pruneFollows(map, now);
        chrome.storage.local.set({ events: list, follows }, resolve);
        render();
        playFor(ev);
      });
    }));
  }

  // 只更新名单里已有的人（你通过插件记录过的关注），其余数据不存
  function markFollowBack(users) {
    if (!consented) return;
    users = users.filter((u) => u.f !== false);
    if (!users.some((u) => follows[String(u.name).toLowerCase()])) return;
    const generation = consentGeneration;
    writing = writing.then(() => new Promise((resolve) => {
      if (!consented || generation !== consentGeneration) return resolve();
      chrome.storage.local.get(["follows"], (data) => {
        if (!consented || generation !== consentGeneration) return resolve();
        const map = data.follows || {};
        let changed = false;
        for (const u of users) {
          const f = map[String(u.name).toLowerCase()];
          if (!f || f.unfollowedAt) continue;
          // 回关一旦看到就记为是；之后没看到不改回否，避免页面数据不全时误判
          const fb = f.fb === true ? true : !!u.fb;
          if (f.fb !== fb) { f.fb = fb; f.fbAt = Date.now(); changed = true; }
        }
        if (!changed) return resolve();
        follows = map;
        chrome.storage.local.set({ follows: map }, resolve);
      });
    }));
  }

  // 只有点关注的这个标签页出声；其他开着 X 的标签页只更新画面
  function playFor(ev) {
    const Sound = window.XFP_Sound;
    if (!Sound || settings.sound === false) return;
    const vol = settings.volume;
    if (ev.limit) return Sound.limit(vol);
    if (ev.type !== "follow" || !ev.ok) return;
    const p = Stats.phase(Stats.compute(events, Date.now()), settings);
    if (p.done === p.size) Sound.complete(vol);
    else Sound.follow(Math.min(1, p.done / p.size), vol);
  }

  function saveSettings(patch) {
    settings = Object.assign({}, settings, patch);
    chrome.storage.local.set({ settings });
    render();
  }

  // 未回关名单的数据：把页面里读到的关注关系攒一会儿再写，滑动列表时不会频繁写存储
  const pendingRel = new Map();
  let relTimer = null;
  function queueRelations(users) {
    if (!consented) return;
    for (const u of users) pendingRel.set(String(u.name).toLowerCase(), u);
    if (!relTimer) relTimer = setTimeout(flushRelations, 1500);
  }
  function flushRelations() {
    relTimer = null;
    if (!consented || !pendingRel.size) return;
    const generation = consentGeneration;
    const batch = [...pendingRel.entries()];
    pendingRel.clear();
    writing = writing.then(() => new Promise((resolve) => {
      if (!consented || generation !== consentGeneration) return resolve();
      chrome.storage.local.get(["following"], (data) => {
        if (!consented || generation !== consentGeneration) return resolve();
        const map = data.following || {};
        const now = Date.now();
        for (const [key, u] of batch) {
          if (u.f === false) delete map[key];
          // 自己刚点的关注不知道对方是否关注你：沿用已知状态，没有就记为未知
          else if (u.self) map[key] = { name: u.name, fb: map[key] ? map[key].fb : null, seenAt: now };
          else map[key] = { name: u.name, fb: u.fb === true, seenAt: now };
        }
        chrome.storage.local.set({ following: map }, resolve);
      });
    }));
  }

  window.addEventListener("message", (msg) => {
    if (!alive()) return;
    if (msg.source !== window || !msg.data || msg.data.source !== "xfp") return;
    if (msg.data.kind === "hello") return signal();
    if (!consented) return;
    if (msg.data.kind === "fb") {
      queueRelations(msg.data.users || []);
      return markFollowBack(msg.data.users || []);
    }
    const ev = msg.data.event;
    if (!ev || (ev.type !== "follow" && ev.type !== "unfollow")) return;
    addEvent(ev);
  });

  // 接口没返回错误但页面弹了限制提示时（比如 X 改了接口），靠这里兜底记一条。
  const TOAST_FOLLOW = /follow|关注/i;
  const TOAST_LIMIT = /unable|can't|cannot|limit|无法|上限|限制|稍后/i;
  function checkToast(node) {
    if (!consented) return;
    const text = (node.innerText || node.textContent || "").trim();
    if (!text || text.length > 300 || !TOAST_FOLLOW.test(text) || !TOAST_LIMIT.test(text)) return;
    const now = Date.now();
    if (events.some((e) => e.limit && now - e.ts < 10000)) return;
    addEvent({ type: "follow", ok: false, limit: true, status: null, code: null, message: text, user: "", ts: now, fromToast: true });
  }
  // 兜底：对方主页上有"关注了你"标签时，记为已回关
  let lastIndicator = "";
  function checkFollowsYou() {
    if (!consented) return;
    const m = location.pathname.match(/^\/([^/]+)\/?$/);
    if (!m || !document.querySelector('[data-testid="userFollowIndicator"]')) return;
    const name = m[1].toLowerCase();
    if (name === lastIndicator) return;
    lastIndicator = name;
    markFollowBack([{ name, fb: true }]);
    if (document.querySelector('[data-testid$="-unfollow"]')) queueRelations([{ name: m[1], f: true, fb: true }]);
  }
  let indicatorTimer = null;

  // 识别你的账号名和关注总数，名单页用来提示"读到了多少、一共多少"
  let meSaved = "";
  let countSaved = null;
  function parseCount(text) {
    const m = String(text || "").replace(/,/g, "").match(/([\d.]+)\s*([KkMm万]?)/);
    if (!m) return null;
    const mult = { K: 1e3, k: 1e3, M: 1e6, m: 1e6, "万": 1e4 }[m[2]] || 1;
    return { n: Math.round(parseFloat(m[1]) * mult), approx: mult > 1 };
  }
  function checkMe() {
    if (!consented) return;
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const me = link ? (link.getAttribute("href") || "").replace(/^\//, "").split("/")[0] : "";
    if (!me) return;
    const patch = {};
    if (me !== meSaved) { meSaved = me; patch.me = me; }
    const a = document.querySelector(`a[href="/${me}/following" i]`);
    const c = a ? parseCount(a.textContent) : null;
    if (c && (!countSaved || c.n !== countSaved.n)) { countSaved = c; patch.followingCount = c; }
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  }

  function watchToasts() {
    new MutationObserver((muts) => {
      if (!consented) return;
      if (!indicatorTimer) indicatorTimer = setTimeout(() => { indicatorTimer = null; checkFollowsYou(); checkMe(); }, 800);
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          const hits = n.matches('[data-testid="toast"], [role="alert"]') ? [n] : n.querySelectorAll('[data-testid="toast"], [role="alert"]');
          hits.forEach((h) => setTimeout(() => checkToast(h), 50));
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // 外观设为浅色/深色时固定；自动时跟着 X 当前的背景色
  function theme() {
    if (settings.theme === "light" || settings.theme === "dark") return settings.theme;
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    if (!m) return "dark";
    const [r, g, b] = m.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
  }
  // 位置按离哪条边近来存：在屏幕下半部分就贴着底边算，展开面板时往上长，不会伸出屏幕
  const MARGIN = 8;
  function place() {
    if (!host) return;
    const p = pos || { h: "left", x: 12, v: "bottom", y: 12 };
    const w = host.offsetWidth || 248;
    const hgt = host.offsetHeight || 120;
    const x = Math.max(MARGIN, Math.min(p.x, window.innerWidth - w - MARGIN));
    const y = Math.max(MARGIN, Math.min(p.y, window.innerHeight - hgt - MARGIN));
    host.style.left = p.h === "left" ? x + "px" : "auto";
    host.style.right = p.h === "right" ? x + "px" : "auto";
    host.style.top = p.v === "top" ? y + "px" : "auto";
    host.style.bottom = p.v === "bottom" ? y + "px" : "auto";
  }

  // 按下后在整个窗口上跟踪鼠标，鼠标甩得再快也不会脱手
  function enableDrag() {
    let start = null;
    const move = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 5) return;
      if (!start.moved) {
        start.moved = true;
        ui.card.classList.add("dragging");
      }
      e.preventDefault();
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      const left = Math.max(MARGIN, Math.min(start.left + dx, window.innerWidth - w - MARGIN));
      const top = Math.max(MARGIN, Math.min(start.top + dy, window.innerHeight - h - MARGIN));
      Object.assign(host.style, { left: left + "px", top: top + "px", right: "auto", bottom: "auto" });
    };
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      if (!s.moved) return;
      ui.card.classList.remove("dragging");
      // 拖完后吞掉紧跟着的那次点击，不触发展开/收起
      ui.card.dataset.justDragged = "1";
      setTimeout(() => delete ui.card.dataset.justDragged, 0);
      const r = host.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      pos = {
        h: cx < window.innerWidth / 2 ? "left" : "right",
        x: Math.round(cx < window.innerWidth / 2 ? r.left : window.innerWidth - r.right),
        v: cy < window.innerHeight / 2 ? "top" : "bottom",
        y: Math.round(cy < window.innerHeight / 2 ? r.top : window.innerHeight - r.bottom)
      };
      place();
      chrome.storage.local.set({ badgePos: pos });
    };
    host.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.composedPath().some((el) => el.tagName === "A" || el.tagName === "BUTTON")) return;
      const r = host.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false, id: e.pointerId };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", end, true);
      window.addEventListener("pointercancel", end, true);
    });
    window.addEventListener("resize", place);
  }

  function ensureBadge() {
    if (host || !document.body) return;
    host = document.createElement("div");
    host.id = "xfp-badge-host";
    host.style.cssText = "position:fixed;z-index:2147483647;touch-action:none;";
    const shadow = host.attachShadow({ mode: "open" });
    ui = window.XFP_UI.mount(shadow, { floating: true, onSettings: saveSettings });
    document.body.appendChild(host);
    place();
    enableDrag();
  }

  // 没同意时的小提示：说清插件还没开始工作，点一下去看数据说明
  const ASK_CSS = `
    :host { all: initial; }
    .a { position: fixed; left: 12px; bottom: 12px; z-index: 2147483647; display: flex; align-items: center; gap: 10px;
      max-width: 320px; padding: 10px 12px; border-radius: 14px; box-sizing: border-box;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      background: #fff; color: #0f1419; box-shadow: 0 6px 24px rgba(15, 20, 25, .22), 0 1px 3px rgba(15, 20, 25, .12); }
    .a[data-theme="dark"] { background: #16181c; color: #e7e9ea; box-shadow: 0 6px 24px rgba(0, 0, 0, .55), 0 0 0 1px #2f3336; }
    svg { width: 28px; height: 28px; flex: none; }
    b { display: block; font-size: 13px; }
    span { font-size: 12px; opacity: .75; }
    button { all: unset; cursor: pointer; font-weight: 700; font-size: 12px; white-space: nowrap; }
    .go { background: #1366a6; color: #fff; padding: 6px 12px; border-radius: 999px; }
    .go:hover { background: #0f5a93; }
    .x { opacity: .6; padding: 2px 6px; font-size: 15px; }
    .x:hover { opacity: 1; }
    button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 2px; }
  `;
  // 图标直接内嵌：x.com 页面读不到插件里的图片文件（没开放 web_accessible_resources，也不想开放给网站探测）
  const ASK_ICON = `<svg viewBox="0 0 128 128" aria-hidden="true"><rect x="4" y="4" width="120" height="120" rx="28" fill="#0f1419"/><path d="M71.25 26.70 A38 38 0 0 1 97.24 45.58" stroke="#1d9bf0" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M101.72 59.37 A38 38 0 0 1 91.79 89.92" stroke="#1d9bf0" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M80.06 98.44 A38 38 0 0 1 47.94 98.44" stroke="#1d9bf0" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M36.21 89.92 A38 38 0 0 1 26.28 59.37" stroke="#ffad1f" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M30.76 45.58 A38 38 0 0 1 56.75 26.70" stroke="#38444d" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M64 46.0 V82.0 M46.0 64 H82.0" stroke="#fff" stroke-width="14" stroke-linecap="round"/></svg>`;
  function renderAsk(show) {
    if (!show || askDismissed) {
      if (askHost) { askHost.remove(); askHost = null; }
      return;
    }
    if (!askHost && document.body) {
      askHost = document.createElement("div");
      askHost.id = "xfp-ask-host";
      const sh = askHost.attachShadow({ mode: "open" });
      sh.innerHTML = `<style>${ASK_CSS}</style><div class="a" role="status">
        ${ASK_ICON}
        <div><b>关注计数器还没开始工作</b><span>需要你先看一下数据说明并同意</span></div>
        <button class="go" type="button">查看说明</button><button class="x" type="button" aria-label="这次先不看">×</button></div>`;
      sh.querySelector(".go").addEventListener("click", () => chrome.runtime.sendMessage({ open: "welcome" }));
      sh.querySelector(".x").addEventListener("click", () => { askDismissed = true; renderAsk(false); });
      document.body.appendChild(askHost);
    }
    if (askHost) askHost.shadowRoot.querySelector(".a").dataset.theme = theme();
  }

  function render() {
    // 插件被刷新或卸载后，这个旧实例收起浮标、停止工作
    if (!alive()) {
      clearInterval(timer);
      if (host) host.remove();
      renderAsk(false);
      return;
    }
    renderAsk(!consented);
    if (!consented) {
      if (host) host.style.display = "none";
      return;
    }
    if (!settings.showBadge) {
      if (host) host.style.display = "none";
      return;
    }
    ensureBadge();
    if (!ui) return;
    host.style.display = "";
    ui.card.dataset.theme = theme();
    const now = Date.now();
    ui.update(Stats.compute(events, now), settings, now, { fb: Stats.followBack(follows, now), churn: Stats.churn(events, now) });
  }

  // 给 following.js（关注列表页的未回关筛选）用
  window.__xfpContent.queueRelations = queueRelations;
  window.__xfpContent.theme = theme;

  function start() {
    render();
    watchToasts();
    timer = setInterval(render, 1000);
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
