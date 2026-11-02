// 运行：node tests/run.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Stats = require("../extension/stats.js");

const MIN = Stats.MIN;
const now = 10 * 24 * 60 * MIN;

// —— stats ——
const evs = [
  { type: "follow", ok: true, ts: now - 25 * 60 * MIN, user: "old" },
  { type: "follow", ok: true, ts: now - 50 * MIN, user: "a" },
  { type: "follow", ok: true, ts: now - 20 * MIN, user: "b" },
  { type: "follow", ok: true, ts: now - 10 * MIN, user: "c" },
  { type: "follow", ok: false, limit: true, ts: now - 5 * MIN, code: 161 },
  { type: "unfollow", ok: true, ts: now - 3 * MIN },
  { type: "follow", ok: true, ts: now - 2 * MIN, user: "d" }
];
const s = Stats.compute(evs, now);
assert.strictEqual(s.lastFollow.user, "d");
assert.strictEqual(s.sinceLastFollow, 2 * MIN);
assert.strictEqual(s.follow15m, 2);
assert.strictEqual(s.follow30m, 3);
assert.strictEqual(s.follow1h, 4);
assert.strictEqual(s.follow24h, 4);
assert.strictEqual(s.unfollow24h, 1);
assert.strictEqual(s.sinceLastLimit, 5 * MIN);
assert.deepStrictEqual(s.lastLimitWindows, { m15: 2, m30: 2, h1: 3, h24: 3 });
assert.strictEqual(Stats.prune(evs, now).length, 7);
assert.strictEqual(Stats.prune(evs, now + 7 * 24 * 60 * MIN - 30 * MIN).length, 5);
assert.strictEqual(Stats.formatDuration(65 * 1000), "1 分 5 秒");
assert.strictEqual(Stats.formatDuration(3 * 3600 * 1000 + 60000), "3 小时 1 分");

// —— 轮次与冷却：关注 15 个，歇 10 分钟再关注撞限，20 分钟后重试又失败，45 分钟后成功，再关注 2 个 ——
{
  const t0 = now - 3 * 60 * MIN;
  const list = [];
  for (let i = 0; i < 15; i++) list.push({ type: "follow", ok: true, ts: t0 + i * 20000 });
  const lastOk = t0 + 14 * 20000;
  const hit = lastOk + 10 * MIN;
  list.push({ type: "follow", ok: false, limit: true, ts: hit, code: 161 });
  const first = Stats.compute(list, hit + 1000);
  assert.strictEqual(first.cooling.elapsed, 10 * MIN + 1000, "冷却计时从最后一次成功关注算起，不从撞限归零");
  assert.strictEqual(first.cooling.sinceHit, 1000);
  list.push({ type: "follow", ok: false, limit: true, ts: lastOk + 20 * MIN, code: 161 });
  const mid = Stats.compute(list, lastOk + 30 * MIN);
  assert.strictEqual(mid.cooling.elapsed, 30 * MIN);
  assert.strictEqual(mid.cooling.retries, 1);
  assert.strictEqual(mid.cooling.cooldownMin, 20 * MIN);
  assert.strictEqual(mid.currentBatch, 0);
  assert.strictEqual(mid.lastBatch, 15);
  list.push({ type: "follow", ok: true, ts: lastOk + 45 * MIN });
  list.push({ type: "unfollow", ok: true, ts: lastOk + 46 * MIN });
  list.push({ type: "follow", ok: true, ts: lastOk + 47 * MIN });
  list.push({ type: "follow", ok: true, ts: lastOk + 48 * MIN });
  const after = Stats.compute(list, lastOk + 50 * MIN);
  assert.strictEqual(after.cooling, null);
  assert.strictEqual(after.currentBatch, 3);
  assert.strictEqual(after.bestKnownCooldown, 45 * MIN);
  const h = after.limitHits[0];
  assert.deepStrictEqual([h.batch, h.cooldownMin, h.cooldownMax], [15, 20 * MIN, 45 * MIN]);

  // 阶段、账号规律、工具栏图标
  const D = Stats.DEFAULTS;
  assert.strictEqual(Stats.phase(first, D).name, "cooling");
  assert.deepStrictEqual(Stats.iconBadge(mid, D), { text: "30m", color: "#f4212e" });
  assert.strictEqual(Stats.phase(after, D).name, "going");
  assert.deepStrictEqual(Stats.iconBadge(after, D), { text: "3", color: "#1d9bf0" });
  assert.deepStrictEqual(Stats.rhythm(after), { count: 1, typical: 15, waitMin: 20 * MIN, waitMax: 45 * MIN });
  assert.strictEqual(Stats.roundSize(after, D).size, 15);
  // 上一轮只关注 12 个就撞限，额度仍是默认 15，不跟着变
  assert.strictEqual(Stats.roundSize(Object.assign({}, after, { lastBatch: 12 }), D).size, 15);
  assert.strictEqual(Stats.roundSize(after, Object.assign({}, D, { roundSize: 10 })).size, 10);
  const near = Object.assign({}, after, { currentBatch: 13 });
  assert.strictEqual(Stats.phase(near, D).name, "near");
  assert.strictEqual(Stats.iconBadge(near, D).color, "#ffad1f");
  assert.strictEqual(Stats.phase(Object.assign({}, after, { currentBatch: 15 }), D).name, "full");
  // 冷却已超过以往最快解封时长
  list.push({ type: "follow", ok: false, limit: true, ts: lastOk + 49 * MIN, code: 161 });
  const again = Stats.compute(list, lastOk + 48 * MIN + 50 * MIN);
  assert.strictEqual(Stats.phase(again, D).name, "ready");
}
assert.strictEqual(Stats.rhythm(Stats.compute([], now)), null);

