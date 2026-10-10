// 扫描 notes/ 下所有 Markdown，生成 notes/index.json
// 用法：node scripts/build-index.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = 'notes';
const OUT = join(ROOT, 'index.json');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue; // 草稿和隐藏文件
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(md|markdown)$/i.test(e.name)) out.push(relative('.', p).split(sep).join('/'));
  }
  return out;
}

const list = walk(ROOT).sort((a, b) => a.localeCompare(b, 'zh'));
const json = JSON.stringify(list, null, 2) + '\n';
const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
if (old === json) console.log(`index.json 无变化（${list.length} 篇）`);
else { writeFileSync(OUT, json); console.log(`index.json 已更新（${list.length} 篇）`); }
