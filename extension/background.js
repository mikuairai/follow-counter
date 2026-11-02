// 后台：工具栏图标上显示本轮进度或冷却分钟数；冷却等到以往解封时长时发一条系统通知。
importScripts("limits.js", "stats.js");
const Stats = self.XFP_Stats;

async function refresh() {
  const data = await chrome.storage.local.get(["events", "settings", "notifiedFor", "consent"]);
  // 没同意数据说明前：图标上不显示数字，不排计时
  if (!Stats.hasConsent(data.consent)) {
    await chrome.action.setBadgeText({ text: "" });
    chrome.alarms.clearAll();
    return;
  }
  const settings = Object.assign({}, Stats.DEFAULTS, data.settings || {});
  const now = Date.now();
  const s = Stats.compute(data.events || [], now);
  const b = Stats.iconBadge(s, settings);
  await chrome.action.setBadgeText({ text: b.text });
  await chrome.action.setBadgeBackgroundColor({ color: b.color });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#ffffff" });

  if (s.cooling) {
    // 冷却中每分钟刷新一次图标上的分钟数
    chrome.alarms.create("tick", { periodInMinutes: 1 });
    const when = s.bestKnownCooldown ? s.cooling.waitFrom + s.bestKnownCooldown : null;
    if (settings.notify !== false && when && when > now && data.notifiedFor !== s.cooling.waitFrom) {
      chrome.alarms.create("ready", { when });
    }
  } else {
    chrome.alarms.clear("tick");
    chrome.alarms.clear("ready");
  }
  // 没撞限时，歇满重置时间那一刻刷新图标，本轮数字归零
  if (!s.cooling && s.rest && !s.rest.rested) chrome.alarms.create("reset", { when: now + s.rest.reset - s.rest.elapsed + 1000 });
}

async function notifyReady() {
  const data = await chrome.storage.local.get(["events", "settings", "notifiedFor", "consent"]);
  if (!Stats.hasConsent(data.consent)) return;
  const settings = Object.assign({}, Stats.DEFAULTS, data.settings || {});
  const s = Stats.compute(data.events || [], Date.now());
  if (!s.cooling || settings.notify === false || data.notifiedFor === s.cooling.waitFrom) return;
  await chrome.storage.local.set({ notifiedFor: s.cooling.waitFrom });
  chrome.notifications.create("xfp-ready", {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "可以试着继续关注了",
    message: `距上次成功关注已等 ${Stats.formatDuration(s.cooling.elapsed)}，以往等这么久就能解封。`,
    priority: 1
  });
}

chrome.storage.onChanged.addListener((c) => { if (c.events || c.settings || c.consent) refresh(); });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "ready") notifyReady().then(refresh);
  else refresh();
});
chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  });
});
// 安装或刷新插件后，把新版注入已经打开的 X 页面，不用手动刷新页面
async function injectOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["inject.js"], world: "MAIN" });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["limits.js", "stats.js", "sound.js", "ui.js", "content.js", "following.js"] });
    } catch (e) {
      // 页面还没加载完或被浏览器拦下时跳过，下次打开页面会按 manifest 正常加载
    }
  }
}

// 页面里的按钮请求打开名单页（content script 不能直接开扩展页面）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.open === "list") chrome.tabs.create({ url: chrome.runtime.getURL("list.html") });
  if (msg && msg.open === "welcome") chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

chrome.runtime.onStartup.addListener(refresh);
chrome.runtime.onInstalled.addListener((details) => {
  refresh();
  injectOpenTabs();
  // 第一次安装：打开数据说明页，同意之后插件才开始工作
  if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});
refresh();
