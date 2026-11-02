// 在你自己的「正在关注」页面：读每一行有没有"关注了你"标签，标出未回关的人；可自动往下滚动读完整个列表。
// 自动读取只是替你滚屏，X 加载数据的方式和手动滑一样；不点任何按钮，不发额外请求。
(function () {
  const alive = () => { try { return !!chrome.runtime.id; } catch (e) { return false; } };
  if (window.__xfpFollowing && window.__xfpFollowing.alive()) return;
  window.__xfpFollowing = { alive };
  document.querySelectorAll("#xfp-following-host, #xfp-following-style, #xfp-following-banner").forEach((el) => el.remove());

  const Stats = window.XFP_Stats;
  const UI = window.XFP_UI;
  let me = "";
  let keep = {};
  let following = {};
  let follows = {};
  let followingCount = null;
  let stopAtNon = true;
  // 自动往下读默认关闭：X 自动化规则禁止用脚本操作网页，开启前要先看风险说明并确认
  let auto = false;
  let confirming = false;
  let everRun = false;
  // 没同意数据说明之前，不显示面板、不读列表、不做标记
  let consented = false;
  // 自动读时已经停过的人，继续往下读时不再停
  const handled = new Set();
  let running = false;
  let counting = false;
  let userStopped = false;
  let finished = false;
  let note = "";
  let host = null;
  let box = null;
  let closed = false;
  let lastPath = "";
  let bannerHost = null;
  let bannerEl = null;
  let bannerTimer = null;
  let scanTimer = null;
  const sessionSeen = new Set();

  function onOwnFollowing() {
    if (!consented) return false;
    const m = location.pathname.match(/^\/([^/]+)\/following\/?$/);
    const self = me || meFromNav();
    return !!(m && self && m[1].toLowerCase() === self.toLowerCase());
  }
  function meFromNav() {
    const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    return a ? (a.getAttribute("href") || "").replace(/^\//, "").split("/")[0] : "";
  }

  // —— 读列表、做标记 ——
  // 标记只加 data 属性和页面级样式，不往 X 的节点里插子元素，避免干扰 X 自己的渲染
  const STYLE = `
    [data-testid="UserCell"][data-xfp] { position: relative; }
    [data-testid="UserCell"][data-xfp="non"] { box-shadow: inset 4px 0 0 #f4212e; background-image: linear-gradient(90deg, rgba(244,33,46,.08), rgba(244,33,46,0) 60%); }
    [data-testid="UserCell"][data-xfp="keep"] { box-shadow: inset 4px 0 0 #00ba7c; }
    [data-testid="UserCell"][data-xfp="non"]::after, [data-testid="UserCell"][data-xfp="keep"]::after {
      position: absolute; left: 16px; bottom: 6px; padding: 1px 8px; border-radius: 999px;
      font: 700 11px/1.6 -apple-system, "PingFang SC", sans-serif; pointer-events: none; }
    [data-testid="UserCell"][data-xfp="non"]::after { content: "未回关"; background: #f4212e; color: #fff; }
    [data-testid="UserCell"][data-xfp="keep"]::after { content: "保留"; background: #00ba7c; color: #fff; }
    [data-testid="UserCell"][data-xfp-focus] { outline: 2px solid #f4212e; outline-offset: -2px; border-radius: 4px; }
  `;
  function ensureStyle() {
    if (document.getElementById("xfp-following-style") || !document.head) return;
    const s = document.createElement("style");
    s.id = "xfp-following-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function cellName(cell) {
    for (const a of cell.querySelectorAll('a[href^="/"]')) {
      const m = (a.getAttribute("href") || "").match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (m) return m[1];
    }
    return "";
  }

  function scanCells() {
    if (!onOwnFollowing()) return 0;
    ensureStyle();
    const batch = [];
    document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="UserCell"]').forEach((cell) => {
      const name = cellName(cell);
      if (!name) return;
      const key = name.toLowerCase();
      const fb = !!cell.querySelector('[data-testid="userFollowIndicator"]');
      const youFollow = !!cell.querySelector('[data-testid$="-unfollow"]');
      const mark = keep[key] ? "keep" : fb ? "mutual" : youFollow ? "non" : "";
      if (cell.dataset.xfp !== mark) {
        if (mark) cell.dataset.xfp = mark;
        else delete cell.dataset.xfp;
      }
      const prev = following[key];
      sessionSeen.add(key);
      // 只在状态有变化或很久没更新时才写，滑动时不反复写存储
      if (!prev || prev.fb !== fb || !youFollow || Date.now() - prev.seenAt > 6 * 3600 * 1000) {
        batch.push({ name, f: youFollow, fb });
      }
    });
    if (batch.length && window.__xfpContent && window.__xfpContent.queueRelations) window.__xfpContent.queueRelations(batch);
    return batch.length;
  }

  new MutationObserver(() => {
    if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scanCells(); render(); }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // —— 自动往下读 ——
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function run(resume) {
    if (running || !auto) return;
    running = true;
    everRun = true;
    finished = false;
    note = "";
    userStopped = false;
    clearFocus();
    if (!resume) handled.clear();
    // 先倒数 3 秒告诉你页面要自己动了，期间可以取消；从"停在未回关"处继续时不再倒数
    counting = !resume;
    for (let s = 3; counting && s > 0; s -= 1) {
      banner("count", `${s} 秒后插件将自动往下滚动，帮你读取关注列表`);
      render();
      await sleep(1000);
      if (!running) return;
    }
    counting = false;
    render();
    let stall = 0;
    while (running && alive() && onOwnFollowing()) {
      if (stopAtNon && pauseAtNon()) return;
      const before = sessionSeen.size;
      const beforeY = window.scrollY;
      window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: "smooth" });
      // 速度接近手动浏览：每屏停 1.2–2.2 秒
      await sleep(1200 + Math.random() * 1000);
      if (!running) break;
      scanCells();
      render();
      banner("run", runText());
      // 既没读到新的人、页面也没往下动，才算卡住
      if (sessionSeen.size === before && window.scrollY <= beforeY + 10) {
        stall += 1;
        if (stall >= 6) {
          const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 50;
          finished = atBottom;
          note = atBottom ? "读到底了" : "暂时加载不出来，可能 X 在限流。歇几分钟再点继续";
          break;
        }
        await sleep(1500);
      } else {
        stall = 0;
      }
    }
    running = false;
    // 你手动停的，stop() 已经给过提示，不再覆盖
    if (!userStopped) banner(finished ? "done" : "stop", finished ? `读完了：共读取 ${Object.keys(following).length} 人，标红的是未回关` : note || "已停止");
    render();
  }
  function stop(reason) {
    if (!running) return;
    running = false;
    userStopped = true;
    note = counting ? "已取消" : reason || "已暂停";
    counting = false;
    banner("stop", `${note}。页面不会再自己滚动了`);
    render();
  }
  // 找到下一个还没停过的未回关（刚关注 3 天内的不停，对方可能还没看到），停下来把对方放到屏幕中间
  function pauseAtNon() {
    const now = Date.now();
    const cells = document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="UserCell"][data-xfp="non"]');
    for (const cell of cells) {
      const name = cellName(cell);
      const key = name.toLowerCase();
      if (!name || handled.has(key)) continue;
      handled.add(key);
      const tr = follows[key];
      if (tr && !tr.unfollowedAt && now - tr.ts < 3 * 24 * 3600 * 1000) continue;
      running = false;
      cell.dataset.xfpFocus = "1";
      cell.scrollIntoView({ block: "center", behavior: "smooth" });
      note = `停在 @${name}`;
      banner("found", `停在 @${name}：对方没有回关你。看完点「继续往下读」，插件接着往下找`);
      render();
      return true;
    }
    return false;
  }
  function clearFocus() {
    document.querySelectorAll("[data-xfp-focus]").forEach((c) => { delete c.dataset.xfpFocus; });
  }
  function runText() {
    const c = followingCount && followingCount.n;
    const total = Object.keys(following).length;
    return `插件正在自动往下滚动，读取你的关注列表 · 已读 ${total}${c ? ` / ${c}` : ""} 人，标红的是未回关`;
  }
  // 你自己往上滚或按键时停下，把控制权还给你
  window.addEventListener("wheel", (e) => { if (running && e.deltaY < 0) stop("你往上滚了，已暂停"); }, { passive: true });
  window.addEventListener("keydown", (e) => { if (running && e.key === "Escape") stop("已暂停"); });

  // —— 面板 ——
  const CSS = `
    :host { all: initial; }
    .p { --bg: #fff; --fg: #0f1419; --sub: #536471; --tile: #f7f9f9; --empty: #e1e8ed; --link: #1366a6;
      position: fixed; top: 64px; right: 16px; z-index: 2147483646; width: 268px; box-sizing: border-box; padding: 14px;
      background: var(--bg); color: var(--fg); border-radius: 14px;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      box-shadow: 0 6px 24px rgba(15, 20, 25, .22), 0 1px 3px rgba(15, 20, 25, .12); }
    .p[data-theme="dark"] { --bg: #16181c; --fg: #e7e9ea; --sub: #8b98a5; --tile: #202327; --empty: #2f3336; --link: #1d9bf0;
      box-shadow: 0 6px 24px rgba(0, 0, 0, .55), 0 0 0 1px #2f3336; }
    h3 { margin: 0 0 8px; font-size: 14px; font-weight: 800; display: flex; justify-content: space-between; align-items: center; }
    .x { all: unset; cursor: pointer; color: var(--sub); font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
    .x:hover { background: var(--tile); color: var(--fg); }
    .nums { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .n { background: var(--tile); border-radius: 10px; padding: 8px 10px; }
    .n span { display: block; font-size: 12px; color: var(--sub); }
    .n b { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .n.red b { color: #f4212e; }
    .bar { height: 6px; border-radius: 3px; background: var(--empty); overflow: hidden; margin: 10px 0 4px; }
    .bar i { display: block; height: 100%; background: #1d9bf0; border-radius: 3px; transition: width 400ms cubic-bezier(0.16, 1, 0.3, 1); }
    .sub { font-size: 12px; color: var(--sub); min-height: 18px; }
    .row { display: flex; gap: 6px; margin-top: 10px; }
    button.b { all: unset; box-sizing: border-box; flex: 1; text-align: center; cursor: pointer; padding: 8px 10px; border-radius: 999px;
      font-weight: 700; font-size: 13px; background: var(--tile); color: var(--fg); }
    button.b:hover { background: var(--empty); }
    button.b.primary { background: #1366a6; color: #fff; }
    button.b.primary:hover { background: #0f5a93; }
    button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 2px; }
    label { display: flex; align-items: flex-start; gap: 8px; margin-top: 10px; cursor: pointer; font-size: 12px; color: var(--sub); line-height: 1.45; }
    label b { display: block; font-size: 13px; color: var(--fg); font-weight: 700; margin-bottom: 1px; }
    input { accent-color: #1d9bf0; width: 16px; height: 16px; margin: 2px 0 0; flex: none; }
    .tip { margin-top: 8px; font-size: 12px; color: var(--sub); line-height: 1.45; }
    .sec { border-top: 1px solid var(--empty); margin-top: 12px; padding-top: 2px; }
    .risk { margin-top: 10px; padding: 10px 12px; border-radius: 10px; font-size: 12px; line-height: 1.55;
      background: rgba(244, 33, 46, .1); color: var(--stop); }
    .risk b { display: block; font-size: 13px; margin-bottom: 4px; }
    .risk a { color: inherit; font-weight: 700; text-underline-offset: 2px; }
    .risk .row { margin-top: 8px; }
    .risk button.b.danger { background: #b0141f; color: #fff; }
    .risk button.b.danger:hover { background: #8f0f18; }
    .warn { margin-top: 8px; font-size: 12px; line-height: 1.45; color: var(--stop); }
    .p { --stop: #b0141f; }
    .p[data-theme="dark"] { --stop: #ff6b75; }
    [hidden] { display: none !important; }
  `;
  // 顶部横幅：自动滚动前、中、后都说清楚页面为什么在动
  const BANNER_CSS = `
    :host { all: initial; }
    .bn { position: fixed; top: 12px; left: 50%; transform: translate(-50%, -140%); z-index: 2147483647;
      display: flex; align-items: center; gap: 10px; max-width: min(640px, calc(100vw - 32px)); box-sizing: border-box;
      padding: 10px 10px 10px 16px; border-radius: 999px; background: #0f1419; color: #fff;
      font: 600 13px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      box-shadow: 0 8px 28px rgba(0, 0, 0, .35); transition: transform 380ms cubic-bezier(0.16, 1, 0.3, 1); }
    .bn.show { transform: translate(-50%, 0); }
    .bn[data-k="run"], .bn[data-k="count"] { background: #1366a6; }
    .bn[data-k="done"] { background: #00653f; }
    .bn[data-k="found"] { background: #b0141f; }
    .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #fff; }
    .bn[data-k="run"] .dot { animation: pulse 1s ease-in-out infinite; }
    .bn[data-k="count"] .dot { animation: pulse .5s ease-in-out infinite; }
    .t { flex: 1; }
    .bb { all: unset; flex: none; cursor: pointer; padding: 5px 14px; border-radius: 999px; background: rgba(255, 255, 255, .18); font-weight: 700; }
    .bb:hover { background: rgba(255, 255, 255, .3); }
    .bb:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.7); } }
    @media (prefers-reduced-motion: reduce) { .bn { transition: none; } .dot { animation: none !important; } }
  `;
  function banner(kind, text) {
    if (!bannerHost) {
      if (!document.body) return;
      const el = document.createElement("div");
      el.id = "xfp-following-banner";
      const sh = el.attachShadow({ mode: "open" });
      sh.innerHTML = `<style>${BANNER_CSS}</style><div class="bn" role="status" aria-live="polite"><span class="dot"></span><span class="t"></span><button class="bb" type="button"></button></div>`;
      bannerEl = sh.querySelector(".bn");
      sh.querySelector(".bb").addEventListener("click", () => {
        if (running) stop("已暂停");
        else if (bannerEl.dataset.k === "found") run(true);
        else hideBanner();
      });
      document.body.appendChild(el);
      bannerHost = el;
    }
    clearTimeout(bannerTimer);
    bannerEl.dataset.k = kind;
    bannerEl.querySelector(".t").textContent = text;
    bannerEl.querySelector(".bb").textContent = kind === "count" ? "取消" : kind === "run" ? "暂停" : kind === "found" ? "继续往下读" : "知道了";
    requestAnimationFrame(() => bannerEl.classList.add("show"));
    if (kind === "done" || kind === "stop") bannerTimer = setTimeout(hideBanner, 6000);
  }
  function hideBanner() {
    if (bannerEl) bannerEl.classList.remove("show");
  }

  // 页面刚开始加载时 body 还不存在，等它出现再挂，挂上之后才算建好
  function ensurePanel() {
    if (host || !document.body) return;
    const el = document.createElement("div");
    el.id = "xfp-following-host";
    const shadow = el.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${CSS}</style>
      <div class="p" role="region" aria-label="未回关筛选">
        <h3>未回关筛选 <button class="x" type="button" aria-label="关闭">×</button></h3>
        <div class="nums">
          <div class="n"><span>已读取</span><b class="seen">0</b></div>
          <div class="n red"><span>未回关</span><b class="non">0</b></div>
        </div>
        <div class="bar"><i style="width:0"></i></div>
        <div class="sub status"></div>
        <div class="row">
          <button class="b primary go" type="button" hidden>自动往下读</button>
          <button class="b list" type="button">看名单</button>
        </div>
        <div class="tip manual">自己往下滑就行：插件边滑边把没回关的人标红，读到的人都会进名单。绿色「保留」是你在名单里标记不打算取关的人，不算未回关。</div>
        <div class="sec">
          <label class="opt"><input type="checkbox" class="auto"><span><b>自动往下读（有风险）</b>让插件替你往下滚动页面。默认关闭</span></label>
          <div class="risk" hidden>
            <b>开启前请先看清风险</b>
            X 的<a href="https://help.x.com/en/rules-and-policies/x-automation" target="_blank" rel="noopener">自动化规则</a>写明：不得用脚本操作 X 网页，违者可能被永久封号。自动往下读就是插件替你滚动页面，虽然只滚动、不点关注或取关，速度也接近手动，但 X 没有公布判定标准，插件无法保证不被判定违规。<br>不开也一样能用：自己往下滑，效果相同。
            <div class="row">
              <button class="b danger yes" type="button">了解风险，开启</button>
              <button class="b no" type="button">不开了</button>
            </div>
          </div>
          <div class="autoset" hidden>
            <label class="opt"><input type="checkbox" class="stopnon"><span><b>遇到未回关就停下</b>自动往下读时，碰到一个没回关的人就停住、把对方放到屏幕中间，你看完再点继续</span></label>
            <div class="tip">点「自动往下读」后，页面会自己往下滚，顶部有提示。往上滚、按 Esc 或点暂停随时停。</div>
            <div class="warn">已开启：有违反 X 自动化规则的风险。不需要时建议关掉。</div>
          </div>
        </div>
      </div>`;
    box = shadow.querySelector(".p");
    shadow.querySelector(".x").addEventListener("click", () => { closed = true; stop(); render(); });
    shadow.querySelector(".go").addEventListener("click", () => (running ? stop() : run(bannerEl && bannerEl.dataset.k === "found")));
    shadow.querySelector(".list").addEventListener("click", () => chrome.runtime.sendMessage({ open: "list" }));
    // 勾选的值要当场记下：存储是异步的，等回调时面板可能已按旧值重画过一次
    const saveOpt = (patch) => {
      chrome.storage.local.get(["settings"], (d) => {
        chrome.storage.local.set({ settings: Object.assign({}, d.settings || {}, patch) });
      });
      render();
    };
    shadow.querySelector(".stopnon").addEventListener("change", (e) => { stopAtNon = e.target.checked; saveOpt({ stopAtNon }); });
    // 勾选"自动往下读"只是打开风险说明，点了"我了解风险，开启"才真正开启；取消勾选立即关闭
    shadow.querySelector(".auto").addEventListener("change", (e) => {
      if (e.target.checked && !auto) {
        e.target.checked = false;
        confirming = true;
        render();
      } else if (!e.target.checked) {
        auto = false;
        confirming = false;
        stop("自动往下读已关闭");
        // 停在某个未回关上时关掉：去掉红框和"继续往下读"提示，免得点了没反应
        clearFocus();
        if (bannerEl && bannerEl.dataset.k === "found") hideBanner();
        if (/^停在 @/.test(note)) note = "";
        saveOpt({ autoScroll: false });
      }
    });
    shadow.querySelector(".yes").addEventListener("click", () => { auto = true; confirming = false; saveOpt({ autoScroll: true }); });
    shadow.querySelector(".no").addEventListener("click", () => { confirming = false; render(); });
    document.body.appendChild(el);
    host = el;
  }

  function render() {
    const show = alive() && onOwnFollowing() && !closed;
    if (!show) {
      if (host) host.style.display = "none";
      return;
    }
    ensurePanel();
    if (!host) return;
    host.style.display = "";
    box.dataset.theme = window.__xfpContent && window.__xfpContent.theme ? window.__xfpContent.theme() : "light";
    const $ = (s) => box.querySelector(s);
    const total = Object.keys(following).length;
    const non = Stats.nonFollowers(following, follows, Date.now(), keep).filter((r) => !r.keep).length;
    $(".seen").textContent = total;
    $(".non").textContent = non;
    const c = followingCount && followingCount.n;
    $(".bar i").style.width = c ? Math.min(100, Math.round((total / c) * 100)) + "%" : "0";
    $(".status").textContent = running
      ? `正在往下读…${c ? ` 已读 ${Math.min(100, Math.round((total / c) * 100))}%` : ""}`
      : note || (c ? `你一共关注了${followingCount.approx ? "约" : ""} ${c} 人` : "往下滑，插件边滑边读");
    $(".go").textContent = running ? "暂停" : finished ? "重新读一遍" : everRun ? "继续往下读" : "自动往下读";
    $(".stopnon").checked = stopAtNon;
    $(".go").hidden = !auto;
    $(".manual").hidden = auto;
    $(".auto").checked = auto;
    $(".risk").hidden = auto || !confirming;
    $(".autoset").hidden = !auto;
    // 顶部提示里的人数跟面板同步
    if (running && bannerEl && bannerEl.dataset.k === "run") bannerEl.querySelector(".t").textContent = runText();
  }

  // X 是单页应用，切换页面不刷新：定时检查是否进入/离开关注列表页
  function tick() {
    if (!alive()) {
      running = false;
      if (host) host.remove();
      if (bannerHost) bannerHost.remove();
      return;
    }
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (running && !onOwnFollowing()) stop("离开了关注列表，已暂停");
      closed = false;
      sessionSeen.clear();
      finished = false;
      note = "";
      scanCells();
    }
    render();
  }
  // 所有常量声明完才开始读存储，避免同步回调提前用到还没初始化的变量
  chrome.storage.local.get(["me", "keep", "following", "follows", "followingCount", "settings", "consent"], (d) => {
    consented = Stats.hasConsent(d.consent);
    me = d.me || "";
    keep = d.keep || {};
    following = d.following || {};
    follows = d.follows || {};
    followingCount = d.followingCount || null;
    stopAtNon = !(d.settings && d.settings.stopAtNon === false);
    auto = !!(d.settings && d.settings.autoScroll === true);
    tick();
  });
  chrome.storage.onChanged.addListener((c) => {
    if (c.me) me = c.me.newValue || "";
    if (c.keep) keep = c.keep.newValue || {};
    if (c.following) following = c.following.newValue || {};
    if (c.follows) follows = c.follows.newValue || {};
    if (c.followingCount) followingCount = c.followingCount.newValue || null;
    if (c.consent) {
      consented = Stats.hasConsent(c.consent.newValue);
      // 撤回同意：停下自动滚动，去掉页面上已有的标记
      if (!consented) {
        if (running) stop("已撤回同意");
        clearFocus();
        hideBanner();
        document.querySelectorAll('[data-xfp]').forEach((el) => { delete el.dataset.xfp; });
      }
    }
    if (c.settings) {
      stopAtNon = !(c.settings.newValue && c.settings.newValue.stopAtNon === false);
      auto = !!(c.settings.newValue && c.settings.newValue.autoScroll === true);
      if (!auto && running) stop("自动往下读已关闭");
    }
    render();
  });
  setInterval(tick, 1000);
})();
