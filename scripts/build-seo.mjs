// 为搜索引擎生成静态内容：p/<id>/index.html（每篇文章的纯静态页）、sitemap.xml、robots.txt，
// 并把文章列表写进 index.html 的 <noscript>。站点本身仍是 #/ 路由的单页应用，不受影响。
// 用法：npm i --no-save marked@12 && node scripts/build-seo.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { execSync } from 'node:child_process';
import { marked } from 'marked';

const ROOT = 'notes';
const OUT_DIR = 'p';
const SITE = 'https://' + (existsSync('CNAME') ? readFileSync('CNAME', 'utf8').trim() : 'trep123.github.io/cetrp');
const cfg = readFileSync('config.js', 'utf8');
const pick = k => (cfg.match(new RegExp(`\\b${k}\\s*:\\s*'([^']*)'`)) || [])[1] || '';
const SITE_TITLE = pick('title') || 'Notes';
const HOME_TITLE = pick('seoTitle') || SITE_TITLE;
// 文章页标题：太短（< 20 字）时补上作者说明，避免搜索引擎提示“标题过短”
const pageTitle = t => { const full = `${t} - ${SITE_TITLE}`; return full.length < 20 ? `${full} · ${AUTHOR || SITE_TITLE} 的技术笔记` : full; };
const AUTHOR = pick('author');
const LICENSE = pick('license');

