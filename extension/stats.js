// 由事件列表算出各项统计；content.js、popup.js 和测试共用。
(function (root) {
  const MIN = 60 * 1000;
  const KEEP_MS = 7 * 24 * 60 * MIN;
  const MAX_EVENTS = 3000;

  function countSince(events, type, now, ms) {
    return events.filter((e) => e.type === type && e.ok && now - e.ts <= ms).length;
  }

  function prune(events, now) {
    const kept = events.filter((e) => now - e.ts <= KEEP_MS);
    return kept.slice(-MAX_EVENTS);
  }

  // 撞限那一刻往前各窗口的成功关注数：用来摸出自己账号的实际阈值。
  function windowsBefore(events, ts) {
    const before = events.filter((e) => e.ts < ts);
    return {
      m15: countSince(before, "follow", ts, 15 * MIN),
      m30: countSince(before, "follow", ts, 30 * MIN),
      h1: countSince(before, "follow", ts, 60 * MIN),
      h24: countSince(before, "follow", ts, 24 * 60 * MIN)
    };
  }

  // 把撞限整理成"轮次"：从本轮最后一次成功关注（waitFrom）到下一次成功关注之间算一段冷却。
  // 等待从最后一次成功关注算起，因为撞限前你可能已经歇了一阵，那段时间也算在等。
  // 每次撞限失败给出下限（等了这么久还不够），第一次重新成功给出上限（等这么久已够）。
  function episodes(events, resetMs) {
    const gap = resetMs || ROUND_RESET;
    const list = [];
    let cur = null;
    let batch = 0;
    let lastOk = null;
    for (const e of events) {
      if (e.type !== "follow") continue;
      if (e.ok) {
        if (cur) {
          cur.end = e.ts;
          cur.cooldownMax = e.ts - cur.waitFrom;
          cur = null;
        } else if (lastOk != null && e.ts - lastOk >= gap) {
          // 没撞限、但已歇够重置时间，这一个算新一轮的第一个
          batch = 0;
        }
        batch += 1;
        lastOk = e.ts;
      } else if (e.limit) {
        if (!cur) {
          const waitFrom = lastOk != null ? lastOk : e.ts;
          cur = { start: e.ts, waitFrom, end: null, batch, retries: 0, lastFail: e.ts, cooldownMin: e.ts - waitFrom, cooldownMax: null, event: e };
          list.push(cur);
          batch = 0;
        } else {
          cur.retries += 1;
          cur.lastFail = e.ts;
          cur.cooldownMin = e.ts - cur.waitFrom;
        }
      }
    }
    return { list, currentBatch: batch, lastOk, ongoing: cur };
  }

  // 没撞限时，距上次成功关注满这么久就算新一轮（默认 15 分钟）
  const ROUND_RESET = 15 * MIN;

  function compute(events, now, resetMs) {
    const gap = resetMs || ROUND_RESET;
    const follows = events.filter((e) => e.type === "follow" && e.ok);
    const limits = events.filter((e) => e.limit);
    const lastFollow = follows[follows.length - 1] || null;
    const lastLimit = limits[limits.length - 1] || null;
    const ep = episodes(events, gap);
    const rested = !ep.ongoing && ep.lastOk != null && now - ep.lastOk >= gap;
    const done = ep.list.filter((x) => x.end != null);
    return {
      lastFollow,
      sinceLastFollow: lastFollow ? now - lastFollow.ts : null,
      follow15m: countSince(events, "follow", now, 15 * MIN),
      follow30m: countSince(events, "follow", now, 30 * MIN),
      follow1h: countSince(events, "follow", now, 60 * MIN),
      follow24h: countSince(events, "follow", now, 24 * 60 * MIN),
      unfollow24h: countSince(events, "unfollow", now, 24 * 60 * MIN),
      lastLimit,
      sinceLastLimit: lastLimit ? now - lastLimit.ts : null,
      lastLimitWindows: lastLimit ? windowsBefore(events, lastLimit.ts) : null,
      // 本轮（上次解封后）已成功关注几个；冷却中则为 0
      currentBatch: ep.ongoing || rested ? 0 : ep.currentBatch,
      // 没撞限时的休息进度：距上次成功关注多久、还差多久开新一轮
      rest: ep.ongoing || ep.lastOk == null ? null : { elapsed: now - ep.lastOk, reset: gap, rested },
      // 最近一次撞限时那一轮关注了几个，作为本轮的参考线
      lastBatch: ep.list.length ? ep.list[ep.list.length - 1].batch : null,
      // elapsed 从本轮最后一次成功关注算起；sinceHit 是距撞限那一下
      cooling: ep.ongoing ? { start: ep.ongoing.start, waitFrom: ep.ongoing.waitFrom, elapsed: now - ep.ongoing.waitFrom, sinceHit: now - ep.ongoing.start, retries: ep.ongoing.retries, cooldownMin: ep.ongoing.cooldownMin } : null,
      // 已结束冷却里最短的上限：从最后一次成功关注起等这么久，曾经能再关注
      bestKnownCooldown: done.length ? Math.min.apply(null, done.map((x) => x.cooldownMax)) : null,
      limitHits: ep.list.slice(-5).reverse().map((x) => Object.assign({ windows: windowsBefore(events, x.start) }, x)),
      rounds: ep.list
    };
  }

  const DEFAULT_ROUND = 15;
  const DEFAULTS = { showBadge: true, roundSize: 0, sound: true, volume: 0.6, notify: true, theme: "auto" };

  // 每轮额度：默认 15，只听用户设置。单次撞限的个数受上一轮余量影响，不拿来自动改额度
  function roundSize(stats, settings) {
    if (settings && settings.roundSize > 0 && settings.roundSize !== DEFAULT_ROUND) return { size: settings.roundSize, from: "手动设置" };
    return { size: DEFAULT_ROUND, from: "默认" };
  }

  // 最后几格算"快满了"
  function tailFrom(size) {
    return Math.max(0, size - Math.max(2, Math.round(size * 0.2)));
  }

  // 本轮所处阶段，浮标、弹窗、工具栏图标共用
  function phase(stats, settings) {
    const r = roundSize(stats, settings);
    const done = stats.currentBatch;
    if (stats.cooling) {
      const ref = stats.bestKnownCooldown;
      return { name: ref && stats.cooling.elapsed >= ref ? "ready" : "cooling", size: r.size, done, from: r.from };
    }
    if (done >= r.size) return { name: "full", size: r.size, done, from: r.from };
    if (done > 0 && done >= tailFrom(r.size)) return { name: "near", size: r.size, done, from: r.from };
    return { name: done > 0 ? "going" : "idle", size: r.size, done, from: r.from };
  }

  // 撞过的几轮里总结出的账号规律
  function rhythm(stats) {
    const all = stats.rounds;
    if (!all.length) return null;
    const batches = all.filter((x) => x.batch > 0).map((x) => x.batch).sort((a, b) => a - b);
    const done = all.filter((x) => x.end != null);
    return {
      count: all.length,
      typical: batches.length ? batches[Math.floor((batches.length - 1) / 2)] : null,
      // 等过却仍撞限的最长时间（下限）与等到就能关注的最短时间（上限）
      waitMin: done.length ? Math.max.apply(null, done.map((x) => x.cooldownMin)) : null,
      waitMax: done.length ? Math.min.apply(null, done.map((x) => x.cooldownMax)) : null
    };
  }

  // 工具栏图标上的小字和底色
  function iconBadge(stats, settings) {
    const p = phase(stats, settings);
    if (p.name === "cooling" || p.name === "ready") {
      const m = Math.floor(stats.cooling.elapsed / MIN);
      return { text: m >= 60 ? Math.floor(m / 60) + "h" : m + "m", color: p.name === "ready" ? "#00ba7c" : "#f4212e" };
    }
    if (!stats.lastFollow) return { text: "", color: "#1d9bf0" };
    const color = p.name === "full" ? "#00ba7c" : p.name === "near" ? "#ffad1f" : "#1d9bf0";
    return { text: String(p.done), color };
  }

  // —— 回关追踪 ——
  // 关注发生在哪个页面：决定"从哪关注最容易换来回关"
  const SOURCE_LABELS = {
    followers: "某人的粉丝列表", following: "某人的关注列表", engagers: "点赞/转发名单", replies: "帖子回复区",
    search: "搜索/探索", profile: "对方主页", home: "首页时间线", connect: "推荐关注", notifications: "通知", other: "其他"
  };
  const RESERVED = /^(i|settings|messages|compose|search|explore|home|notifications|bookmarks|lists|communities|jobs|premium|hashtag)$/i;
  function sourceOf(path) {
    path = String(path || "");
    let m;
    if (/^\/(search|explore)(\/|$)/.test(path)) return { cat: "search", via: "" };
    if (/^\/home(\/|$)/.test(path)) return { cat: "home", via: "" };
    if (/^\/notifications(\/|$)/.test(path)) return { cat: "notifications", via: "" };
    if (/^\/i\/connect/.test(path)) return { cat: "connect", via: "" };
    if ((m = path.match(/^\/([^/]+)\/(followers|verified_followers|followers_you_follow)(\/|$)/)) && !RESERVED.test(m[1])) return { cat: "followers", via: m[1] };
    if ((m = path.match(/^\/([^/]+)\/following(\/|$)/)) && !RESERVED.test(m[1])) return { cat: "following", via: m[1] };
    if ((m = path.match(/^\/([^/]+)\/status\/\d+\/(likes|retweets|reposts|quotes)(\/|$)/))) return { cat: "engagers", via: m[1] };
    if ((m = path.match(/^\/([^/]+)\/status\/\d+/))) return { cat: "replies", via: m[1] };
    if ((m = path.match(/^\/([^/]+)\/?(with_replies|media|likes|highlights|articles)?\/?$/)) && !RESERVED.test(m[1])) return { cat: "profile", via: m[1] };
    return { cat: "other", via: "" };
  }

  const FOLLOW_KEEP_MS = 60 * 24 * 60 * MIN;
  const MAX_FOLLOWS = 5000;
  function pruneFollows(map, now) {
    const entries = Object.entries(map || {}).filter(([, f]) => now - f.ts <= FOLLOW_KEEP_MS);
    entries.sort((a, b) => a[1].ts - b[1].ts);
    return Object.fromEntries(entries.slice(-MAX_FOLLOWS));
  }

  // follows：{ 小写用户名: { ts, src, via, fb: true/false/null, fbAt, unfollowedAt } }
  function followBack(follows, now) {
    const list = Object.values(follows || {}).filter((f) => !f.unfollowedAt);
    const byCat = {};
    const byVia = {};
    let known = 0;
    let yes = 0;
    let stale = 0;
    for (const f of list) {
      const c = (byCat[f.src] = byCat[f.src] || { cat: f.src, label: SOURCE_LABELS[f.src] || "其他", n: 0, known: 0, yes: 0 });
      c.n += 1;
      if (f.fb != null) { c.known += 1; known += 1; }
      if (f.fb === true) { c.yes += 1; yes += 1; }
      if (f.fb !== true && now - f.ts > 7 * 24 * 60 * MIN) stale += 1;
      if (f.via && (f.src === "followers" || f.src === "following" || f.src === "engagers" || f.src === "replies")) {
        const k = f.src + ":" + f.via.toLowerCase();
        const v = (byVia[k] = byVia[k] || { via: f.via, cat: f.src, label: SOURCE_LABELS[f.src], n: 0, known: 0, yes: 0 });
        v.n += 1;
        if (f.fb != null) v.known += 1;
        if (f.fb === true) v.yes += 1;
      }
    }
    const rate = (x) => (x.known ? x.yes / x.known : null);
    const sortRows = (rows) => rows.map((r) => Object.assign(r, { rate: rate(r) })).sort((a, b) => (b.known - a.known) || (b.n - a.n));
    return {
      tracked: list.length, known, yes, pending: list.length - known, stale,
      rate: known ? yes / known : null,
      byCat: sortRows(Object.values(byCat)),
      byVia: sortRows(Object.values(byVia)).filter((v) => v.known >= 3).slice(0, 5)
    };
  }

  // —— 未回关名单 ——
  // following：在页面数据里读到的、你正在关注的人 { 小写用户名: { name, fb, seenAt } }
  // follows：插件记录过的关注，用来补上"在哪关注的、关注了多久"
  // keep：保留名单 { 小写用户名: true }，这些人标记为 keep，由调用方决定是否显示
  function nonFollowers(following, follows, now, keep) {
    const rows = [];
    keep = keep || {};
    for (const [key, f] of Object.entries(following || {})) {
      if (f.fb === true) continue;
      const tr = (follows || {})[key];
      const tracked = tr && !tr.unfollowedAt ? tr : null;
      // 插件记过的回关也算数：主页上看到"关注了你"时，following 里可能还是旧值
      if (tracked && tracked.fb === true) continue;
      const age = tracked ? now - tracked.ts : null;
      rows.push({
        key, name: f.name || key, fb: f.fb, seenAt: f.seenAt,
        followedAt: tracked ? tracked.ts : null, age,
        src: tracked ? tracked.src : null, via: tracked ? tracked.via : "",
        fresh: age != null && age < QUICK_UNFOLLOW_MS,
        keep: !!keep[key]
      });
    }
    // 关注时间已知的按关注最久排前；插件安装前就关注的放最前（通常更久）
    const at = (r) => (r.followedAt == null ? -Infinity : r.followedAt);
    rows.sort((a, b) => (at(a) === at(b) ? a.key.localeCompare(b.key) : at(a) < at(b) ? -1 : 1));
    return rows;
  }

  // —— 取关护栏 ——
  // X 禁止 follow churn（大量关注后又取关来涨粉）。阈值是本插件自定的提醒线，X 没有公布具体数字。
  const QUICK_UNFOLLOW_MS = 72 * 60 * MIN;
  const CHURN_LINES = { warnQuick: 5, highQuick: 15, warnTotal: 50, highTotal: 100 };
  function churn(events, now) {
    const day = events.filter((e) => e.type === "unfollow" && e.ok && now - e.ts <= 24 * 60 * MIN);
    const quick = day.filter((e) => e.heldMs != null && e.heldMs < QUICK_UNFOLLOW_MS);
    const L = CHURN_LINES;
    const level = quick.length >= L.highQuick || day.length >= L.highTotal ? "high"
      : quick.length >= L.warnQuick || day.length >= L.warnTotal ? "warn" : "ok";
    return { unfollow24h: day.length, quick24h: quick.length, level, lastQuick: quick[quick.length - 1] || null, lines: L };
  }

  function formatDuration(ms) {
    if (ms == null) return "—";
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + " 秒";
    const m = Math.floor(s / 60);
    if (m < 60) return m + " 分 " + (s % 60) + " 秒";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " 小时 " + (m % 60) + " 分";
    return Math.floor(h / 24) + " 天 " + (h % 24) + " 小时";
  }

  // 数据说明的版本：说明内容有实质变化时加 1，旧的同意随之失效，需要重新同意
  const CONSENT_VERSION = 1;
  function hasConsent(c) {
    return !!(c && c.v === CONSENT_VERSION && c.at);
  }

  const api = { CONSENT_VERSION, hasConsent, compute, episodes, prune, windowsBefore, formatDuration, roundSize, tailFrom, phase, rhythm, iconBadge, sourceOf, pruneFollows, followBack, churn, nonFollowers, SOURCE_LABELS, DEFAULTS, DEFAULT_ROUND, ROUND_RESET, MIN };
  root.XFP_Stats = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
