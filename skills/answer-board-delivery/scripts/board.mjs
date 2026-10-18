#!/usr/bin/env node
// Answer Board 一次性问答服务
// 用法: node board.mjs <questions.json> <answers.json> <port>
// GET  /        -> 渲染问题表单（推荐项预选，跟随系统主题）
// POST /submit  -> 答案写入文件 + stdout，200ms 后进程退出
import http from 'node:http';
import os from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , questionsPath, answersPath, portArg] = process.argv;
if (!questionsPath || !answersPath || !portArg) {
  console.error('Usage: node board.mjs <questions.json> <answers.json> <port>');
  process.exit(1);
}
const port = Number(portArg);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${portArg}`);
  process.exit(1);
}

let quiz;
try {
  quiz = JSON.parse(readFileSync(questionsPath, 'utf8'));
} catch (err) {
  console.error(`Failed to read questions: ${err.message}`);
  process.exit(1);
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

function renderMarkdownBody(text) {
  // HTML-escape first
  let escaped = esc(text);

  // Split by code blocks (```)
  const parts = escaped.split(/```/);
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Normal text: \n → <br>, then `...` → <code>...</code>
      let part = parts[i].replace(/\n/g, '<br>');
      part = part.replace(/`([^`]+)`/g, '<code>$1</code>');
      result += part;
    } else {
      // Code block: strip optional language id, wrap in <pre><code>
      let code = parts[i].replace(/^[a-z]+\n/, '\n').replace(/^\n+|\n+$/g, '');
      result += '<pre><code>' + code + '</code></pre>';
    }
  }
  return result;
}

const THEME_CSS = `
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9;
    --text: #1c1e21;
    --muted: #65676b;
    --card-bg: #fff;
    --card-border: #e0e2e6;
    --input-border: #d9dce1;
    --opt-border: #e4e6ea;
    --opt-hover: #b0b6bd;
    --accent: #2563eb;
    --accent-hover: #1d4ed8;
    --accent-bg: #f0f5ff;
    --accent-text: #2563eb;
    --shadow: rgba(37,99,235,.35);
    --success: #16a34a;
    --success-bg: #f0fdf4;
    --success-border: #bbf7d0;
    --success-text: #15803d;
    --code-bg: #f4f4f5;
    --code-text: #1c1e21;
    --code-border: #e0e2e6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #18191a;
      --text: #e4e6eb;
      --muted: #b0b3b8;
      --card-bg: #242526;
      --card-border: #3a3b3c;
      --input-border: #3a3b3c;
      --opt-border: #3a3b3c;
      --opt-hover: #4e4f50;
      --accent: #4895ef;
      --accent-hover: #5da4f5;
      --accent-bg: #1e2a3a;
      --accent-text: #4895ef;
      --shadow: rgba(72,149,239,.35);
      --success: #22c55e;
      --success-bg: #14261c;
      --success-border: #1a3d2a;
      --success-text: #4ade80;
      --code-bg: #1e1e1e;
      --code-text: #d4d4d4;
      --code-border: #3a3b3c;
    }
  }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
         margin: 0; background: var(--bg); color: var(--text); line-height: 1.65; }
`;

function renderSuccessPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>已提交</title>
<style>
  ${THEME_CSS}
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .success-card {
    background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px;
    padding: 48px 56px; text-align: center; max-width: 420px;
    box-shadow: 0 8px 32px rgba(0,0,0,.08);
    animation: fadeIn .4s ease-out;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  .check-circle {
    width: 72px; height: 72px; border-radius: 50%; margin: 0 auto 20px;
    background: var(--success-bg); border: 2px solid var(--success-border);
    display: flex; align-items: center; justify-content: center;
  }
  .check-circle svg { width: 36px; height: 36px; color: var(--success); }
  h1 { font-size: 20px; margin: 0 0 8px; font-weight: 600; }
  .sub { color: var(--muted); font-size: 14px; margin: 0; }
</style>
</head>
<body>
<div class="success-card">
  <div class="check-circle">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  </div>
  <h1>已收到回答</h1>
  <p class="sub">本轮提问结束，可以关闭此页面。</p>
</div>
</body>
</html>`;
}

function renderPage() {
  const facts = (quiz.facts || []).map((f) => `<li>${esc(f)}</li>`).join('');
  const defaults = (quiz.defaults || []).map((f) => `<li>${esc(f)}</li>`).join('');
  const questions = quiz.questions
    .map((q) => {
      const opts = q.options
        .map(
          (o) => `
        <label class="opt">
          <input type="radio" name="${esc(q.id)}" value="${esc(o.key)}" ${o.recommended ? 'checked' : ''}>
          <span class="opt-text"><strong>${esc(o.key)}.</strong> ${esc(o.text)}${o.recommended ? ' <em class="rec">（推荐）</em>' : ''}${o.desc ? `<br><span class="desc">${esc(o.desc)}</span>` : ''}</span>
        </label>`
        )
        .join('');
      return `
      <section class="q" id="${esc(q.id)}">
        <h3>${esc(q.id)} — ${esc(q.title)}</h3>
        <div class="q-body">${renderMarkdownBody(q.body)}</div>
        <div class="opts">${opts}</div>
        <input class="note" type="text" name="${esc(q.id)}_note" placeholder="补充说明 / 不同意的理由（可选）">
      </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(quiz.title)}</title>
<style>
  ${THEME_CSS}
  .wrap { max-width: 820px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin-bottom: 20px; }
  details { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; padding: 12px 16px; margin-bottom: 24px; }
  summary { cursor: pointer; font-weight: 600; }
  details ul { margin: 8px 0 4px; padding-left: 20px; }
  details li { margin: 4px 0; font-size: 14px; color: var(--text); }
  .q { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 18px 20px; margin-bottom: 18px; }
  .q h3 { margin: 0 0 6px; font-size: 16px; }
  .q-body { margin: 0 0 12px; font-size: 14px; color: var(--text); white-space: normal; }
  .opts { display: flex; flex-direction: column; gap: 8px; }
  .opt { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--opt-border); border-radius: 8px;
         padding: 10px 12px; cursor: pointer; font-size: 14px; }
  .opt:hover { border-color: var(--opt-hover); }
  .opt:has(input:checked) { border-color: var(--accent); background: var(--accent-bg); }
  .opt input { margin-top: 4px; }
  .rec { color: var(--accent-text); font-style: normal; font-size: 12px; }
  .desc { color: var(--muted); font-size: 13px; }
  .note { width: 100%; margin-top: 10px; padding: 8px 10px; border: 1px solid var(--input-border); border-radius: 8px; font-size: 14px;
          background: var(--card-bg); color: var(--text); }
  textarea { width: 100%; min-height: 80px; padding: 10px; border: 1px solid var(--input-border); border-radius: 10px; font-size: 14px; font-family: inherit;
             background: var(--card-bg); color: var(--text); }
  .submitbar { position: sticky; bottom: 12px; margin-top: 20px; text-align: center; }
  button { background: var(--accent); color: #fff; border: 0; border-radius: 10px; padding: 12px 48px;
           font-size: 16px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px var(--shadow); }
  button:hover { background: var(--accent-hover); }
  .hint { color: var(--muted); font-size: 13px; margin-top: 8px; }
  code {
    background: var(--code-bg); color: var(--code-text); padding: 2px 6px; border-radius: 4px;
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace; font-size: 13px;
    border: 1px solid var(--code-border);
  }
  pre {
    background: var(--code-bg); color: var(--code-text); padding: 12px 16px; border-radius: 8px;
    overflow-x: auto; margin: 12px 0; border: 1px solid var(--code-border);
  }
  pre code {
    background: transparent; padding: 0; border: 0; font-size: 13px; line-height: 1.5;
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(quiz.title)}</h1>
  <div class="sub">${esc(quiz.subtitle || '')} 推荐项已预选：全部同意就直接点最下面的「提交回答」。</div>
  ${facts || defaults ? `<details open><summary>背景事实 / 已按惯例默认的项</summary>${facts ? `<b>事实</b><ul>${facts}</ul>` : ''}${defaults ? `<b>已按项目惯例默认（有异议写进最下方总备注）</b><ul>${defaults}</ul>` : ''}</details>` : ''}
  <form id="quiz">
    ${questions}
    <section class="q">
      <h3>总备注</h3>
      <div class="q-body">任何想说的：推翻某条默认、补充约束、骂推荐答案……都写这里。</div>
      <textarea name="_global" placeholder="（可选）"></textarea>
    </section>
    <div class="submitbar">
      <button type="submit">提交回答</button>
      <div class="hint">提交后本轮结束，可以关闭页面。</div>
    </div>
  </form>
