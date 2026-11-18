import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ask = fileURLToPath(new URL('../skills/answer-board-delivery/scripts/ask.mjs', import.meta.url));
const round = (number) => ({
  round: number,
  title: `Round ${number}`,
  questions: [{ id: 'Q1', type: 'choice', title: 'Choose', options: [{ key: 'A', text: 'A' }] }],
});
const answer = (number) => ({ round: number, answers: { Q1: { choice: 'A', note: '' } }, global: '' });

function run(args, env = process.env) {
  const child = spawn(process.execPath, [ask, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const done = once(child, 'close').then(([code]) => ({ code, output }));
  return { child, done, output: () => output };
}

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for process output');
    await delay(20);
  }
}

async function start(t, continuous, configHome) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'answer-board-test-'));
  const questions = path.join(directory, 'round.json');
  await writeFile(questions, JSON.stringify(round(1)));
  const board = run(
    ['--questions', questions, ...(continuous ? ['--continuous'] : [])],
    { ...process.env, XDG_CONFIG_HOME: configHome ?? path.join(directory, 'config') },
  );
  const stop = async () => {
    if (board.child.exitCode === null) board.child.kill('SIGTERM');
    await board.done;
  };
  t.after(async () => {
    await stop();
    const session = board.output().match(/SESSION_DIR (.+)/)?.[1];
    if (session) await rm(session, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  });
  await until(() => /LISTENING http:\/\/127\.0\.0\.1:\d+/.test(board.output()));
  const url = board.output().match(/LISTENING (http:\/\/127\.0\.0\.1:\d+)/)[1];
  return { ...board, url, directory, stop };
}

test('single round saves answers, prints them, and exits', { timeout: 10000 }, async (t) => {
  const board = await start(t, false);
  const response = await fetch(board.url + '/submit', { method: 'POST', body: JSON.stringify(answer(1)) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /window.close\(\)/);
  const result = await board.done;
  assert.equal(result.code, 0);
  assert.match(result.output, /---ANSWERS_FILE---/);
  assert.deepEqual(JSON.parse(await readFile(path.join(board.directory, 'round.answers.json'), 'utf8')), answer(1));
});

test('one service accepts successive rounds and preserves their answers', { timeout: 15000 }, async (t) => {
  const board = await start(t, true);
  await until(() => /SESSION_DIR /.test(board.output()));
  const session = board.output().match(/SESSION_DIR (.+)/)[1];
  const { token } = JSON.parse(await readFile(path.join(session, 'control.json'), 'utf8'));
  const status = () => fetch(board.url + '/status').then((r) => r.json());
  const identity = (await status()).session;
  const post = (route, data, headers = {}) => fetch(board.url + route, {
    method: 'POST', headers, body: typeof data === 'string' ? data : JSON.stringify(data),
  });
  const controlHeaders = { Authorization: `Bearer ${token}` };
  const submit = (value) => post('/submit', value, { 'X-Answer-Board-Session': identity });
  assert.equal((await fetch(board.url + '/_control')).status, 403);
  assert.equal((await post('/_control/next', round(2), controlHeaders)).status, 409);
  assert.equal((await post('/submit', answer(1))).status, 409);
  assert.equal((await submit('bad json')).status, 400);
  assert.equal((await submit(null)).status, 400);
  assert.equal((await submit('x'.repeat(1000001))).status, 413);

  const wait = run(['--session', session, '--wait', '1']);
  t.after(() => { if (wait.child.exitCode === null) wait.child.kill(); });
  assert.equal((await submit(answer(1))).status, 200);
  assert.equal((await wait.done).code, 0);
  assert.match(wait.output(), /---ANSWERS---/);
  assert.deepEqual(JSON.parse(await readFile(path.join(session, 'round-1.answers.json'), 'utf8')), answer(1));
  assert.equal(board.child.exitCode, null);
  assert.equal((await status()).state, 'waiting');
  const waiting = await fetch(board.url).then((r) => r.text());
  assert.match(waiting, /答案已保存/);
  assert.doesNotMatch(waiting, /window.close\(\)/);
  assert.equal((await submit(answer(1))).status, 409);
  assert.equal((await post('/_control/next', { ...round(2), questions: [] }, controlHeaders)).status, 400);
  assert.equal((await status()).state, 'waiting');

  const nextQuestions = path.join(board.directory, 'next.json');
  await writeFile(nextQuestions, JSON.stringify({ ...round(2), width: 2300 }));
  assert.equal((await run(['--session', session, '--questions', nextQuestions]).done).code, 0);
  assert.equal((await status()).session, identity);
  assert.equal((await status()).round, 2);
  const page = await fetch(board.url).then((r) => r.text());
  assert.match(page, /Round 2/);
  assert.match(page, /--page-width: 2300px/);
  assert.equal((await submit(answer(1))).status, 409);
  assert.equal((await submit(answer(2))).status, 200);
  assert.equal((await run(['--session', session, '--wait', '2']).done).code, 0);

  assert.equal((await run(['--session', session, '--finish']).done).code, 0);
  assert.equal((await status()).state, 'finished');
  assert.match(await fetch(board.url).then((r) => r.text()), /问答已结束/);
  assert.equal((await submit(answer(2))).status, 409);
  assert.equal((await board.done).code, 0);
  // Answers remain recoverable even after the service has stopped.
  assert.equal((await run(['--session', session, '--wait', '1']).done).code, 0);
  assert.deepEqual(JSON.parse(await readFile(path.join(session, 'round-2.answers.json'), 'utf8')), answer(2));
});

async function preferencesFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'answer-board-preferences-test-'));
  const config = path.join(directory, 'config');
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory, config,
    async start(configHome = config) {
      const { url, stop } = await start(t, false, configHome);
      return {
        url, stop,
        get(screen = '1920x1080') {
          return fetch(url + '/preferences?screen=' + screen);
        },
        set(field, value, screen = '1920x1080', headers = {}) {
          return fetch(url + '/preferences?screen=' + screen, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ field, value }),
          });
        },
      };
    },
  };
}

