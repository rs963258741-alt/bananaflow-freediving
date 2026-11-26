// 本機重新產生網站：node scripts/build.js
// 讀 content/site.json + cms/site.css，用 cms/render.js 產生 index.html 與 p/<id>/index.html。
// 平常不需要執行：後台按「發佈」時會在瀏覽器用同一份程式產生並直接 commit。
// 只用 Node 內建模組，不需要 npm install。
const fs = require('fs');
const path = require('path');
const CMS = require('../cms/render.js');

const ROOT = path.join(__dirname, '..');
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/site.json'), 'utf8'));
const css = fs.readFileSync(path.join(ROOT, 'cms/site.css'), 'utf8');
CMS.ensureIds(site);

const files = CMS.renderAll(site, { css });
const keep = new Set(files.map((f) => f.path));
// 移除已經不存在的獨立頁面
const pdir = path.join(ROOT, 'p');
if (fs.existsSync(pdir)) for (const d of fs.readdirSync(pdir)) {
  if (!keep.has('p/' + d + '/index.html')) fs.rmSync(path.join(pdir, d), { recursive: true, force: true });
}
for (const f of files) {
  const out = path.join(ROOT, f.path);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, f.html);
  console.log('[cms] ' + f.path + ' (' + (f.html.length / 1024).toFixed(1) + ' KB)');
}
