// 官方限制原文摘录。help.x.com 拦截自动抓取，以下取自 Wayback Machine 2026-09-26 快照。
// X 改规则后，改这里即可。
(function (root) {
  const LIMITS = {
    source: "https://help.x.com/en/rules-and-policies/x-limits",
    followSource: "https://help.x.com/en/using-x/x-follow-limit",
    checkedAt: "2026-09-26",
    followPerDay: 400,
    followRatioThreshold: 5000,
    // 卡片：value 是大数字，unit 跟在后面，note 是一句话说明
    tiles: [
      { key: "follow", icon: "userPlus", label: "关注", value: "400", unit: "个/天", note: "技术上限；另有规则禁止激进关注" },
      { key: "post", icon: "pen", label: "原创帖", value: "50", unit: "条/天", note: "未认证账号；还拆成半小时额度" },
      { key: "reply", icon: "reply", label: "回复", value: "200", unit: "条/天", note: "未认证账号" },
      { key: "dm", icon: "message", label: "私信", value: "500", unit: "条/天", note: "每天发送上限" },
      { key: "email", icon: "at", label: "改邮箱", value: "4", unit: "次/小时", note: "修改账号邮箱" },
      { key: "ratio", icon: "users", label: "关注总数", value: "5,000", unit: "个起", note: "之后按你的粉丝/关注比例放行" }
    ],
    notes: [
      "限制按账号统计，网页、手机、API、第三方应用的操作都算在内。",
      "网站繁忙时 X 可能临时调低限制，会在 X status 页面公告。",
      "撞到限制时会提示是哪一项；按时间计算的限制，等时间过去即可重试。",
      "X 规则禁止 follow churn（大量关注后取关以涨粉）和无差别地关注、取关大量无关账号。"
    ]
  };
  root.XFP_LIMITS = LIMITS;
  if (typeof module !== "undefined") module.exports = LIMITS;
})(typeof globalThis !== "undefined" ? globalThis : this);