test('separate processes share preferences per screen and preserve independent concurrent edits', { timeout: 10000 }, async (t) => {
  const state = await preferencesFixture(t);
  const [first, second] = await Promise.all([state.start(), state.start()]);
  assert.notEqual(first.url, second.url);
  assert.deepEqual(await (await first.get()).json(), {});
  assert.equal((await first.set('width', 1680)).status, 200);
  assert.deepEqual(await (await second.get()).json(), { width: 1680 });
  const writes = await Promise.all([
    first.set('width', 1750),
    second.set('fontSize', 22),
    first.set('width', 2400, '2560x1440'),
    second.set('fontSize', 18, '2560x1440'),
  ]);
  assert.ok(writes.every((response) => response.status === 200));
  assert.deepEqual(await (await second.get()).json(), { width: 1750, fontSize: 22 });
  assert.deepEqual(await (await first.get('2560x1440')).json(), { width: 2400, fontSize: 18 });
  assert.equal(JSON.parse(await readFile(path.join(state.config, 'answer-board/display/1920x1080/width.json'), 'utf8')), 1750);
  await first.stop();
  await second.stop();
  const restarted = await state.start();
  assert.deepEqual(await (await restarted.get()).json(), { width: 1750, fontSize: 22 });
});

test('legacy imports respect edits and resets; invalid preferences never replace saved settings', { timeout: 10000 }, async (t) => {
  const state = await preferencesFixture(t);
  const board = await state.start();
  assert.equal((await board.set('fontSize', 20, '1920x1080', { 'If-None-Match': '*' })).status, 200);
  const conflict = await board.set('fontSize', 25, '1920x1080', { 'If-None-Match': '*' });
  assert.equal(conflict.status, 412);
  assert.deepEqual(await conflict.json(), { value: 20 });
  assert.equal((await board.set('fontSize', null)).status, 200);
  assert.equal((await board.set('fontSize', 25, '1920x1080', { 'If-None-Match': '*' })).status, 412);
  assert.deepEqual(await (await board.get()).json(), { fontSize: null });
  for (const [field, value] of [['fontSize', 40], ['fontSize', '20'], ['width', 100], ['width', 1600.5], ['unknown', 20]]) {
    assert.equal((await board.set(field, value)).status, 400);
  }
  assert.equal((await board.get('../bad')).status, 400);
  assert.equal((await board.get('0x1080')).status, 400);
  assert.equal((await board.get('99999x1080')).status, 400);
  assert.deepEqual(await (await board.get()).json(), { fontSize: null });
});

test('unwritable configuration reports failure while the questionnaire stays available', { timeout: 10000 }, async (t) => {
  const state = await preferencesFixture(t);
  const blockedConfig = path.join(state.directory, 'file-in-place-of-directory');
  await writeFile(blockedConfig, '');
  const board = await state.start(blockedConfig);
  assert.equal((await board.set('fontSize', 20)).status, 500);
  assert.equal((await board.get()).status, 500);
  assert.equal((await fetch(board.url)).status, 200);
});
