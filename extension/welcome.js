const Stats = window.XFP_Stats;
const $ = (id) => document.getElementById(id);

function applyTheme(settings) {
  const t = settings && (settings.theme === "light" || settings.theme === "dark") ? settings.theme
    : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = t;
}

function date(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

// 已同意：顶部显示状态，底部按钮收起；没同意：底部常驻两个按钮
function show(consent, declined) {
  const ok = Stats.hasConsent(consent);
  $("stOk").hidden = !ok;
  $("stOff").hidden = ok || !declined;
  $("acts").hidden = ok;
  if (ok) $("stOkText").textContent = `你已在 ${date(consent.at)}同意，插件正在工作。撤回同意在插件图标 →「设置」里。`;
}

chrome.storage.local.get(["consent", "settings"], (d) => {
  applyTheme(d.settings);
  show(d.consent, false);
});
chrome.storage.onChanged.addListener((c) => { if (c.consent) show(c.consent.newValue, false); });

$("agree").addEventListener("click", () => {
  const consent = { v: Stats.CONSENT_VERSION, at: Date.now() };
  chrome.storage.local.set({ consent }, () => {
    show(consent, false);
    $("stOkText").textContent = "已同意，插件开始工作了。已经打开的 X 页面不用刷新。";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});
$("decline").addEventListener("click", () => {
  show(null, true);
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("openX").addEventListener("click", () => chrome.tabs.create({ url: "https://x.com/" }));
