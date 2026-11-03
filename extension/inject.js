// 运行在页面自身环境，旁听 x.com 发出的关注/取关请求，把结果交给 content.js。
// 同时从 X 本来就会加载的用户资料里，读出"你关注的人有没有关注你"，用于回关统计。
// 只读取响应，不改请求、不发新请求。
// 默认关闭：用户在插件里同意数据说明后，content.js 才发来开启信号；没同意时一个响应都不读。
(function () {
  // 第一次安装时保存浏览器原本的 fetch/XHR。插件更新后注入的新版从原函数重新包一层、替换旧版，不会重复上报。
  // 早于本机制的旧版没有保存原函数，无法替换，只能等页面刷新。
  const VERSION = 5;
  if (window.__xfpInstalled && !window.__xfpOrig) return;
  if (window.__xfpVersion >= VERSION) return;
  window.__xfpInstalled = true;
  window.__xfpVersion = VERSION;
  window.__xfpOrig = window.__xfpOrig || {
    fetch: window.fetch,
    open: window.XMLHttpRequest && window.XMLHttpRequest.prototype.open,
    send: window.XMLHttpRequest && window.XMLHttpRequest.prototype.send
  };
  const ORIG = window.__xfpOrig;

  // 只认插件自己的开关信号；页面脚本即使伪造，读到的数据到了 content.js 那边仍会因未同意被丢弃
  let on = false;
  let consentGeneration = 0;
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "xfp-ctl") return;
    const next = e.data.on === true;
    if (next !== on) consentGeneration += 1;
    on = next;
  });
  // 新装入时问一声当前是否已同意（content.js 可能比本脚本先就绪）
  window.postMessage({ source: "xfp", kind: "hello" }, "*");

  const REST = /\/i\/api\/1\.1\/friendships\/(create|destroy)\.json/;
  const GQL = /\/graphql\/[^/]+\/(CreateFriendship|DestroyFriendship|Follow|Unfollow)\b/;
  const LIMIT_CODES = [88, 161, 344];
  const LIMIT_TEXT = /unable to follow|can't follow|cannot follow|limit|无法关注|上限|限制/i;
  const GQL_ANY = /\/i\/api\/graphql\//;

  function classify(url) {
    if (typeof url !== "string") return null;
    let m = url.match(REST);
    if (m) return m[1] === "create" ? "follow" : "unfollow";
    m = url.match(GQL);
    if (m) return /^(CreateFriendship|Follow)$/.test(m[1]) ? "follow" : "unfollow";
    return null;
  }

  function findUser(body) {
    if (!body || typeof body !== "object") return "";
    if (body.screen_name) return body.screen_name;
    const stack = [body];
    while (stack.length) {
      const cur = stack.pop();
      if (cur && typeof cur === "object") {
        if (typeof cur.screen_name === "string") return cur.screen_name;
        for (const k in cur) stack.push(cur[k]);
      }
    }
    return "";
  }

  function report(kind, status, text) {
    let body = null;
    try { body = JSON.parse(text); } catch (e) {}
    const err = body && Array.isArray(body.errors) && body.errors[0];
    const ok = status >= 200 && status < 300 && !err;
    const code = err && typeof err.code === "number" ? err.code : null;
    const message = err ? String(err.message || "") : "";
    const limit = !ok && (status === 429 || LIMIT_CODES.includes(code) || LIMIT_TEXT.test(message));
    window.postMessage({
      source: "xfp",
      event: { type: kind, ok, limit, status, code, message, user: ok ? findUser(body) : "", path: location.pathname, ts: Date.now() }
    }, "*");
  }

  // 找出响应里带关注关系的用户：你是否关注对方、对方是否关注你。兼容旧字段 legacy.* 和新字段 relationship_perspectives
  function scanUsers(body) {
    const out = [];
    const stack = [body];
    let steps = 0;
    while (stack.length && steps < 300000) {
      const cur = stack.pop();
      steps += 1;
      if (!cur || typeof cur !== "object") continue;
      if (cur.rest_id && (cur.legacy || cur.core)) {
        const leg = cur.legacy || {};
        const rp = cur.relationship_perspectives || {};
        const name = leg.screen_name || (cur.core && cur.core.screen_name);
        const following = leg.following === true || rp.following === true;
        const notFollowing = leg.following === false || rp.following === false;
        // f：你是否正在关注对方；只有字段明确存在时才上报"没关注"，避免数据不全时误删
        if (name && (following || notFollowing)) out.push({ name, uid: cur.rest_id, f: following, fb: leg.followed_by === true || rp.followed_by === true });
      }
      for (const k in cur) {
        const v = cur[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
    return out;
  }

  function reportUsers(text) {
    let body;
    try { body = JSON.parse(text); } catch (e) { return; }
    const users = scanUsers(body);
    if (users.length) window.postMessage({ source: "xfp", kind: "fb", users }, "*");
  }

  const origFetch = ORIG.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      const kind = on ? classify(url) : null;
      const generation = consentGeneration;
      const p = origFetch.apply(this, arguments);
      if (kind) {
        p.then((res) => {
          if (!on || generation !== consentGeneration) return;
          return res.clone().text().then((t) => {
            if (on && generation === consentGeneration) report(kind, res.status, t);
          });
        })
          .catch(() => {});
      } else if (on && typeof url === "string" && GQL_ANY.test(url)) {
        p.then((res) => {
          if (!on || generation !== consentGeneration) return;
          return res.clone().text().then((t) => {
            if (on && generation === consentGeneration) reportUsers(t);
          });
        }).catch(() => {});
      }
      return p;
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = ORIG.open;
    const origSend = ORIG.send;
    XHR.prototype.open = function (method, url) {
      this.__xfpKind = classify(String(url));
      this.__xfpGql = !this.__xfpKind && GQL_ANY.test(String(url));
      return origOpen.apply(this, arguments);
    };
    const xhrText = (x) => {
      try { return x.responseType === "" || x.responseType === "text" ? x.responseText : JSON.stringify(x.response); } catch (e) { return ""; }
    };
    XHR.prototype.send = function () {
      if (!on) return origSend.apply(this, arguments);
      const generation = consentGeneration;
      if (this.__xfpKind) {
        const kind = this.__xfpKind;
        this.addEventListener("loadend", () => {
          if (on && generation === consentGeneration) report(kind, this.status, xhrText(this));
        });
      } else if (this.__xfpGql) {
        this.addEventListener("loadend", () => {
          if (on && generation === consentGeneration) reportUsers(xhrText(this));
        });
      }
      return origSend.apply(this, arguments);
    };
  }

  window.__xfpClassify = classify;
})();