// —— 回关统计与取关护栏 ——
{
  const D7 = 7 * 24 * 60 * MIN;
  const follows = {
    a: { ts: now - 1000, src: "followers", via: "Big", fb: true },
    b: { ts: now - 1000, src: "followers", via: "big", fb: false },
    c: { ts: now - 1000, src: "followers", via: "big", fb: true },
    d: { ts: now - D7 - 1000, src: "search", via: "", fb: false },
    e: { ts: now - 1000, src: "search", via: "", fb: null },
    f: { ts: now - 1000, src: "followers", via: "big", fb: true, unfollowedAt: now - 10 }
  };
  const fb = Stats.followBack(follows, now);
  assert.deepStrictEqual([fb.tracked, fb.known, fb.yes, fb.pending, fb.stale], [5, 4, 2, 1, 1]);
  assert.strictEqual(fb.rate, 0.5);
  const fol = fb.byCat.find((c) => c.cat === "followers");
  assert.deepStrictEqual([fol.n, fol.known, fol.yes], [3, 3, 2]);
  assert.strictEqual(fb.byVia[0].via, "Big", "同一账号大小写合并");
  assert.strictEqual(fb.byVia[0].known, 3);
  assert.strictEqual(Stats.followBack({}, now).rate, null);

  const old = { ts: now - 10 * D7 };
  const pruned = Stats.pruneFollows({ x: old, y: { ts: now } }, now);
  assert.deepStrictEqual(Object.keys(pruned), ["y"], "超过 60 天的关注记录清掉");

  const unf = (heldMs, ago) => ({ type: "unfollow", ok: true, ts: now - ago, heldMs });
  const evs = [];
  for (let i = 0; i < 4; i++) evs.push(unf(60 * MIN, i * MIN));
  assert.strictEqual(Stats.churn(evs, now).level, "ok");
  evs.push(unf(2 * 60 * MIN, 5 * MIN));
  const c1 = Stats.churn(evs, now);
  assert.deepStrictEqual([c1.unfollow24h, c1.quick24h, c1.level], [5, 5, "warn"]);
  evs.push(unf(10 * D7, 6 * MIN), unf(undefined, 7 * MIN));
  assert.strictEqual(Stats.churn(evs, now).quick24h, 5, "关注很久或不知道何时关注的不算刚关注就取关");
  for (let i = 0; i < 10; i++) evs.push(unf(MIN, 8 * MIN));
  assert.strictEqual(Stats.churn(evs, now).level, "high");
  evs.push(unf(MIN, 25 * 60 * MIN));
  assert.strictEqual(Stats.churn(evs, now).unfollow24h, 17, "超过 24 小时的不算");
}

