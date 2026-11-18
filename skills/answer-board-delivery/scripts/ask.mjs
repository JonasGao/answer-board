#!/usr/bin/env node
// Answer Board 启动包装脚本（纯 Node 实现，无 bash 依赖）
// 用 --help 查看单轮和持续投递命令。
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BOARD_MJS = path.join(SCRIPT_DIR, 'board.mjs');

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

function fail(message, code) {
  console.error(message);
  process.exit(code);
}

// Parse args
let questions = '';
let answers = '';
let session = '';
let waitRound = '';
let continuous = false;
let finish = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (['--questions', '--answers', '--session', '--wait'].includes(arg)) {
    const value = args[++i];
    if (!value || value.startsWith('--')) fail(`Error: ${arg} requires a value`, 2);
    if (arg === '--questions') questions = value;
    else if (arg === '--answers') answers = value;
    else if (arg === '--session') session = value;
    else waitRound = value;
  } else if (arg === '--continuous') {
    continuous = true;
  } else if (arg === '--finish') {
    finish = true;
  } else if (arg === '-h' || arg === '--help') {
    console.log(`Usage: node ask.mjs --questions <path> [--answers <path> | --continuous]
       node ask.mjs --session <directory> --wait <round>
       node ask.mjs --session <directory> --questions <next-round.json>
       node ask.mjs --session <directory> --finish`);
    process.exit(0);
  } else {
    fail(`Unknown argument: ${arg}`, 2);
  }
}

function printAnswers(file) {
  const contents = readFileSync(file, 'utf8');
  console.log('---ANSWERS_FILE---');
  console.log(file);
  console.log('---ANSWERS---');
  process.stdout.write(contents);
}

async function manageSession() {
  const round = Number(waitRound);
  if (waitRound && (!Number.isSafeInteger(round) || round < 1)) {
    fail('Error: --wait requires a positive round number', 2);
  }
  const file = path.resolve(session, `round-${round}.answers.json`);
  if (waitRound && isFile(file)) {
    printAnswers(file);
    return;
  }

  const { port, token } = JSON.parse(readFileSync(path.join(session, 'control.json'), 'utf8'));
  const control = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/_control${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  };

  if (waitRound) {
    while (!isFile(file)) {
      const status = await control('');
      if (status.round !== round || status.state !== 'answering') {
        if (isFile(file)) break;
        throw new Error(`Round ${round} has no saved answers (board: round ${status.round}, ${status.state})`);
      }
      await delay(500);
    }
    printAnswers(file);
  } else if (finish) {
    await control('/finish', '{}');
    console.log('SESSION_FINISHED');
  } else {
    const status = await control('/next', readFileSync(questions, 'utf8'));
    console.log(`ROUND_READY round=${status.round}`);
  }
}

if (session) {
  if (continuous || answers || [questions, waitRound, finish].filter(Boolean).length !== 1) {
    fail('Error: --session requires exactly one of --wait, --questions or --finish', 2);
  }
  try {
    await manageSession();
  } catch (err) {
    fail(`Error: ${err.message}`, 1);
  }
  process.exit(0);
}
if (waitRound || finish) fail('Error: --wait and --finish require --session', 2);
if (!questions) fail('Error: --questions is required', 2);
if (!isFile(questions)) fail(`Error: questions file not found: ${questions}`, 2);
if (continuous && answers) fail('Error: --continuous stores answers per round and does not take --answers', 2);
if (!answers) {
  answers = questions.endsWith('.json')
    ? questions.slice(0, -'.json'.length) + '.answers.json'
    : questions + '.answers.json';
}

// 从固定默认端口开始递增，保持各轮 origin 稳定，让页面显示偏好可以跨轮保留。
const DEFAULT_PORT = 19876;
function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(false);
      else reject(err);
    });
    probe.listen(port, '0.0.0.0', () => {
      probe.close(() => resolve(true));
    });
  });
}

let freePort;
try {
  for (let candidate = DEFAULT_PORT; candidate <= 65535; candidate++) {
    if (await isPortAvailable(candidate)) {
      freePort = candidate;
      break;
    }
  }
} catch {
  fail('Error: failed to find a free port', 1);
}
if (!freePort) fail(`Error: no free port available from ${DEFAULT_PORT}`, 1);
console.error(`Using port: ${freePort}`);

if (continuous) {
  try {
    session = mkdtempSync(path.join(os.tmpdir(), 'answer-board-'));
    writeFileSync(path.join(session, 'control.json'), JSON.stringify({ port: freePort, token: randomUUID() }), { mode: 0o600 });
  } catch (err) {
    fail(`Error: could not create session: ${err.message}`, 1);
  }
}

// Run the board server (foreground, inheriting stdio)
const child = spawn(process.execPath, [BOARD_MJS, questions, answers, String(freePort), ...(session ? [session] : [])], {
  stdio: 'inherit',
});
child.on('error', (err) => fail(`Error: failed to start board.mjs: ${err.message}`, 1));

// 包装进程被杀时转发信号给 board，避免遗留孤儿服务
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill(sig);
    process.exit(0);
  });
}

child.on('close', (code) => {
  if (code !== 0) fail(`Error: board server exited with code ${code ?? 1}`, code ?? 1);
  if (continuous) return;
  if (!isFile(answers)) fail(`Error: answers file not found: ${answers}`, 1);
  printAnswers(answers);
});
