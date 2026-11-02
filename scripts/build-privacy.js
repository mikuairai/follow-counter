// 由 PRIVACY.md 生成 GitHub Pages 上的隐私政策网页 docs/privacy/index.html。
// 改了 PRIVACY.md 之后运行：node scripts/build-privacy.js
// 只支持 PRIVACY.md 用到的写法：标题、列表、段落、粗体、链接。
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const md = fs.readFileSync(path.join(root, "PRIVACY.md"), "utf8");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/([\w.+-]+@[\w-]+\.[\w.]+)/g, '<a href="mailto:$1">$1</a>');

const out = [];
let list = false;
let title = "Privacy Policy";
for (const raw of md.split("\n")) {
  const line = raw.trim();
  const closeList = () => { if (list) { out.push("</ul>"); list = false; } };
  if (!line) { closeList(); continue; }
  let m;
  if ((m = line.match(/^(#{1,3}) (.+)$/))) {
    closeList();
    const level = m[1].length;
    if (level === 1) title = m[2];
    out.push(`<h${level}>${inline(m[2])}</h${level}>`);
  } else if ((m = line.match(/^- (.+)$/))) {
    if (!list) { out.push("<ul>"); list = true; }
    out.push(`<li>${inline(m[1])}</li>`);
  } else {
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
}
if (list) out.push("</ul>");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --fg: #0f1419; --sub: #536471; --bg: #f4f6f8; --card: #fff; --link: #1366a6; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e7e9ea; --sub: #8b98a5; --bg: #0b0d10; --card: #16181c; --link: #1d9bf0; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.7 -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { max-width: 720px; margin: 32px auto; padding: 28px 32px; background: var(--card); border-radius: 16px; }
  h1 { font-size: 26px; line-height: 1.3; margin: 0 0 12px; }
  h2 { font-size: 20px; margin: 32px 0 8px; padding-top: 20px; border-top: 1px solid rgba(128, 128, 128, .25); }
  h3 { font-size: 16px; margin: 20px 0 4px; }
  p, li { margin: 6px 0; }
  ul { padding-left: 1.3em; }
  a { color: var(--link); }
  @media (max-width: 600px) { main { margin: 0; border-radius: 0; padding: 20px; } }
</style>
</head>
<body>
<main>
${out.join("\n")}
</main>
</body>
</html>
`;

const dest = path.join(root, "docs", "privacy", "index.html");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, html);
console.log("已生成 " + path.relative(root, dest));