// —— 与 js/app.js 保持一致 ——
const hashId = (str, seed) => { let h = seed >>> 0; for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
const makeId = slug => (hashId(slug, 0x811c9dc5).toString(36).padStart(7, '0') + hashId(slug, 0x9e3779b9).toString(36).padStart(7, '0')).slice(0, 10);
const unq = s => String(s).trim().replace(/^(['"])(.*)\1$/, '$2');
function parseFrontMatter(raw) {
  const m = raw.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { meta: {}, body: raw.replace(/^\uFEFF/, '') };
  const meta = {}; let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const li = line.match(/^\s*-\s+(.*)$/);
    if (li && key) { if (!Array.isArray(meta[key])) meta[key] = []; meta[key].push(unq(li[1])); continue; }
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    key = kv[1].toLowerCase();
    const v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) meta[key] = v.slice(1, -1).split(',').map(unq).filter(Boolean);
    else meta[key] = v === '' ? [] : unq(v);
  }
  return { meta, body: raw.slice(m[0].length) };
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const plain = md => md.replace(/```[\s\S]*?```/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, ' ').replace(/[#>*_`|~-]+/g, ' ').replace(/\s+/g, ' ').trim();
const fmtDate = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(md|markdown|pdf|docx)$/i.test(e.name) && !/^readme\.md$/i.test(e.name)) out.push(relative('.', p).split(sep).join('/'));
  }
  return out;
}
function lastmod(path) {
  try { const t = execSync(`git log -1 --format=%cI -- "${path}"`, { encoding: 'utf8' }).trim(); if (t) return t.slice(0, 10); } catch {}
  return statSync(path).mtime.toISOString().slice(0, 10);
}

function build(path) {
  const rel = path.slice(ROOT.length + 1);
  const name = rel.split('/').pop();
  const folder = rel.split('/').slice(0, -1);
  const isMd = /\.(md|markdown)$/i.test(name);
  if (!isMd) {
    const file = name.replace(/\.[^.]+$/, '');
    const fm = file.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[-_](.+)$/);
    const title = fm ? fm[4] : file;
    const kind = name.split('.').pop().toUpperCase();
    return { path, slug: rel, title, date: fm ? new Date(`${fm[1]}/${fm[2]}/${fm[3]}`) : null, category: folder, tags: [],
      description: `${title}（${kind} 文档），分类：${folder.join(' / ')}。`,
      html: `<p>这是一份 ${kind} 文档：<a href="/${encPath(path)}">下载 ${esc(name)}</a>。</p>` };
  }
  const { meta, body } = parseFrontMatter(readFileSync(path, 'utf8'));
  const file = name.replace(/\.(md|markdown)$/i, '');
  const fm = file.match(/^(\d{4}-\d{1,2}-\d{1,2})[-_](.+)$/);
  const h1 = body.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
  const title = (typeof meta.title === 'string' && meta.title) || (h1 && h1[1]) || (fm ? fm[2] : file);
  const dateStr = (typeof meta.date === 'string' && meta.date) || (fm && fm[1]) || '';
  let date = dateStr ? new Date(dateStr.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})/, (_, y, mo, d) => `${y}/${mo}/${d}`)) : null;
  if (date && isNaN(date)) date = null;
  let tags = meta.tags ?? meta.tag ?? [];
  if (typeof tags === 'string') tags = tags.split(/[,，\s]+/);
  tags = [...new Set(tags.map(t => String(t).trim()).filter(Boolean))];
  let content = body;
  if (h1 && h1[1] === title && body.trimStart().startsWith('#')) content = body.replace(h1[0], '');
  // 相对图片/链接改成站点绝对路径
  const base = posix.dirname(path);
  const fix = u => /^(https?:|mailto:|#|\/|data:)/i.test(u) ? u : '/' + encPath(posix.normalize(posix.join(base, decodeURI(u))));
  content = content.replace(/(!?\[[^\]]*\]\()([^)\s]+)/g, (_, a, u) => a + fix(u))
    .replace(/(<img[^>]+src=["'])([^"']+)/gi, (_, a, u) => a + fix(u));
  const description = (typeof meta.description === 'string' && meta.description) || plain(content).slice(0, 150);
  return { path, slug: rel.replace(/\.(md|markdown)$/i, ''), title, date, category: folder, tags, description, html: marked.parse(content) };
}

const STYLE = `body{margin:0;background:#f7f7f9;color:#222;font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:24px 18px 60px}header a{color:#555;text-decoration:none}.top{display:flex;justify-content:space-between;gap:12px;font-size:14px;margin-bottom:18px}
article{background:#fff;border-radius:12px;padding:26px 24px;box-shadow:0 2px 12px rgba(0,0,0,.06)}h1{font-size:1.7em;line-height:1.35;margin:0 0 8px}
.meta{color:#888;font-size:14px;margin-bottom:22px}.meta span{margin-right:12px}.meta .mm-toggle a{color:#2563eb;text-decoration:none}img{max-width:100%;height:auto}pre{background:#1e1e22;color:#eee;padding:14px;border-radius:8px;overflow:auto;font-size:14px}
code{font-family:Consolas,Menlo,monospace}:not(pre)>code{background:#f0f0f3;padding:1px 5px;border-radius:4px}table{border-collapse:collapse;display:block;overflow:auto;max-width:100%}
th,td{border:1px solid #ddd;padding:6px 10px}blockquote{margin:0;padding:4px 14px;border-left:4px solid #c9c9d1;color:#555}a{color:#2563eb}.btn{display:inline-block;margin-top:26px;padding:8px 16px;border-radius:8px;background:#2b2b2d;color:#fff;text-decoration:none}
footer{color:#999;font-size:13px;text-align:center;margin-top:28px}`;

function page(p) {
  const url = `${SITE}/p/${p.id}/`;
  const ld = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.description, url,
    author: { '@type': 'Person', name: AUTHOR }, ...(p.date ? { datePublished: fmtDate(p.date) } : {}), dateModified: p.lastmod, keywords: p.tags.join(',') };
  return `<!DOCTYPE html>
<html lang="zh-CN" data-mindmap="static">
<head>
<meta charset="UTF-8">
<script src="/protect.js?v=20261013b"></script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle(p.title))}</title>
<meta name="description" content="${esc(p.description)}">
${p.tags.length ? `<meta name="keywords" content="${esc(p.tags.join(','))}">\n` : ''}<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="${esc(SITE_TITLE)}">
<link rel="icon" href="/${esc(pick('avatar') || 'img/Cetrp.png')}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header class="top"><a href="/">← ${esc(SITE_TITLE)}</a><a href="/#/p/${p.id}">在博客中阅读</a></header>
<article>
<h1>${esc(p.title)}</h1>
<div class="meta">${p.date ? `<span>${fmtDate(p.date)}</span>` : ''}${p.category.length ? `<span>${esc(p.category.join(' / '))}</span>` : ''}${p.tags.map(t => `<span>#${esc(t)}</span>`).join('')}</div>
<div id="postBody">${p.html}</div>
<a class="btn" href="/#/p/${p.id}">在完整博客中阅读（目录、搜索、主题）</a>
</article>
<footer>© ${esc(AUTHOR)}${LICENSE ? ` · ${esc(LICENSE)}` : ''}</footer>
</div>
<script src="/js/mindmap.js" defer></script>
</body>
</html>
`;
}

// —— 生成 ——
const posts = walk(ROOT).map(build).map(p => ({ ...p, id: makeId(p.slug), lastmod: lastmod(p.path) }))
  .sort((a, b) => (b.date || 0) - (a.date || 0));

rmSync(OUT_DIR, { recursive: true, force: true });
for (const p of posts) { mkdirSync(join(OUT_DIR, p.id), { recursive: true }); writeFileSync(join(OUT_DIR, p.id, 'index.html'), page(p)); }

const newest = posts.map(p => p.lastmod).sort().pop() || new Date().toISOString().slice(0, 10);
writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${newest}</lastmod></url>
${posts.map(p => `  <url><loc>${SITE}/p/${p.id}/</loc><lastmod>${p.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`);
writeFileSync('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

// index.html：静态标题、描述、canonical，以及 <noscript> 文章列表
let idx = readFileSync('index.html', 'utf8');
const siteDesc = `${SITE_TITLE}：${AUTHOR} 的技术笔记，涵盖 Linux、华为网络、Windows Server、HCIA 等。`;
idx = idx.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(HOME_TITLE)}</title>`);
idx = idx.replace(/\n?\s*<!-- SEO:HEAD -->[\s\S]*?<!-- \/SEO:HEAD -->/, '');
idx = idx.replace(/(<title>[\s\S]*?<\/title>)/, `$1\n  <!-- SEO:HEAD -->\n  <meta name="description" content="${esc(siteDesc)}">\n  <link rel="canonical" href="${SITE}/">\n  <!-- /SEO:HEAD -->`);
const list = `<!-- SEO:LIST --><noscript><h1>${esc(SITE_TITLE)}</h1><ul>${posts.map(p => `<li><a href="/p/${p.id}/">${esc(p.title)}</a></li>`).join('')}</ul></noscript><!-- /SEO:LIST -->`;
if (/<!-- SEO:LIST -->[\s\S]*?<!-- \/SEO:LIST -->/.test(idx)) idx = idx.replace(/<!-- SEO:LIST -->[\s\S]*?<!-- \/SEO:LIST -->/, list);
else idx = idx.replace(/<\/body>/, `  ${list}\n</body>`);
writeFileSync('index.html', idx);

console.log(`SEO：生成 ${posts.length} 个静态文章页、sitemap.xml、robots.txt`);
