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

const GLOBAL_FIELD = '__answer_board_global';
const answerField = (id) => `__answer_board_q_${id}`;
const noteField = (id) => `__answer_board_note_${id}`;

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
  body { font-family: sans-serif;
         margin: 0; background: var(--bg); color: var(--text); line-height: 1.65; }
`;

// 成功页三件套（样式/卡片/关闭脚本）由服务端响应页与客户端就地重建共用，只维护这一份
const SUCCESS_CSS = `
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
  h1 { font-size: 23px; margin: 0 0 8px; font-weight: 600; }
  .sub { color: var(--muted); font-size: 16px; margin: 0; }
  .close-btn { margin-top: 24px; background: var(--accent); color: #fff; border: 0; border-radius: 10px;
               padding: 10px 32px; font-size: 15px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px var(--shadow); }
  .close-btn:hover { background: var(--accent-hover); }
  .close-hint { margin: 10px 0 0; color: var(--muted); font-size: 13px; min-height: 18px; }
`;

const SUCCESS_CARD_HTML = `
<div class="success-card">
  <div class="check-circle">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  </div>
  <h1>已收到回答</h1>
  <p class="sub">本轮提问结束。</p>
  <button class="close-btn" type="button">关闭标签页</button>
  <p class="close-hint" id="closeHint"></p>
</div>`;

// 浏览器只允许脚本关闭「由脚本打开」的标签页；从地址栏或外链直接打开的页面无法自动关闭。
// 所以先静默尝试 window.close()（能关的场合页面直接消失，用户零点击），关不掉再按平台给出
// 手动关闭指引——而不是报错式的「浏览器阻止了自动关闭」。
const CLOSE_JS = `
(function () {
  var hint = document.getElementById('closeHint');
  var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  var mac = /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
  function guidance() {
    if (coarse) return '回答已提交，直接划掉此页面即可。';
    return mac ? '回答已提交，按 ⌘W 关闭本页即可。' : '回答已提交，按 Ctrl+W 关闭本页即可。';
  }
  function tryClose() {
    window.close();
    setTimeout(function () {
      if (!window.closed && hint) hint.textContent = guidance();
    }, 250);
  }
  var btn = document.querySelector('.close-btn');
  if (btn) btn.addEventListener('click', tryClose);
  tryClose();
})();
`;

function renderSuccessPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>✓ 已提交</title>
<style>${SUCCESS_CSS}</style>
</head>
<body>
${SUCCESS_CARD_HTML}
<script>${CLOSE_JS}</script>
</body>
</html>`;
}

