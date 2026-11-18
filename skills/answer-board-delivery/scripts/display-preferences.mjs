import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const configHome = process.env.XDG_CONFIG_HOME;
const directory = path.join(
  configHome && path.isAbsolute(configHome) ? configHome : path.join(os.homedir(), '.config'),
  'answer-board', 'display',
);
const ranges = new Map([['width', [1000, 32768]], ['fontSize', [14, 28]]]);

export function isScreenResolution(screen) {
  return typeof screen === 'string' && /^[1-9]\d{0,4}x[1-9]\d{0,4}$/.test(screen) &&
    screen.split('x').every((dimension) => Number(dimension) <= 32768);
}

export function isDisplayPreference(field, value) {
  const range = ranges.get(field);
  return Boolean(range) && (value === null ||
    (Number.isInteger(value) && value >= range[0] && value <= range[1]));
}

function readValue(file, field) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (isDisplayPreference(field, value)) return value;
  } catch (err) {
    if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
  }
}

export function getDisplayPreferences(screen) {
  const preferences = {};
  for (const field of ranges.keys()) {
    preferences[field] = readValue(path.join(directory, screen, field + '.json'), field);
  }
  return preferences;
}

export function saveDisplayPreference(screen, field, value, onlyIfMissing) {
  const folder = path.join(directory, screen);
  const file = path.join(folder, field + '.json');
  const temporary = path.join(folder, randomUUID() + '.tmp');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    if (onlyIfMissing) {
      // Atomically import a legacy value without replacing a concurrent edit or reset.
      linkSync(temporary, file);
      unlinkSync(temporary);
    } else {
      renameSync(temporary, file);
    }
    return { saved: true, value };
  } catch (err) {
    unlinkSync(temporary);
    if (onlyIfMissing && err.code === 'EEXIST') {
      return { saved: false, value: readValue(file, field) ?? null };
    }
    throw err;
  }
}
