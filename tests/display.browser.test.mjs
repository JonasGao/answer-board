// Run with ANSWER_BOARD_BROWSER_TESTS=1 node --test tests/display.browser.test.mjs.
// Requires agent-browser and its Chromium installation.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const execute = promisify(execFile);

test('display controls survive reload without painting the round width first', {
  skip: !process.env.ANSWER_BOARD_BROWSER_TESTS, timeout: 60000,
}, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'answer-board-browser-'));
  const session = `answer-board-display-${process.pid}`;
  const browser = async (...args) => {
    const { stdout } = await execute('agent-browser', ['--session', session, '--json', ...args]);
    const result = JSON.parse(stdout);
    assert.ok(result.success, result.error);
    return result.data;
  };
  const evaluate = async (code) => (await browser('eval', code)).result;
  const questions = path.join(directory, 'round.json');
  await writeFile(questions, JSON.stringify({
    round: 1, title: 'Display regression', width: 1200,
    questions: [{ id: 'Q1', type: 'text', title: 'Answer', body: 'A question.' }],
  }));
  const board = spawn(process.execPath, [
    'skills/answer-board-delivery/scripts/ask.mjs', '--questions', questions,
  ], { env: { ...process.env, XDG_CONFIG_HOME: path.join(directory, 'config') }, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(board, 'close');
  let output = '';
  board.stdout.on('data', (chunk) => { output += chunk; });
  board.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    await browser('close').catch(() => {});
    if (board.exitCode === null) board.kill('SIGTERM');
    await closed;
    await rm(directory, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5000;
  while (!output.includes('LISTENING')) {
    assert.ok(Date.now() < deadline, output || 'Board did not start');
    await delay(20);
  }
  const url = output.match(/LISTENING (http:\/\/127\.0\.0\.1:\d+)/)[1];
  const init = path.join(directory, 'observe.js');
  await writeFile(init, `
    const nativeFetch = window.fetch.bind(window);
    const gate = new Promise((resolve) => { window.releasePreferences = resolve; });
    window.preferenceWrites = 0;
    window.completedPreferenceWrites = 0;
    window.fetch = async (...args) => {
      const preferences = String(args[0]).startsWith('/preferences?');
      const write = preferences && args[1]?.method === 'PATCH';
      if (write) window.preferenceWrites++;
      try {
        const response = await nativeFetch(...args);
        if (preferences && !write) {
          await gate;
          window.preferenceReadReleased = true;
        }
        return response;
      } finally {
        if (write) { window.preferenceWrites--; window.completedPreferenceWrites++; }
      }
    };
    window.visibleWidths = [];
    window.visibleFontSizes = [];
    function observe() {
      const wrap = document.querySelector('.wrap');
      if (wrap && getComputedStyle(wrap).visibility === 'visible') {
        window.visibleWidths.push(getComputedStyle(document.documentElement).getPropertyValue('--page-width').trim());
        window.visibleFontSizes.push(getComputedStyle(document.documentElement).fontSize);
      }
      requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
  `);
  await browser('--args', '--no-sandbox', '--init-script', init, 'open', 'about:blank');
  await browser('set', 'viewport', '1920', '1080');
  await browser('network', 'route', '**/cdn.jsdelivr.net/**', '--abort');
  const release = async () => {
    await evaluate('window.releasePreferences()');
    await browser('wait', '--fn', 'window.preferenceReadReleased === true');
    // Let the real response.json() and subsequent layout finish.
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  };
  const waitForWrite = () => browser('wait', '--fn',
    'window.completedPreferenceWrites > 0 && window.preferenceWrites === 0');
  const width = () => evaluate('Number(document.getElementById("widthRange").value)');

  await t.test('standard overrides a custom round width on reload', async () => {
    await browser('open', url);
    await release();
    assert.equal(await width(), 1200, 'an unset preference uses the round width');
    await browser('click', '#widthDefault');
    const selected = await width();
    await waitForWrite();
    await browser('reload');
    await release();
    assert.equal(await width(), selected);
  });
  await t.test('full width survives reload', async () => {
    await browser('click', '#widthFull');
    const selected = await width();
    await waitForWrite();
    await browser('reload');
    await release();
    assert.equal(await width(), selected);
  });
  await t.test('full width survives an immediate reload', async () => {
    await browser('click', '#widthDefault');
    await waitForWrite();
    await browser('click', '#widthFull');
    const selected = await evaluate('innerWidth');
    await browser('reload');
    await release();
    assert.equal(await width(), selected);
  });
  await t.test('saved width is used for every visible frame', async () => {
    await evaluate(`{
      const range = document.getElementById('widthRange');
      range.value = '1450';
      range.dispatchEvent(new Event('input', { bubbles: true }));
      range.dispatchEvent(new Event('change', { bubbles: true }));
      const font = document.getElementById('fontSizeRange');
      font.value = '22';
      font.dispatchEvent(new Event('input', { bubbles: true }));
      font.dispatchEvent(new Event('change', { bubbles: true }));
    }`);
    await waitForWrite();
    await browser('reload');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const before = await evaluate('window.visibleWidths');
    await release();
    assert.equal(await width(), 1450);
    const after = await evaluate('window.visibleWidths');
    assert.deepEqual([...new Set([...before, ...after])], ['1450px']);
    assert.deepEqual(await evaluate('[...new Set(window.visibleFontSizes)]'), ['22px']);
  });
  await t.test('a failed preference read leaves the form visible and usable', async () => {
    await browser('network', 'route', '**/preferences?*', '--abort');
    await browser('reload');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".wrap")).visibility'), 'visible');
    assert.equal(await width(), 1200);
    assert.equal(await evaluate('document.getElementById("preferenceStatus").hidden'), false);
    await browser('network', 'unroute', '**/preferences?*');
  });
});
