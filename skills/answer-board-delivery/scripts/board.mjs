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
    --font-size-base: 16px;
    font-size: var(--font-size-base);
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
    --table-head-bg: #f1f3f6;
    --table-row-alt: #fafbfc;
    --table-scroll-thumb: #c4c9d0;
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
      --table-head-bg: #2e3033;
      --table-row-alt: #282a2c;
      --table-scroll-thumb: #4a4d51;
    }
  }
  * { box-sizing: border-box; }
  body { font-family: sans-serif;
         margin: 0; background: var(--bg); color: var(--text); line-height: 1.65; }
  ::selection { background: var(--accent-bg); color: var(--text); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
  h1 { font-size: 1.4375rem; margin: 0 0 8px; font-weight: 600; }
  .sub { color: var(--muted); font-size: 1rem; margin: 0; }
  .close-btn { margin-top: 24px; background: var(--accent); color: #fff; border: 0; border-radius: 10px;
               padding: 10px 32px; font-size: 0.9375rem; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px var(--shadow); }
  .close-btn:hover { background: var(--accent-hover); }
  .close-hint { margin: 10px 0 0; color: var(--muted); font-size: 0.8125rem; min-height: 18px; }
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

// round JSON 可给表格密集的轮次一个更宽的初始页面宽度；非有限数字一律回落到标准宽度。
// 客户端仍以用户在页面上的调节（localStorage）为准，超出窗口的部分由 CSS 的 max-width: 100% 夹住。
const DEFAULT_PAGE_WIDTH = 1440;
const requestedWidth = quiz.width;
const INITIAL_PAGE_WIDTH =
  typeof requestedWidth === 'number' && Number.isFinite(requestedWidth)
    ? Math.min(Math.max(Math.round(requestedWidth), 1000), 4000)
    : DEFAULT_PAGE_WIDTH;

function renderPage() {
  const facts = (quiz.facts || []).map((f) => `<li>${esc(f)}</li>`).join('');
  const defaults = (quiz.defaults || []).map((f) => `<li>${esc(f)}</li>`).join('');
  const questions = quiz.questions
    .map((q, questionIndex) => {
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
        control = `<div class="opts">${opts}</div>
        <button type="button" class="clear-choices">以上都不合适</button>`;
      }
      const note =
        type === 'text'
          ? ''
          : `<textarea class="note" rows="1" wrap="soft" name="${esc(noteName)}" aria-label="补充说明或完整回答" placeholder="补充说明；不选选项时请在此填写完整回答"></textarea>`;
      const prefill =
        type === 'text' && q.recommended
          ? '<div class="rec prefill">已预填推荐答案，可直接提交或修改</div>'
          : '';
      const nextTarget = questionIndex + 1 < quiz.questions.length ? quiz.questions[questionIndex + 1].id : 'global';
      const nextLabel = questionIndex + 1 < quiz.questions.length ? '滚动到下一题' : '填写总备注';
      return `
      <section class="q" id="${esc(q.id)}" data-step-panel tabindex="-1" aria-labelledby="question-${questionIndex}-title">
        <h3 id="question-${questionIndex}-title">${esc(q.id)} — ${esc(q.title)}${badges}</h3>
        <div class="q-body">${renderMarkdownBody(q.body)}</div>
        ${prefill}
        ${control}
        ${note}
        <a class="next-step" href="#${esc(encodeURIComponent(nextTarget))}">${nextLabel} <span aria-hidden="true">↓</span></a>
      </section>`;
    })
    .join('\n');
  const questionLinks = quiz.questions
    .map((q, index) => `<a href="#${esc(encodeURIComponent(q.id))}" data-step-link="${index}" ${index === 0 ? 'aria-current="step"' : ''}><span class="index-number">${index + 1}</span><span>${esc(q.id)} · ${esc(q.title)}</span></a>`)
    .join('') + `<a href="#global" data-step-link="${quiz.questions.length}"><span class="index-number">＋</span><span>总备注与提交</span></a>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(quiz.title)}</title>
<style>
  ${THEME_CSS}
  :root { --page-width: ${INITIAL_PAGE_WIDTH}px; --progress-height: 58px; }
  html { scroll-behavior: smooth; }
  @media (min-width: 1024px) { html { scroll-snap-type: y proximity; } }
  .wrap {
    display: grid; grid-template-columns: minmax(260px, .72fr) minmax(0, 1.55fr);
    align-items: start; gap: clamp(32px, 4vw, 64px);
    width: var(--page-width); max-width: 100%; margin: 0 auto;
    padding: 28px clamp(24px, 4vw, 56px) 0;
  }
  .toolbar { background: var(--bg); border-bottom: 1px solid var(--card-border); scroll-snap-align: start; }
  .toolbar-inner {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px 24px;
    width: 100%; max-width: 1120px; margin: 0 auto; padding: 8px 20px;
  }
  .toolbar-group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
  .toolbar label { font-size: 0.8125rem; font-weight: 600; color: var(--muted); white-space: nowrap; }
  .toolbar input[type="range"] {
    flex: 1 1 120px; min-width: 80px; max-width: 420px;
    accent-color: var(--accent); cursor: pointer;
  }
  .toolbar output {
    min-width: 68px; text-align: right; white-space: nowrap;
    font-size: 0.8125rem; color: var(--text); font-variant-numeric: tabular-nums;
  }
  .toolbar button {
    padding: 5px 12px; font-size: 0.8125rem; font-weight: 500; box-shadow: none; border-radius: 8px;
    background: var(--card-bg); color: var(--muted); border: 1px solid var(--input-border);
  }
  .toolbar button:hover { background: var(--card-bg); color: var(--accent-text); border-color: var(--accent); }
  .reference {
    position: sticky; top: 24px; max-height: calc(100vh - 48px); max-height: calc(100dvh - 48px);
    padding-right: 8px; overflow-y: auto; scrollbar-width: thin;
  }
  h1 { font-size: 1.5625rem; line-height: 1.35; margin: 0 0 8px; }
  .sub { color: var(--muted); font-size: 0.9375rem; margin: 0 0 20px; }
  .ref-block { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--card-border); }
  .ref-block h2 { margin: 0 0 8px; font-size: 0.875rem; }
  .ref-block ul { margin: 0; padding-left: 20px; }
  .ref-block li { margin: 7px 0; font-size: 0.875rem; color: var(--muted); }
  .question-index { display: flex; flex-direction: column; gap: 5px; margin-top: 24px; }
  .question-index a {
    display: flex; align-items: center; gap: 9px; padding: 6px 8px; border: 1px solid transparent;
    border-radius: 8px; color: var(--muted); text-decoration: none; font-size: 0.8125rem; line-height: 1.4;
  }
  .question-index a:hover { color: var(--accent-text); background: var(--accent-bg); }
  .question-index a[aria-current="step"] { color: var(--accent-text); border-color: var(--accent); background: var(--accent-bg); }
  .index-number {
    display: grid; place-items: center; flex: 0 0 24px; width: 24px; height: 24px;
    border: 1px solid var(--card-border); border-radius: 6px; font-size: 0.75rem; font-variant-numeric: tabular-nums;
  }
  .question-index a[aria-current="step"] .index-number { border-color: var(--accent); }
  .flow { min-width: 0; padding-left: clamp(24px, 3vw, 44px); border-left: 1px solid var(--card-border); }
  .flow-progress {
    position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 12px;
    min-height: var(--progress-height); padding: 10px 0; background: var(--bg);
    color: var(--muted); font-size: 0.75rem; font-variant-numeric: tabular-nums;
  }
  .progress-label { flex: none; min-width: 76px; }
  .progress-track { flex: 1; height: 4px; overflow: hidden; border-radius: 999px; background: var(--card-border); }
  .progress-track span { display: block; height: 100%; background: var(--accent); transition: width .2s ease; }
  .progress-count { flex: none; min-width: 36px; text-align: right; }
  .q {
    display: flex; flex-direction: column; justify-content: center; min-width: 0;
    min-height: calc(100vh - var(--progress-height)); min-height: calc(100dvh - var(--progress-height));
    padding: 32px 0; border-bottom: 1px solid var(--card-border);
    scroll-snap-align: start; scroll-snap-stop: always; scroll-margin-top: var(--progress-height);
  }
  .q:focus { outline: none; }
  .q h3 { margin: 0 0 10px; font-size: 1.25rem; line-height: 1.5; }
  .q-body { margin: 0 0 14px; font-size: 1rem; color: var(--text); white-space: normal; overflow-wrap: break-word; }
  .q-body img { max-width: 100%; height: auto; }
  .opts { display: flex; flex-direction: column; gap: 8px; }
  .opt { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--opt-border); border-radius: 8px;
         padding: 10px 12px; cursor: pointer; font-size: 1rem; background: var(--card-bg); }
  .opt:hover { border-color: var(--opt-hover); }
  .opt:has(input:checked) { border-color: var(--accent); background: var(--accent-bg); }
  .opt input { margin-top: 4px; }
  .rec { color: var(--accent-text); font-style: normal; font-size: 0.75rem; }
  .opt-tag { color: var(--muted); font-style: normal; font-size: 0.75rem; }
  .prefill { margin: 0 0 6px; }
  .desc { color: var(--muted); font-size: 0.8125rem; }
  .clear-choices {
    align-self: flex-start; margin-top: 8px; padding: 5px 10px; border: 1px solid var(--input-border); border-radius: 8px;
    background: var(--card-bg); color: var(--muted); box-shadow: none; font-size: 0.8125rem; font-weight: 500;
  }
  .clear-choices:hover { background: var(--card-bg); color: var(--accent-text); border-color: var(--accent); }
  .note { display: block; width: 100%; margin-top: 10px; padding: 8px 10px; border: 1px solid var(--input-border); border-radius: 8px; font-size: 1rem;
          font-family: inherit; line-height: 1.65; background: var(--card-bg); color: var(--text);
          min-height: 0; resize: none; overflow: hidden; white-space: pre-wrap; overflow-wrap: break-word; }
  textarea { width: 100%; min-height: 80px; padding: 10px; border: 1px solid var(--input-border); border-radius: 10px; font-size: 1rem; font-family: inherit;
             background: var(--card-bg); color: var(--text); }
  .next-step { align-self: flex-end; margin-top: 18px; color: var(--muted); font-size: 0.8125rem; text-decoration: none; }
  .next-step:hover { color: var(--accent-text); }
  .global-panel { border-bottom: 0; }
  .submitbar { margin-top: 24px; text-align: center; }
  button { background: var(--accent); color: #fff; border: 0; border-radius: 10px; padding: 12px 48px;
           font-size: 1rem; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px var(--shadow); }
  button:hover { background: var(--accent-hover); }
  button:disabled { opacity: .65; cursor: wait; }
  .hint { color: var(--muted); font-size: 0.8125rem; margin-top: 8px; }
  @media (max-width: 1023px) {
    html { scroll-snap-type: none; }
    .wrap { display: block; width: 100%; padding: 24px 20px 0; }
    .reference { position: static; max-height: none; padding: 0 0 24px; overflow: visible; border-bottom: 1px solid var(--card-border); }
    .question-index { display: none; }
    .flow { padding: 0; border-left: 0; }
    .q {
      min-height: calc(100vh - var(--progress-height)); min-height: calc(100svh - var(--progress-height));
      scroll-snap-align: none;
    }
  }
  @media (max-width: 640px) {
    .wrap { padding-top: 20px; }
    .q h3 { font-size: 1.125rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .progress-track span { transition: none; }
  }
  code {
    background: var(--code-bg); color: var(--code-text); padding: 2px 6px; border-radius: 4px;
    font-family: monospace; font-size: 0.8125rem;
    border: 1px solid var(--code-border);
  }
  pre {
    background: var(--code-bg); color: var(--code-text); padding: 12px 16px; border-radius: 8px;
    overflow-x: auto; margin: 12px 0; border: 1px solid var(--code-border);
  }
  pre code {
    background: transparent; padding: 0; border: 0; font-size: 0.8125rem; line-height: 1.5;
  }
  .q-body p { margin: 6px 0; }
  .q-body h1, .q-body h2, .q-body h3, .q-body h4 { margin: 12px 0 6px; }
  .q-body h1 { font-size: 1.5rem; }
  .q-body h2 { font-size: 1.25rem; }
  .q-body h3 { font-size: 1.125rem; }
  .q-body h4 { font-size: 1rem; }
  .q-body ul, .q-body ol { margin: 6px 0; padding-left: 22px; }
  .q-body li { margin: 2px 0; }
  .q-body blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid var(--card-border); color: var(--muted); }
  .q-body .table-scroll {
    max-width: 100%; margin: 12px 0; overflow-x: auto; overscroll-behavior-x: contain;
    border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-bg);
  }
  .q-body .table-scroll:focus-visible { outline-offset: -2px; }
  .q-body .table-scroll table {
    width: 100%; margin: 0; border-collapse: collapse;
    font-size: 0.875rem; line-height: 1.55; font-variant-numeric: tabular-nums;
  }
  .q-body th, .q-body td {
    padding: 8px 12px; vertical-align: top; text-align: left;
    border-right: 1px solid var(--card-border); border-bottom: 1px solid var(--card-border);
  }
  .q-body th { white-space: nowrap; background: var(--table-head-bg); font-weight: 600; }
  .q-body td { white-space: normal; overflow-wrap: anywhere; }
  .q-body th:last-child, .q-body td:last-child { border-right: 0; }
  .q-body tbody tr:last-child th, .q-body tbody tr:last-child td { border-bottom: 0; }
  .q-body tbody tr:nth-child(even) { background: var(--table-row-alt); }
  pre, .q-body .table-scroll { scrollbar-width: thin; scrollbar-color: var(--table-scroll-thumb) transparent; }
  pre::-webkit-scrollbar, .q-body .table-scroll::-webkit-scrollbar { height: 10px; }
  pre::-webkit-scrollbar-track, .q-body .table-scroll::-webkit-scrollbar-track { background: transparent; }
  pre::-webkit-scrollbar-thumb {
    background: var(--table-scroll-thumb); border-radius: 999px; border: 2px solid var(--code-bg);
  }
  .q-body .table-scroll::-webkit-scrollbar-thumb {
    background: var(--table-scroll-thumb); border-radius: 999px; border: 2px solid var(--card-bg);
  }
  .q-body a { color: var(--accent-text); }
  .q-body hr { border: 0; border-top: 1px solid var(--card-border); margin: 10px 0; }
</style>
<noscript><style>.note { height: 5em; overflow-y: auto; }</style></noscript>
</head>
<body>
<div class="toolbar">
  <div class="toolbar-inner">
    <div class="toolbar-group">
      <label for="widthRange">页面宽度</label>
      <input type="range" id="widthRange" min="1000" max="1800" step="1"
             value="${INITIAL_PAGE_WIDTH}" title="拖动调整页面宽度">
      <output id="widthValue" for="widthRange">${INITIAL_PAGE_WIDTH} px</output>
      <button type="button" id="widthDefault">标准</button>
      <button type="button" id="widthFull">全宽</button>
    </div>
    <div class="toolbar-group">
      <label for="fontSizeRange">基础字号</label>
      <input type="range" id="fontSizeRange" min="14" max="28" step="1"
             value="16" title="拖动调整全页基础字号">
      <output id="fontSizeValue" for="fontSizeRange">16 px</output>
      <button type="button" id="fontSizeDefault">标准</button>
    </div>
  </div>
</div>
<div class="wrap">
  <aside class="reference">
    <h1>${esc(quiz.title)}</h1>
    <div class="sub">${esc(quiz.subtitle || '')} 推荐项已预选；滚动切换问题，最后填写总备注并提交。</div>
    ${facts ? `<section class="ref-block"><h2>背景事实</h2><ul>${facts}</ul></section>` : ''}
    ${defaults ? `<section class="ref-block"><h2>已按项目惯例默认</h2><ul>${defaults}</ul></section>` : ''}
    <nav class="question-index" aria-label="问题索引">${questionLinks}</nav>
  </aside>
  <main class="flow">
    <div class="flow-progress">
      <span class="progress-label" id="progressLabel">问题 1 / ${quiz.questions.length}</span>
      <div class="progress-track" id="progressTrack" role="progressbar" aria-label="当前问题位置" aria-valuemin="1" aria-valuemax="${quiz.questions.length + 1}" aria-valuenow="1"><span id="progressFill" style="width: ${100 / (quiz.questions.length + 1)}%"></span></div>
      <span class="progress-count" id="progressCount">1 / ${quiz.questions.length + 1}</span>
    </div>
    <form id="quiz">
      ${questions}
      <section class="q global-panel" id="global" data-step-panel tabindex="-1" aria-labelledby="global-title">
        <h3 id="global-title">总备注</h3>
        <div class="q-body">任何想说的：推翻某条默认、补充约束、骂推荐答案……都写这里。</div>
        <textarea name="${GLOBAL_FIELD}" placeholder="（可选）"></textarea>
        <div class="submitbar">
          <button type="submit">提交回答</button>
          <div class="hint">提交后本轮结束，可以关闭页面。</div>
        </div>
      </section>
    </form>
  </main>
</div>
<script src="https://cdn.jsdelivr.net/npm/markdown-it@15.0.3/dist/browser/markdown-it.umd.min.js"
        integrity="sha384-ARStLecQmtLYjBgfD3+w+irhiSoLTnFk/ne6c0gRWQKQtC9791ZLMQ9D3OaBISt3"
        crossorigin="anonymous"></script>
<script>
// 宽度与基础字号偏好存 localStorage。ask.mjs 从固定默认端口递增选择，
// 因此同一 origin 下会跨轮、跨项目保留；不同主机或端口仍各自隔离。
const DEFAULT_PAGE_WIDTH = ${DEFAULT_PAGE_WIDTH};
const INITIAL_PAGE_WIDTH = ${INITIAL_PAGE_WIDTH};
const WIDTH_KEY = 'answer-board:pageWidth';
const DEFAULT_FONT_SIZE = 16;
const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 28;
const FONT_SIZE_KEY = 'answer-board:fontSize';
const widthRange = document.getElementById('widthRange');
const widthValue = document.getElementById('widthValue');
const fontSizeRange = document.getElementById('fontSizeRange');
const fontSizeValue = document.getElementById('fontSizeValue');
const wrapEl = document.querySelector('.wrap');
const stepPanels = [...document.querySelectorAll('[data-step-panel]')];
const stepLinks = [...document.querySelectorAll('[data-step-link]')];
const progressLabel = document.getElementById('progressLabel');
const progressTrack = document.getElementById('progressTrack');
const progressFill = document.getElementById('progressFill');
const progressCount = document.getElementById('progressCount');
let overflowSyncQueued = false;
let stepSyncQueued = false;
let currentStep = -1;

function maxPageWidth() {
  return Math.max(1800, Math.round(window.innerWidth));
}
function setPageWidth(px, save) {
  const max = maxPageWidth();
  widthRange.max = String(max);
  const w = Math.min(Math.max(Math.round(px) || DEFAULT_PAGE_WIDTH, 1000), max);
  widthRange.value = String(w);
  document.documentElement.style.setProperty('--page-width', w + 'px');
  widthValue.textContent = Math.round(wrapEl.getBoundingClientRect().width) + ' px';
  if (save) {
    try { localStorage.setItem(WIDTH_KEY, String(w)); } catch {}
  }
  scheduleOverflowSync();
  scheduleStepSync();
  // 列宽变了会改变换行数，补充说明框的高度必须跟着重算
  autoGrowNotes();
}
function setFontSize(px, save) {
  const size = Math.min(Math.max(Math.round(px) || DEFAULT_FONT_SIZE, MIN_FONT_SIZE), MAX_FONT_SIZE);
  fontSizeRange.value = String(size);
  document.documentElement.style.setProperty('--font-size-base', size + 'px');
  fontSizeValue.textContent = size + ' px';
  if (save) {
    try { localStorage.setItem(FONT_SIZE_KEY, String(size)); } catch {}
  }
  // 字号变化也会影响表格溢出和说明框的换行高度。
  scheduleOverflowSync();
  scheduleStepSync();
  autoGrowNotes();
}
function scheduleOverflowSync() {
  if (overflowSyncQueued) return;
  overflowSyncQueued = true;
  requestAnimationFrame(() => { overflowSyncQueued = false; syncTableScroll(); });
}
function scheduleStepSync() {
  if (stepSyncQueued) return;
  stepSyncQueued = true;
  requestAnimationFrame(() => { stepSyncQueued = false; syncStepProgress(); });
}
// 进度表示当前位置而非已答数量；滚动到下一屏上半部时切换当前步骤。
function syncStepProgress() {
  const threshold = Math.max(80, window.innerHeight * .45);
  let nextStep = 0;
  stepPanels.forEach((panel, index) => {
    if (panel.getBoundingClientRect().top <= threshold) nextStep = index;
  });
  if (nextStep === currentStep) return;
  currentStep = nextStep;
  const questionCount = stepPanels.length - 1;
  const isGlobal = nextStep === questionCount;
  const label = isGlobal ? '总备注' : '问题 ' + (nextStep + 1) + ' / ' + questionCount;
  progressLabel.textContent = label;
  progressCount.textContent = (nextStep + 1) + ' / ' + stepPanels.length;
  progressFill.style.width = ((nextStep + 1) / stepPanels.length * 100) + '%';
  progressTrack.setAttribute('aria-valuenow', String(nextStep + 1));
  progressTrack.setAttribute('aria-valuetext', label);
  stepLinks.forEach((link, index) => {
    if (index === nextStep) link.setAttribute('aria-current', 'step');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('scroll', scheduleStepSync, { passive: true });
// 只有真的溢出的表格才变成可聚焦滚动区域，键盘用户也能用方向键横向滚动。
function syncTableScroll() {
  document.querySelectorAll('.table-scroll').forEach((box) => {
    if (box.scrollWidth > box.clientWidth + 1) {
      if (!box.hasAttribute('tabindex')) {
        box.setAttribute('tabindex', '0');
        box.setAttribute('role', 'region');
        box.setAttribute('aria-label', '表格，可横向滚动');
      }
    } else {
      box.removeAttribute('tabindex');
      box.removeAttribute('role');
      box.removeAttribute('aria-label');
    }
  });
}
function wrapTables(root) {
  root.querySelectorAll('table').forEach((table) => {
    if (table.parentElement && table.parentElement.classList.contains('table-scroll')) return;
    const scroller = document.createElement('div');
    scroller.className = 'table-scroll';
    table.parentNode.insertBefore(scroller, table);
    scroller.appendChild(table);
  });
}
// 补充说明：默认一行，输入时自动换行并随内容增高/缩回。
// box-sizing 是 border-box，scrollHeight 只含 padding，故补回上下边框宽度，避免末尾裁掉 2px。
function autoGrowNote(el) {
  el.style.height = 'auto';
  const cs = getComputedStyle(el);
  const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  el.style.height = (el.scrollHeight + border) + 'px';
}
function autoGrowNotes() {
  document.querySelectorAll('.note').forEach(autoGrowNote);
}
document.querySelectorAll('.note').forEach((el) => {
  el.addEventListener('input', () => autoGrowNote(el));
});
document.querySelectorAll('.clear-choices').forEach((button) => {
  button.addEventListener('click', () => {
    const question = button.closest('.q');
    question.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input) => {
      input.checked = false;
    });
    const note = question.querySelector('.note');
    if (note) note.focus();
  });
});

fontSizeRange.addEventListener('input', () => setFontSize(Number(fontSizeRange.value), true));
document.getElementById('fontSizeDefault').addEventListener('click', () => {
  try { localStorage.removeItem(FONT_SIZE_KEY); } catch {}
  setFontSize(DEFAULT_FONT_SIZE, false);
});
widthRange.addEventListener('input', () => setPageWidth(Number(widthRange.value), true));
document.getElementById('widthDefault').addEventListener('click', () => {
  try { localStorage.removeItem(WIDTH_KEY); } catch {}
  setPageWidth(DEFAULT_PAGE_WIDTH, false);
});
document.getElementById('widthFull').addEventListener('click', () => setPageWidth(window.innerWidth, true));
window.addEventListener('resize', () => setPageWidth(Number(widthRange.value), false));
{
  let stored = null;
  try { stored = Number(localStorage.getItem(WIDTH_KEY)); } catch {}
  setPageWidth(Number.isFinite(stored) && stored > 0 ? stored : INITIAL_PAGE_WIDTH, false);
}
{
  let stored = null;
  try { stored = Number(localStorage.getItem(FONT_SIZE_KEY)); } catch {}
  setFontSize(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_FONT_SIZE, false);
}

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
    if (el) { el.innerHTML = md.render(raw); wrapTables(el); }
  }
  scheduleOverflowSync();
  scheduleStepSync();
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
      const note = fd.get(noteField(id)) || '';
      if (!choices.length && !note.trim() && !meta.optional) { missing.push(id); return; }
      payload.answers[id] = { choices, note };
    } else {
      const choice = fd.get(answerField(id)) || '';
      const note = fd.get(noteField(id)) || '';
      if (!choice && !note.trim() && !meta.optional) { missing.push(id); return; }
      payload.answers[id] = { choice, note };
    }
  });
  if (missing.length) {
    alert('还有未作答的问题：' + missing.join(', '));
    const firstMissing = document.getElementById(missing[0]);
    if (firstMissing) {
      firstMissing.scrollIntoView({ block: 'start' });
      firstMissing.focus({ preventScroll: true });
    }
    return;
  }
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