// —— 未回关名单 ——
{
  const D = 24 * 60 * MIN;
  const following = {
    old: { name: "Old", fb: false, seenAt: now },
    back: { name: "Back", fb: true, seenAt: now },
    fresh: { name: "Fresh", fb: false, seenAt: now },
    unk: { name: "Unk", fb: null, seenAt: now },
    seenback: { name: "SeenBack", fb: false, seenAt: now },
    pre: { name: "Pre", fb: false, seenAt: now }
  };
  const follows = {
    old: { ts: now - 20 * D, src: "followers", via: "naval", fb: false },
    fresh: { ts: now - 1 * D, src: "search", via: "", fb: null },
    unk: { ts: now - 10 * D, src: "home", via: "", fb: null },
    seenback: { ts: now - 5 * D, src: "home", via: "", fb: true }
  };
  const rows = Stats.nonFollowers(following, follows, now);
  assert.deepStrictEqual(rows.map((r) => r.key), ["pre", "old", "unk", "fresh"], "已回关的不列；安装前关注的排最前，其余按关注时间从早到晚");
  assert.strictEqual(rows.find((r) => r.key === "fresh").fresh, true);
  assert.strictEqual(rows.find((r) => r.key === "old").via, "naval");
  assert.strictEqual(rows.find((r) => r.key === "pre").followedAt, null);
}