</div>
<script>
const form = document.getElementById('quiz');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const payload = { round: ${JSON.stringify(quiz.round)}, answers: {}, global: fd.get('_global') || '' };
  const missing = [];
  ${JSON.stringify(quiz.questions.map((q) => q.id))}.forEach((id) => {
    const choice = fd.get(id);
    if (!choice) { missing.push(id); return; }
    payload.answers[id] = { choice, note: fd.get(id + '_note') || '' };
  });
  if (missing.length) { alert('还有未选择的问题：' + missing.join(', ')); return; }
  const res = await fetch('/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) { alert('提交失败：HTTP ' + res.status); return; }
  const doc = document.documentElement;
  while (doc.lastChild) doc.removeChild(doc.lastChild);

  const head = document.createElement('head');
  const meta = document.createElement('meta');
  meta.charset = 'utf-8';
  head.appendChild(meta);
  const title = document.createElement('title');
  title.textContent = '已提交';
  head.appendChild(title);
  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(`
    :root { color-scheme: light dark; --bg: #f6f7f9; --text: #1c1e21; --muted: #65676b; --card-bg: #fff; --card-border: #e0e2e6; --success: #16a34a; --success-bg: #f0fdf4; --success-border: #bbf7d0; --success-text: #15803d; }
    @media (prefers-color-scheme: dark) { :root { --bg: #18191a; --text: #e4e6eb; --muted: #b0b3b8; --card-bg: #242526; --card-border: #3a3b3c; --success: #22c55e; --success-bg: #14261c; --success-border: #1a3d2a; --success-text: #4ade80; } }
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .success-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 48px 56px; text-align: center; max-width: 420px; box-shadow: 0 8px 32px rgba(0,0,0,.08); animation: fadeIn .4s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    .check-circle { width: 72px; height: 72px; border-radius: 50%; margin: 0 auto 20px; background: var(--success-bg); border: 2px solid var(--success-border); display: flex; align-items: center; justify-content: center; }
    .check-circle svg { width: 36px; height: 36px; color: var(--success); }
    h1 { font-size: 20px; margin: 0 0 8px; font-weight: 600; }
    .sub { color: var(--muted); font-size: 14px; margin: 0; }
  `)};
  head.appendChild(style);
  doc.appendChild(head);

  const body = document.createElement('body');
  const card = document.createElement('div');
  card.className = 'success-card';

  const circle = document.createElement('div');
  circle.className = 'check-circle';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', '20 6 9 17 4 12');
  svg.appendChild(polyline);
  circle.appendChild(svg);
  card.appendChild(circle);

  const h1 = document.createElement('h1');
  h1.textContent = '已收到回答';
  card.appendChild(h1);

  const sub = document.createElement('p');
  sub.className = 'sub';
  sub.textContent = '本轮提问结束，可以关闭此页面。';
  card.appendChild(sub);

  body.appendChild(card);
  doc.appendChild(body);
});
</script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage());
    return;
  }
  if (req.method === 'POST' && req.url === '/submit') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      let answers;
      try {
        answers = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('bad json');
        return;
      }
      writeFileSync(answersPath, JSON.stringify(answers, null, 2) + '\n');
      console.log('ANSWERS_RECEIVED round=' + answers.round);
      console.log(JSON.stringify(answers, null, 2));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderSuccessPage(), () => setTimeout(() => process.exit(0), 200));
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(port, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`LISTENING http://127.0.0.1:${port}/ round=${quiz.round}`);
  lan.forEach((ip) => console.log(`LISTENING http://${ip}:${port}/`));
});

server.on('error', (err) => {
  console.error(`Server error: ${err.message}`);
  process.exit(1);
});
