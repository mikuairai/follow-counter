// 进度组件：浮标和弹窗共用。mount 一次，之后每秒 update，DOM 只改不重建，动画才不会被打断。
(function (root) {
  const MAX_SEGMENTS = 30;

  // 线性图标，24 格、2px 描边，同一套笔画
  const ICONS = {
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    userMinus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    reply: '<path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    mute: '<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M22 9l-6 6M16 9l6 6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
  };
  function icon(name, size) {
    size = size || 16;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  const CSS = `
    :host { all: initial; }
    .card { --blue: #1d9bf0; --amber: #ffad1f; --red: #f4212e; --green: #00ba7c;
      --bg: #fff; --fg: #0f1419; --sub: #536471; --line: #eff3f4; --empty: #e1e8ed; --tile: #f7f9f9;
      --warn-t: #8a5300; --ok-t: #00653f; --stop-t: #b0141f; --link: #1366a6;
      position: relative; box-sizing: border-box; width: 248px; padding: 12px 14px 11px;
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
      color: var(--fg); background: var(--bg); border-radius: 14px; }
    .card[data-theme="dark"] { --bg: #16181c; --fg: #e7e9ea; --sub: #8b98a5; --line: #2f3336; --empty: #2f3336; --tile: #202327;
      --warn-t: var(--amber); --ok-t: var(--green); --stop-t: #ff6b75; --link: var(--blue); }
    .card.floating { box-shadow: 0 6px 24px rgba(15, 20, 25, .22), 0 1px 3px rgba(15, 20, 25, .12); cursor: pointer; user-select: none; }
    .card.floating[data-theme="dark"] { box-shadow: 0 6px 24px rgba(0, 0, 0, .55), 0 0 0 1px #2f3336; }
    .card.floating { transition: box-shadow 200ms, transform 200ms cubic-bezier(0.16, 1, 0.3, 1); }
    .card.dragging { cursor: grabbing; transform: scale(1.03); box-shadow: 0 14px 40px rgba(15, 20, 25, .3), 0 2px 6px rgba(15, 20, 25, .15); }
    .card.floating[data-theme="dark"].dragging { box-shadow: 0 14px 40px rgba(0, 0, 0, .7), 0 0 0 1px #3e4144; }
    .card.embedded { width: auto; padding: 0; }

    .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .label { color: var(--sub); }
    .count { font-variant-numeric: tabular-nums; letter-spacing: -0.02em; white-space: nowrap; }
    .n { display: inline-block; font-size: 26px; font-weight: 800; line-height: 1; }
    .cap { font-size: 14px; font-weight: 600; color: var(--sub); margin-left: 2px; }
    .n.bump { animation: bump 420ms cubic-bezier(0.16, 1, 0.3, 1); }

    .segs { display: flex; gap: 3px; margin: 9px 0 7px; height: 8px; }
    .seg { position: relative; flex: 1; border-radius: 3px; background: var(--empty); overflow: hidden; }
    .seg::before { content: ""; position: absolute; inset: 0; background: var(--seg-color, var(--blue));
      clip-path: inset(0 100% 0 0); transition: clip-path 260ms cubic-bezier(0.16, 1, 0.3, 1), background-color 300ms; }
    .seg.on::before { clip-path: inset(0 0 0 0); }
    .seg.tail { --seg-color: var(--amber); }
    .seg.over { --seg-color: var(--red); }
    .seg.just::before { transition-duration: 520ms; }
    .seg.just { animation: glow 900ms cubic-bezier(0.16, 1, 0.3, 1); }
    .segs.full .seg { animation: wave 700ms cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: calc(var(--i) * 28ms); }
    .bar { position: relative; height: 8px; border-radius: 4px; background: var(--empty); overflow: hidden; margin: 9px 0 7px; }
    .bar > b { position: absolute; inset: 0; background: var(--blue); transform-origin: left; transform: scaleX(var(--p, 0));
      transition: transform 400ms cubic-bezier(0.16, 1, 0.3, 1), background-color 300ms; }

    .status { font-weight: 600; min-height: 17px; }
    .status.warn { color: var(--warn-t); }
    .status.stop { color: var(--stop-t); }
    .status.ok { color: var(--ok-t); }
    .alert { display: none; margin-top: 6px; padding: 6px 9px; border-radius: 8px; font-size: 12px; font-weight: 600; line-height: 1.4; }
    .alert.warn { display: block; background: rgba(255, 173, 31, .16); color: var(--warn-t); }
    .alert.high { display: block; background: rgba(244, 33, 46, .14); color: var(--stop-t); }
    .grow { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 11px; }
    .grow .tile b { font-size: 17px; }

    .cool { display: none; }
    .card.cooling .cool { display: block; }
    .card.cooling .segs, .card.cooling .bar.round { display: none; }
    .card.cooling .cool { margin-top: 9px; }
    .cool .bar { margin: 5px 0 0; }
    .cool .bar > b { background: var(--amber); }
    .cool.ready .bar > b { background: var(--green); }
    .cool-line { display: flex; justify-content: space-between; color: var(--sub); font-variant-numeric: tabular-nums; }

    .foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; padding-top: 7px;
      border-top: 1px solid var(--line); color: var(--sub); font-variant-numeric: tabular-nums; }
    .timer { color: var(--fg); font-weight: 600; transition: color 600ms; }
    .timer.flash { color: var(--blue); transition: none; }
    .card.min .cool-line, .card.min .foot { display: none; }

    .chip { position: absolute; right: 12px; top: -10px; padding: 3px 9px; border-radius: 999px;
      background: var(--blue); color: #fff; font-weight: 700; font-size: 12px; white-space: nowrap;
      pointer-events: none; opacity: 0; }
    .chip.go { animation: chip 1100ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }

    @keyframes bump { 0% { transform: translateY(45%); opacity: .2; } 100% { transform: none; opacity: 1; } }
    @keyframes glow { 0% { box-shadow: 0 0 0 0 rgba(29, 155, 240, .55); } 100% { box-shadow: 0 0 0 6px rgba(29, 155, 240, 0); } }
    @keyframes wave { 0% { transform: none; filter: none; } 40% { transform: scaleY(1.6); filter: brightness(1.35); } 100% { transform: none; filter: none; } }
    @keyframes chip { 0% { opacity: 0; transform: translateY(8px) scale(.9); } 18% { opacity: 1; transform: translateY(-4px) scale(1); }
      70% { opacity: 1; transform: translateY(-10px); } 100% { opacity: 0; transform: translateY(-18px); } }
    @keyframes fade { 0% { opacity: 0; } 20% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; } }

    .foot .open-hint { display: inline-flex; align-items: center; gap: 2px; }
    .foot .open-hint svg { transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1); }
    .card.open .foot .open-hint svg { transform: rotate(180deg); }
    .more { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 320ms cubic-bezier(0.16, 1, 0.3, 1); }
    .card.open .more { grid-template-rows: 1fr; }
    .more-in { overflow: hidden; min-height: 0; }
    .more-head { display: flex; align-items: center; justify-content: space-between; margin: 11px 0 7px; font-weight: 700; }
    .icon-btn { all: unset; display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: 999px;
      color: var(--sub); font-size: 11px; font-weight: 600; cursor: pointer; }
    .icon-btn:hover { background: var(--tile); color: var(--fg); }
    .icon-btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
    .icon-btn.on { color: var(--link); }
    .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .tile { background: var(--tile); border-radius: 10px; padding: 7px 9px 8px; }
    .tile .t-top { display: flex; align-items: center; gap: 5px; color: var(--sub); font-size: 11px; }
    .tile .t-val { margin-top: 3px; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .tile .t-val b { font-size: 17px; font-weight: 800; }
    .tile .t-val span { font-size: 11px; color: var(--sub); margin-left: 2px; }
    .tile .mini { height: 4px; border-radius: 2px; background: var(--empty); margin-top: 5px; overflow: hidden; }
    .tile .mini b { display: block; height: 100%; background: var(--blue); transform-origin: left; transform: scaleX(var(--p, 0)); transition: transform 400ms; }
    .src { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; color: var(--link); text-decoration: none; font-size: 11px; font-weight: 600; }
    .src:hover { text-decoration: underline; text-underline-offset: 2px; }
    .card:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }

    @media (prefers-reduced-motion: reduce) {
      .card.dragging { transform: none; }
      .more, .foot .open-hint svg { transition: none; }
      .seg::before { clip-path: none; opacity: 0; transition: opacity 200ms; }
      .seg.on::before { opacity: 1; }
      .n.bump, .seg.just, .segs.full .seg { animation: none; }
      .bar > b { transition: none; }
      .chip.go { animation: fade 1100ms linear forwards; }
    }
  `;

  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s >= 3600) return root.XFP_Stats.formatDuration(ms);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function mount(container, opts) {
    opts = opts || {};
    const style = document.createElement("style");
    style.textContent = CSS;
    const card = document.createElement("div");
    card.className = "card " + (opts.floating ? "floating" : "embedded");
    card.innerHTML = `
      <div class="head"><span class="label">本轮已关注</span>
        <span class="count"><span class="n">0</span><span class="cap">/15</span></span></div>
      <div class="segs"></div>
      <div class="bar round" hidden><b></b></div>
      <div class="status"></div>
      <div class="alert" role="status"></div>
      <div class="cool">
        <div class="cool-line"><span class="cool-retry"></span><span class="cool-ref"></span></div>
        <div class="bar"><b></b></div>
      </div>
      <div class="foot"><span>上次关注 <span class="timer">—</span></span><span class="win"></span></div>
      ${opts.floating ? `<div class="more"><div class="more-in">
        <div class="grow">
          <div class="tile"><div class="t-top">${icon("users", 13)}回关率</div><div class="t-val g-rate"><b>—</b></div></div>
          <div class="tile"><div class="t-top">${icon("userMinus", 13)}24 时取关</div><div class="t-val g-unf"><b>0</b></div></div>
        </div>
        <div class="more-head"><span>X 官方限制</span><button class="icon-btn snd" type="button"></button></div>
        <div class="tiles">${root.XFP_LIMITS.tiles.map((x) => `
          <div class="tile" data-k="${x.key}"><div class="t-top">${icon(x.icon, 13)}${x.key === "follow" ? "24 时关注" : x.label}</div>
            <div class="t-val"><b>${x.value}</b><span>${x.unit}</span></div>
            ${x.key === "follow" ? `<div class="mini"><b></b></div>` : ""}</div>`).join("")}</div>
        <a class="src" href="${root.XFP_LIMITS.source}" target="_blank" rel="noopener">查看官方说明 ${icon("external", 11)}</a>
      </div></div>` : ""}
      <div class="chip"></div>`;
    container.appendChild(style);
    container.appendChild(card);

    const $ = (s) => card.querySelector(s);
    const segs = $(".segs");
    let current = {};
    if (opts.floating) {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", "关注进度，点击展开官方限制，按住可拖动");
      card.title = "点击展开官方限制 · 按住拖动换位置";
      const toggle = () => card.classList.toggle("open");
      card.addEventListener("click", (e) => { if (!card.dataset.justDragged && !e.target.closest("a, button")) toggle(); });
      card.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === card) { e.preventDefault(); toggle(); } });
      $(".snd").addEventListener("click", (e) => {
        e.stopPropagation();
        const on = !current.sound;
        if (opts.onSettings) opts.onSettings({ sound: on });
        if (on && root.XFP_Sound) root.XFP_Sound.follow(0.3, current.volume);
      });
    }
    const roundBar = $(".bar.round");
    let segCount = 0;
    let lastFollowTs = null;
    let lastCount = null;
    let wasFull = false;

    function restart(el, cls) {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    }

    function buildSegs(n) {
      segCount = n;
      segs.innerHTML = "";
      for (let i = 0; i < n; i++) {
        const s = document.createElement("i");
        s.className = "seg";
        s.style.setProperty("--i", i);
        segs.appendChild(s);
      }
    }

    function update(stats, settings, now, extra) {
      extra = extra || {};
      current = settings;
      const r = root.XFP_Stats.roundSize(stats, settings);
      const done = stats.currentBatch;
      const useSegs = r.size <= MAX_SEGMENTS;
      segs.hidden = !useSegs;
      roundBar.hidden = useSegs;
      if (useSegs && segCount !== r.size) buildSegs(r.size);

      const tailFrom = root.XFP_Stats.tailFrom(r.size);
      if (useSegs) {
        segs.querySelectorAll(".seg").forEach((s, i) => {
          s.classList.toggle("on", i < done);
          s.classList.toggle("tail", i >= tailFrom);
          s.classList.toggle("over", done > r.size);
        });
      } else {
        roundBar.style.setProperty("--p", Math.min(1, done / r.size));
      }

      const n = $(".n");
      $(".label").textContent = stats.cooling ? "冷却中 · 已等" : "本轮已关注";
      n.textContent = stats.cooling ? clock(stats.cooling.elapsed) : done;
      $(".cap").textContent = stats.cooling ? "" : "/" + r.size;

      const status = $(".status");
      const left = r.size - done;
      const ref = stats.bestKnownCooldown;
      const ready = !!(stats.cooling && ref && stats.cooling.elapsed >= ref);
      card.classList.toggle("cooling", !!stats.cooling);
      if (stats.cooling) {
        status.className = ready ? "status ok" : "status stop";
        status.textContent = ready ? "到时间了，可以试一次" : "撞到限制了，先别关注";
      } else if (left <= 0) {
        const rest = stats.rest;
        status.className = "status ok";
        status.textContent = done > r.size
          ? `已超过额度 ${done - r.size} 个，随时可能撞限`
          : rest ? `本轮完成，再歇 ${clock(Math.max(0, rest.reset - rest.elapsed))} 开新一轮` : "本轮完成，歇一下再继续";
      } else if (done >= tailFrom && done > 0) {
        status.className = "status warn";
        status.textContent = `还剩 ${left} 个，慢一点`;
      } else {
        status.className = "status";
        status.textContent = done ? `还剩 ${left} 个`
          : stats.rest && stats.rest.rested ? `已歇够 ${Math.round(stats.rest.reset / 60000)} 分钟，新一轮开始` : `每轮额度 ${r.size}（${r.from}）`;
      }

      // 取关护栏：刚关注不久就取关的多了，提醒有被判 follow churn 的风险
      const alert = $(".alert");
      const ch = extra.churn;
      if (ch && ch.level !== "ok") {
        alert.className = "alert " + ch.level;
        alert.textContent = ch.quick24h >= ch.lines.warnQuick
          ? `${ch.quick24h} 个刚关注就取关，再多可能被 X 判为刷粉`
          : `24 小时已取关 ${ch.unfollow24h} 个，慢一点更安全`;
      } else {
        alert.className = "alert";
        alert.textContent = "";
      }
      if (opts.floating && extra.fb) {
        const fb = extra.fb;
        $(".g-rate").innerHTML = fb.rate == null ? `<b>—</b><span>还在收集</span>` : `<b>${Math.round(fb.rate * 100)}%</b><span>${fb.yes}/${fb.known} 人</span>`;
        $(".g-unf").innerHTML = `<b>${ch ? ch.unfollow24h : 0}</b><span>个</span>`;
      }

      const cool = $(".cool");
      if (stats.cooling) {
        const c = stats.cooling;
        $(".cool-retry").textContent = `撞限于 ${clock(c.sinceHit)} 前` + (c.retries ? ` · 再败 ${c.retries} 次` : "");
        cool.querySelector(".bar > b").style.setProperty("--p", ref ? Math.min(1, c.elapsed / ref) : 0);
        cool.classList.toggle("ready", ready);
        $(".cool-ref").textContent = ref ? (ready ? "已过以往时长" : "以往 " + clock(ref)) : "首次撞限，解封后记下";
      }

      $(".timer").textContent = stats.lastFollow ? clock(stats.sinceLastFollow) + " 前" : "—";
      $(".win").innerHTML = opts.floating
        ? `<span class="open-hint">24 小时 ${stats.follow24h}/${root.XFP_LIMITS.followPerDay} ${icon("chevron", 12)}</span>`
        : `24 小时 ${stats.follow24h}/${root.XFP_LIMITS.followPerDay}`;
      if (opts.floating) {
        const snd = $(".snd");
        const on = settings.sound !== false;
        snd.classList.toggle("on", on);
        snd.innerHTML = icon(on ? "volume" : "mute", 13) + (on ? "音效开" : "音效关");
        snd.setAttribute("aria-pressed", String(on));
        const ft = $('.tile[data-k="follow"]');
        ft.querySelector(".t-val").innerHTML = `<b>${stats.follow24h}</b><span>/ 400</span>`;
        ft.querySelector(".mini").style.setProperty("--p", Math.min(1, stats.follow24h / root.XFP_LIMITS.followPerDay));
      }

      // 新的成功关注：只在已有基线之后触发，首次加载不放动画
      const ts = stats.lastFollow ? stats.lastFollow.ts : null;
      if (lastFollowTs !== null && ts && ts !== lastFollowTs && now - ts < 15000) {
        if (useSegs && done > 0) {
          const seg = segs.children[Math.min(done, segCount) - 1];
          if (seg) restart(seg, "just");
        }
        restart(n, "bump");
        const chip = $(".chip");
        chip.textContent = "+1" + (stats.lastFollow.user ? " @" + stats.lastFollow.user : "");
        restart(chip, "go");
        const timer = $(".timer");
        timer.classList.add("flash");
        requestAnimationFrame(() => requestAnimationFrame(() => timer.classList.remove("flash")));
      }
      const full = !stats.cooling && done >= r.size;
      if (full && !wasFull && lastCount !== null && done !== lastCount) restart(segs, "full");
      if (!full) segs.classList.remove("full");
      wasFull = full;
      lastFollowTs = ts || lastFollowTs || 0;
      lastCount = done;
    }

    return { card, update };
  }

  root.XFP_UI = { mount, icon };
})(typeof globalThis !== "undefined" ? globalThis : this);