// —— inject.js：模拟页面环境 ——
async function runInject() {
  const posted = [];
  const responses = {
    "https://x.com/i/api/1.1/friendships/create.json": { status: 200, body: { id_str: "1", screen_name: "alice" } },
    "https://x.com/i/api/1.1/friendships/destroy.json": { status: 200, body: { screen_name: "bob" } },
    "https://x.com/i/api/1.1/friendships/create.json?x=limit": { status: 403, body: { errors: [{ code: 161, message: "You are unable to follow more people at this time." }] } },
    "https://x.com/i/api/graphql/abc/HomeTimeline": { status: 200, body: {} },
    "https://x.com/i/api/graphql/abc/Followers": { status: 200, body: { data: { list: [
      { __typename: "User", rest_id: "1", legacy: { screen_name: "Old", following: true, followed_by: true } },
      { __typename: "User", rest_id: "2", legacy: { screen_name: "nofb", following: true } },
      { __typename: "User", rest_id: "3", core: { screen_name: "NewFmt" }, legacy: {}, relationship_perspectives: { following: true, followed_by: true } },
      { __typename: "User", rest_id: "4", legacy: { screen_name: "stranger", followed_by: true } },
      { __typename: "User", rest_id: "5", legacy: { screen_name: "notyet", following: false, followed_by: true } }
    ] } } }
  };
  let reads = 0;
  class FakeResponse {
    constructor(r) { this.status = r.status; this._t = JSON.stringify(r.body); }
    clone() { reads += 1; return this; }
    text() { return Promise.resolve(this._t); }
  }
  class FakeXHR {
    constructor() { this.l = {}; this.responseType = ""; }
    open(m, u) { this.u = u; }
    addEventListener(n, f) { this.l[n] = f; }
    send() {
      const r = responses[this.u];
      this.status = r.status; this.responseText = JSON.stringify(r.body);
      setTimeout(() => this.l.loadend && this.l.loadend(), 0);
    }
  }
  const win = {
    fetch: (u) => Promise.resolve(new FakeResponse(responses[u])),
    XMLHttpRequest: FakeXHR,
    postMessage: (d) => posted.push(d),
    location: { pathname: "/big/followers" }
  };
  const msgListeners = [];
  win.addEventListener = (type, fn) => { if (type === "message") msgListeners.push(fn); };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/inject.js"), "utf8"), ctx);
  // 沙箱里脚本看到的 window 和外面的 win 不是同一个对象，开关信号要用里面那个
  const inner = vm.runInContext("window", ctx);
  const ctl = (on) => msgListeners.forEach((fn) => fn({ source: inner, data: { source: "xfp-ctl", on } }));
  assert.ok(posted.some((p) => p.kind === "hello"), "装入时问一声是否已同意");

  // 没同意：请求照常放行，但一个响应都不读、不上报
  await win.fetch("https://x.com/i/api/1.1/friendships/create.json");
  await win.fetch("https://x.com/i/api/graphql/abc/Followers");
  const x0 = new win.XMLHttpRequest();
  x0.open("POST", "https://x.com/i/api/1.1/friendships/destroy.json");
  x0.send();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(reads, 0, "同意前不读取任何响应");
  assert.ok(!x0.l.loadend, "同意前不给 XHR 挂监听");
  assert.strictEqual(posted.filter((p) => p.kind !== "hello").length, 0, "同意前不上报");
  // 页面里其他来源的消息不能打开开关
  msgListeners.forEach((fn) => fn({ source: {}, data: { source: "xfp-ctl", on: true } }));
  await win.fetch("https://x.com/i/api/1.1/friendships/create.json");
  assert.strictEqual(reads, 0, "别的窗口发来的开关信号无效");

  ctl(true);

  await win.fetch("https://x.com/i/api/1.1/friendships/create.json");
  await win.fetch("https://x.com/i/api/1.1/friendships/create.json?x=limit");
  await win.fetch("https://x.com/i/api/graphql/abc/HomeTimeline");
  await win.fetch("https://x.com/i/api/graphql/abc/Followers");
  const x = new win.XMLHttpRequest();
  x.open("POST", "https://x.com/i/api/1.1/friendships/destroy.json");
  x.send();
  await new Promise((r) => setTimeout(r, 20));

  const fbMsgs = posted.filter((p) => p.kind === "fb");
  assert.strictEqual(fbMsgs.length, 1, "空的时间线不上报，有关注关系的才上报");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(fbMsgs[0].users.map((u) => [u.name, u.f, u.fb]).sort())),
    [["NewFmt", true, true], ["Old", true, true], ["nofb", true, false], ["notyet", false, true]], "上报带明确关注关系的人，新旧字段都认；没有关注字段的不报");
  const evMsgs = posted.filter((p) => p.event);
  assert.strictEqual(evMsgs.length, 3, "只上报关注/取关请求");
  const [ok, lim, unf] = evMsgs.map((p) => p.event);
  assert.strictEqual(ok.path, "/big/followers", "记下点关注时所在页面");
  assert.ok(posted.every((p) => p.source === "xfp"));
  assert.deepStrictEqual([ok.type, ok.ok, ok.limit, ok.user], ["follow", true, false, "alice"]);
  assert.deepStrictEqual([lim.type, lim.ok, lim.limit, lim.code], ["follow", false, true, 161]);
  assert.deepStrictEqual([unf.type, unf.ok, unf.user], ["unfollow", true, "bob"]);
  assert.strictEqual(win.__xfpClassify("https://x.com/i/api/graphql/q/CreateFriendship"), "follow");
  assert.strictEqual(win.__xfpClassify("https://x.com/i/api/graphql/q/DestroyFriendship"), "unfollow");

  // 撤回同意后立刻停止读取
  ctl(false);
  const before = reads;
  const n = posted.length;
  await win.fetch("https://x.com/i/api/graphql/abc/Followers");
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(reads, before, "撤回后不再读取");
  assert.strictEqual(posted.length, n, "撤回后不再上报");
}