function renderPage() {
  const facts = (quiz.facts || []).map((f) => `<li>${esc(f)}</li>`).join('');
  const defaults = (quiz.defaults || []).map((f) => `<li>${esc(f)}</li>`).join('');
  const questions = quiz.questions
    .map((q) => {
      const type = q.type || 'choice';
      const fieldName = answerField(q.id);
      const noteName = noteField(q.id);
      const badges =
        (type === 'multi' ? ' <em class="opt-tag">（可多选）</em>' : '') +
        (q.optional ? ' <em class="opt-tag">（可跳过）</em>' : '');
      let control;
      if (type === 'text') {
        control = `<textarea name="${esc(fieldName)}" placeholder="${esc(q.placeholder || '')}">${esc(q.recommended || '')}</textarea>`;
      } else {
        const inputType = type === 'multi' ? 'checkbox' : 'radio';
        const opts = (q.options || [])
          .map(
            (o) => `
        <label class="opt">
          <input type="${inputType}" name="${esc(fieldName)}" value="${esc(o.key)}" ${o.recommended ? 'checked' : ''}>
          <span class="opt-text"><strong>${esc(o.key)}.</strong> ${esc(o.text)}${o.recommended ? ' <em class="rec">（推荐）</em>' : ''}${o.desc ? `<br><span class="desc">${esc(o.desc)}</span>` : ''}</span>
        </label>`
          )
          .join('');
        control = `<div class="opts">${opts}</div>`;
      }
      const note =
        type === 'text'
          ? ''
          : `<input class="note" type="text" name="${esc(noteName)}" placeholder="补充说明 / 不同意的理由（可选）">`;
      const prefill =
        type === 'text' && q.recommended
          ? '<div class="rec prefill">已预填推荐答案，可直接提交或修改</div>'
          : '';
      return `
      <section class="q" id="${esc(q.id)}">
        <h3>${esc(q.id)} — ${esc(q.title)}${badges}</h3>
        <div class="q-body">${renderMarkdownBody(q.body)}</div>
        ${prefill}
        ${control}
        ${note}
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
  h1 { font-size: 25px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin-bottom: 20px; }
  details { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; padding: 12px 16px; margin-bottom: 24px; }
  summary { cursor: pointer; font-weight: 600; }
  details ul { margin: 8px 0 4px; padding-left: 20px; }
  details li { margin: 4px 0; font-size: 16px; color: var(--text); }
  .q { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 18px 20px; margin-bottom: 18px; }
  .q h3 { margin: 0 0 6px; font-size: 18px; }
  .q-body { margin: 0 0 12px; font-size: 16px; color: var(--text); white-space: normal; }
  .opts { display: flex; flex-direction: column; gap: 8px; }
  .opt { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--opt-border); border-radius: 8px;
         padding: 10px 12px; cursor: pointer; font-size: 16px; }
  .opt:hover { border-color: var(--opt-hover); }
  .opt:has(input:checked) { border-color: var(--accent); background: var(--accent-bg); }
  .opt input { margin-top: 4px; }
  .rec { color: var(--accent-text); font-style: normal; font-size: 12px; }
  .opt-tag { color: var(--muted); font-style: normal; font-size: 12px; }
  .prefill { margin: 0 0 6px; }
  .desc { color: var(--muted); font-size: 13px; }
  .note { width: 100%; margin-top: 10px; padding: 8px 10px; border: 1px solid var(--input-border); border-radius: 8px; font-size: 16px;
          background: var(--card-bg); color: var(--text); }
  textarea { width: 100%; min-height: 80px; padding: 10px; border: 1px solid var(--input-border); border-radius: 10px; font-size: 16px; font-family: inherit;
             background: var(--card-bg); color: var(--text); }
  .submitbar { position: sticky; bottom: 12px; margin-top: 20px; text-align: center; }
  button { background: var(--accent); color: #fff; border: 0; border-radius: 10px; padding: 12px 48px;
           font-size: 16px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px var(--shadow); }
  button:hover { background: var(--accent-hover); }
  button:disabled { opacity: .65; cursor: wait; }
  .hint { color: var(--muted); font-size: 13px; margin-top: 8px; }
  code {
    background: var(--code-bg); color: var(--code-text); padding: 2px 6px; border-radius: 4px;
    font-family: monospace; font-size: 13px;
    border: 1px solid var(--code-border);
  }
  pre {
    background: var(--code-bg); color: var(--code-text); padding: 12px 16px; border-radius: 8px;
    overflow-x: auto; margin: 12px 0; border: 1px solid var(--code-border);
  }
  pre code {
    background: transparent; padding: 0; border: 0; font-size: 13px; line-height: 1.5;
  }
  .q-body p { margin: 6px 0; }
  .q-body h1, .q-body h2, .q-body h3, .q-body h4 { margin: 12px 0 6px; font-size: 17px; }
  .q-body ul, .q-body ol { margin: 6px 0; padding-left: 22px; }
  .q-body li { margin: 2px 0; }
  .q-body blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid var(--card-border); color: var(--muted); }
  .q-body table { border-collapse: collapse; margin: 8px 0; font-size: 13px; }
  .q-body th, .q-body td { border: 1px solid var(--card-border); padding: 4px 10px; }
  .q-body a { color: var(--accent-text); }
  .q-body hr { border: 0; border-top: 1px solid var(--card-border); margin: 10px 0; }
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
      <textarea name="${GLOBAL_FIELD}" placeholder="（可选）"></textarea>
    </section>
    <div class="submitbar">
      <button type="submit">提交回答</button>
      <div class="hint">提交后本轮结束，可以关闭页面。</div>
    </div>
  </form>
</div>
<script src="https://cdn.jsdelivr.net/npm/markdown-it@15.0.3/dist/browser/markdown-it.umd.min.js"
        integrity="sha384-ARStLecQmtLYjBgfD3+w+irhiSoLTnFk/ne6c0gRWQKQtC9791ZLMQ9D3OaBISt3"
        crossorigin="anonymous"></script>
<script>
// markdown 渐进增强：库就绪前保持服务端基础渲染（换行+代码块），就绪后原地升级
const MD_BODIES = ${JSON.stringify(Object.fromEntries(quiz.questions.map((q) => [q.id, q.body]))).replace(/</g, '\\u003c')};
let mdUpgraded = false;
function upgradeMarkdown() {
  if (mdUpgraded || typeof markdownit === 'undefined') return;
  mdUpgraded = true;
  const md = markdownit({ html: false, breaks: true, linkify: true, typographer: false });
  const baseLinkOpen = md.renderer.rules.link_open || ((tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener');
    return baseLinkOpen(tokens, idx, opts, env, self);
  };
  for (const [id, raw] of Object.entries(MD_BODIES)) {
    const el = document.querySelector('#' + CSS.escape(id) + ' .q-body');
    if (el) el.innerHTML = md.render(raw);
  }
}
function loadVendorMd() {
  if (mdUpgraded) return;
  const s = document.createElement('script');
  s.src = '/vendor/markdown-it.min.js';
  s.onload = upgradeMarkdown;
  document.head.appendChild(s);
}
{
  const cdnScript = document.querySelector('script[src*="markdown-it"]');
  if (typeof markdownit !== 'undefined') upgradeMarkdown();
  else {
    cdnScript.addEventListener('load', upgradeMarkdown);
    cdnScript.addEventListener('error', loadVendorMd);
    setTimeout(loadVendorMd, 2000);
  }
}
const form = document.getElementById('quiz');
const GLOBAL_FIELD = ${JSON.stringify(GLOBAL_FIELD)};
const answerField = (id) => '__answer_board_q_' + id;
const noteField = (id) => '__answer_board_note_' + id;
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const payload = { round: ${JSON.stringify(quiz.round)}, answers: Object.create(null), global: fd.get(GLOBAL_FIELD) || '' };
  const missing = [];
  const QMETA = ${JSON.stringify(Object.fromEntries(quiz.questions.map((q) => [q.id, { type: q.type || 'choice', optional: !!q.optional }]))).replace(/</g, '\\u003c')};
  Object.entries(QMETA).forEach(([id, meta]) => {
    if (meta.type === 'text') {
      const raw = fd.get(answerField(id)) || '';
      if (!raw.trim() && !meta.optional) { missing.push(id); return; }
      payload.answers[id] = { text: raw };
    } else if (meta.type === 'multi') {
      const choices = fd.getAll(answerField(id));
      if (!choices.length && !meta.optional) { missing.push(id); return; }
      payload.answers[id] = { choices, note: fd.get(noteField(id)) || '' };
    } else {
      const choice = fd.get(answerField(id)) || '';
      if (!choice && !meta.optional) { missing.push(id); return; }
      payload.answers[id] = { choice, note: fd.get(noteField(id)) || '' };
    }
  });
  if (missing.length) { alert('还有未作答的问题：' + missing.join(', ')); return; }
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  let res;
  try {
    res = await fetch('/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch {
    if (submitButton) submitButton.disabled = false;
    alert('提交失败：无法连接服务');
    return;
  }
  if (!res.ok) {
    if (submitButton) submitButton.disabled = false;
    alert('提交失败：HTTP ' + res.status);
    return;
  }
  // 就地重建成功页：样式、卡片结构和关闭脚本全部来自服务端的 SUCCESS_* 常量，两处不会漂移
  const doc = document.documentElement;
  while (doc.lastChild) doc.removeChild(doc.lastChild);

  const head = document.createElement('head');
  const meta = document.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.appendChild(meta);
  const viewport = document.createElement('meta');
  viewport.setAttribute('name', 'viewport');
  viewport.setAttribute('content', 'width=device-width, initial-scale=1');
  head.appendChild(viewport);
  const title = document.createElement('title');
  title.textContent = '✓ 已提交';
  head.appendChild(title);
  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(SUCCESS_CSS).replace(/</g, '\\u003c')};
  head.appendChild(style);
  doc.appendChild(head);

  const body = document.createElement('body');
  // SUCCESS_CARD_HTML 是编译期静态常量，不含任何用户输入，innerHTML 无 XSS 面
  body.innerHTML = ${JSON.stringify(SUCCESS_CARD_HTML).replace(/</g, '\\u003c')};
  doc.appendChild(body);
  const closeScript = document.createElement('script'); // createElement 注入的 script 会执行，innerHTML 解析出的不会
  closeScript.textContent = ${JSON.stringify(CLOSE_JS).replace(/</g, '\\u003c')};
  body.appendChild(closeScript);
});
</script>
</body>
</html>`;
}

let submissionInProgress = false;
let submitted = false;
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/vendor/markdown-it.min.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    res.end(readFileSync(new URL('./vendor/markdown-it.min.js', import.meta.url)));
    return;
  }
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage());
    return;
  }
  if (req.method === 'POST' && req.url === '/submit') {
    if (submissionInProgress || submitted) {
      res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('submission already received');
      return;
    }
    submissionInProgress = true;
    let body = '';
    let rejected = false;
    req.on('aborted', () => {
      if (!submitted) submissionInProgress = false;
    });
    req.on('data', (c) => {
      if (rejected) return;
      body += c;
      if (body.length > 1e6) {
        rejected = true;
        submissionInProgress = false;
        res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('payload too large');
        req.destroy();
      }
    });
    req.on('end', () => {
      if (rejected) return;
      let answers;
      try {
        answers = JSON.parse(body);
      } catch {
        submissionInProgress = false;
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('bad json');
        return;
      }
      try {
        writeFileSync(answersPath, JSON.stringify(answers, null, 2) + '\n');
      } catch {
        submissionInProgress = false;
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('failed to write answers');
        return;
      }
      submitted = true;
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
