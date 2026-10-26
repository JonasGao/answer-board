#!/usr/bin/env node
// Answer Board 启动包装脚本（纯 Node 实现，无 bash 依赖）
// 用法: node ask.mjs --questions <path> [--answers <path>]
// - 自动挑选空闲端口
// - 启动 board.mjs（前台，继承 stdio）
// - 等待用户提交（服务自动退出）
// - 打印答案文件路径和内容
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
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
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--questions' || arg === '--answers') {
    const value = args[++i];
    if (value === undefined) fail(`Error: ${arg} requires a value`, 2);
    if (arg === '--questions') questions = value;
    else answers = value;
  } else if (arg === '-h' || arg === '--help') {
    console.log(`Usage: ${process.argv[1]} --questions <path> [--answers <path>]`);
    console.log('');
    console.log('启动 answer-board 一次性问答服务。自动挑选空闲端口，启动 board.mjs，');
    console.log('等待用户提交后打印答案。');
    process.exit(0);
  } else {
    fail(`Unknown argument: ${arg}`, 2);
  }
}

if (!questions) fail('Error: --questions is required', 2);
if (!isFile(questions)) fail(`Error: questions file not found: ${questions}`, 2);
if (!answers) {
  answers = questions.endsWith('.json')
    ? questions.slice(0, -'.json'.length) + '.answers.json'
    : questions + '.answers.json';
}

// Find a free port using Node's net module（先探测再启动，与 bash 版行为一致）
let freePort;
try {
  freePort = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '0.0.0.0', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
} catch {
  fail('Error: failed to find a free port', 1);
}
console.error(`Using port: ${freePort}`);

// Run the board server (foreground, inheriting stdio)
const child = spawn(process.execPath, [BOARD_MJS, questions, answers, String(freePort)], {
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
  if (!isFile(answers)) fail(`Error: answers file not found: ${answers}`, 1);
  console.log('---ANSWERS_FILE---');
  console.log(answers);
  console.log('---ANSWERS---');
  process.stdout.write(readFileSync(answers, 'utf8'));
});