// 没撞限时歇满 15 分钟，本轮归零；不到 15 分钟仍是 full
{
  const D = Stats.DEFAULTS;
  const t0 = now - 60 * MIN;
  const ev = [];
  for (let i = 0; i < 15; i += 1) ev.push({ type: "follow", ok: true, ts: t0 + i * 10000 });
  const last = t0 + 14 * 10000;
  const resting = Stats.compute(ev, last + 10 * MIN);
  assert.strictEqual(resting.currentBatch, 15);
  assert.strictEqual(Stats.phase(resting, D).name, "full");
  assert.strictEqual(resting.rest.rested, false);
  const rested = Stats.compute(ev, last + 16 * MIN);
  assert.strictEqual(rested.currentBatch, 0);
  assert.strictEqual(rested.rest.rested, true);
  assert.strictEqual(Stats.phase(rested, D).name, "idle");
  // 歇够后再关注一个，是新一轮第 1 个，不是"超额 1 个"
  const next = ev.concat([{ type: "follow", ok: true, ts: last + 16 * MIN }]);
  assert.strictEqual(Stats.compute(next, last + 16 * MIN + 1000).currentBatch, 1);
  // 不到 15 分钟接着关注，仍算同一轮
  const early = ev.concat([{ type: "follow", ok: true, ts: last + 5 * MIN }]);
  assert.strictEqual(Stats.compute(early, last + 5 * MIN + 1000).currentBatch, 16);
}

// 同意记录：版本对得上才算同意
assert.strictEqual(Stats.hasConsent(null), false);
assert.strictEqual(Stats.hasConsent({ v: Stats.CONSENT_VERSION, at: 1 }), true);
assert.strictEqual(Stats.hasConsent({ v: Stats.CONSENT_VERSION - 1, at: 1 }), false, "说明改版后旧同意失效");
assert.strictEqual(Stats.hasConsent(true), false);

// 后台定期按保留时长清理：同意后清掉过期记录；没同意不动数据
async function runBackground(consent) {
  const now = Date.now();
  const D = 24 * 60 * MIN;
  const store = {
    consent,
    events: [{ type: "follow", ok: true, ts: now - 8 * D }, { type: "follow", ok: true, ts: now - D }],
    follows: { old: { ts: now - 61 * D }, fresh: { ts: now - D } }
  };
  const noop = () => {};
  const ev = { addListener: noop };
  const chrome = {
    storage: { local: { get: async (keys) => Object.fromEntries(keys.map((k) => [k, store[k]])), set: async (o) => Object.assign(store, o) }, onChanged: ev },
    action: { setBadgeText: async noop => {}, setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {} },
    alarms: { create: noop, clear: noop, clearAll: noop, get: async () => null, onAlarm: ev },
    notifications: { onClicked: ev, create: noop },
    runtime: { onMessage: ev, onStartup: ev, onInstalled: ev, getURL: (x) => x },
    tabs: { query: async () => [], create: noop }, windows: { update: noop }, scripting: { executeScript: async () => {} }
  };
  const sb = { chrome, console, Date, Math, Object, JSON, Promise, setTimeout };
  sb.self = sb;
  sb.importScripts = (...files) => files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension", f), "utf8"), ctx));
  const ctx = vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8"), ctx);
  await new Promise((r) => setTimeout(r, 20));
  return store;
}

runBackground({ v: Stats.CONSENT_VERSION, at: 1 }).then((s) => {
  assert.strictEqual(s.events.length, 1, "超过 7 天的关注记录被清掉");
  assert.deepStrictEqual(Object.keys(s.follows), ["fresh"], "超过 60 天的关注来源被清掉");
  return runBackground(null);
}).then((s) => {
  assert.strictEqual(s.events.length, 2, "没同意时不动数据");
}).then(() => runInject()).then(() => console.log("全部通过")).catch((e) => { console.error(e); process.exit(1); });
