// Tolerant parsing of question blocks from text a human copied out of an
// agent's terminal output (for example a `zellij action dump-screen` capture).
// Pure logic, no DOM and no I/O — a paste-side counterpart to parseNumberList
// in format.ts, deliberately looser than the strict markdown parser on the
// delivery socket (src-tauri parse_markdown):
//
// - Everything outside a question block is ignored: shell prompts, spinner
//   lines, agent status output, "Round N" headers, status bars.
// - The `**` bolding around the Q-number is optional; `-`, `–`, `—`, and `:`
//   all work as the separator after the number.
// - A run of dashes or box-drawing characters (`---`, a terminal status bar)
//   ends the current block instead of erroring, and so does a line of agent
//   or terminal UI chrome (leading `●`, `✻`, `⎿`, `❯`).
// - Fenced code blocks inside a question or recommendation are literal text:
//   delimiters inside them neither split nor start blocks.
// - A block whose `➡️` section is missing or empty is kept and flagged
//   truncated so the preview can warn before anything reaches the board.

export type PastedQuestion = {
  number: number;
  question: string;
  recommendation: string;
  truncated: boolean;
};

export type ParsedPaste =
  | { ok: true; questions: PastedQuestion[] }
  | { ok: false; reason: "empty" | "duplicate"; duplicates?: number[] };

const QUESTION_RE =
  /^\s*❓\s*(?:\*\*)?\s*Q([1-9][0-9]*)\s*(?:\*\*)?\s*[-–—:]\s*(.*?)\s*$/;
// ➡ with or without its variation selector, as terminal dumps lose it.
const RECOMMENDATION_RE = /^\s*➡️?\s*(.*?)\s*$/;
// Three or more dash/box-drawing characters: the `---` separator between
// grilling questions, or a horizontal terminal/status bar line.
const RULE_RE = /^[\-‐-―=─-╿]{3,}$/;
// A line of agent/terminal UI chrome (Claude Code status bullets, the zellij
// prompt). Dumps end with these after the last question and no `---` guards
// that boundary, so a chrome line also terminates the current section.
const CHROME_RE = /^\s*[●✻⎿❯]/;

function endsBlock(line: string): boolean {
  return RULE_RE.test(line.trim()) || CHROME_RE.test(line);
}

type Fence = { marker: string; length: number };

// Port of the fence detection in src-tauri's parse_markdown: up to three
// leading spaces, then a run of backticks or tildes.
function fenceRun(line: string): { marker: string; length: number; rest: string } | null {
  const match = /^ {0,3}(`+|~+)/.exec(line);
  if (!match) return null;
  return {
    marker: match[1][0],
    length: match[1].length,
    rest: line.slice(match[0].length),
  };
}

function updateFence(fence: Fence | null, line: string): Fence | null {
  const run = fenceRun(line);
  if (!run) return fence;
  if (
    fence &&
    run.marker === fence.marker &&
    run.length >= fence.length &&
    run.rest.trim() === ""
  )
    return null;
  if (!fence && run.length >= 3 && !(run.marker === "`" && run.rest.includes("`")))
    return { marker: run.marker, length: run.length };
  return fence;
}

// Join a section's lines, dropping leading/trailing blank lines but keeping
// the blank lines and indentation in between (same as join_markdown_block).
function joinBlock(lines: string[]): string {
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start < 0) return "";
  let end = lines.length - 1;
  while (lines[end].trim() === "") end -= 1;
  return lines.slice(start, end + 1).join("\n");
}

type Block = {
  number: number;
  questionLines: string[];
  questionFence: Fence | null;
  recommendationLines: string[] | null;
  recommendationFence: Fence | null;
};

function startBlock(header: RegExpExecArray): Block {
  const first = header[2];
  return {
    number: Number(header[1]),
    questionLines: [first],
    questionFence: updateFence(null, first),
    recommendationLines: null,
    recommendationFence: null,
  };
}

export function parsePastedQuestions(raw: string): ParsedPaste {
  const lines = raw.split(/\r\n?|\n/);
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const line of lines) {
    if (current && current.recommendationLines === null && current.questionFence === null) {
      const recommendation = RECOMMENDATION_RE.exec(line);
      if (recommendation) {
        const first = recommendation[1];
        current.recommendationLines = [first];
        current.recommendationFence = updateFence(null, first);
        continue;
      }
    }

    const fenceActive = current
      ? current.recommendationLines === null
        ? current.questionFence !== null
        : current.recommendationFence !== null
      : false;
    const header = QUESTION_RE.exec(line);
    if (current && !fenceActive && (header || endsBlock(line))) {
      blocks.push(current);
      current = null;
    }
    if (!current) {
      if (header) current = startBlock(header);
      continue;
    }

    if (current.recommendationLines === null) {
      current.questionLines.push(line);
      current.questionFence = updateFence(current.questionFence, line);
    } else {
      current.recommendationLines.push(line);
      current.recommendationFence = updateFence(current.recommendationFence, line);
    }
  }
  if (current) blocks.push(current);

  if (blocks.length === 0) return { ok: false, reason: "empty" };

  const seen = new Set<number>();
  const duplicates = new Set<number>();
  blocks.forEach((block) =>
    seen.has(block.number) ? duplicates.add(block.number) : seen.add(block.number),
  );
  if (duplicates.size > 0)
    return { ok: false, reason: "duplicate", duplicates: [...duplicates].sort((a, b) => a - b) };

  const questions = blocks
    .map((block) => {
      const recommendation = joinBlock(block.recommendationLines ?? []);
      return {
        number: block.number,
        question: joinBlock(block.questionLines),
        recommendation,
        truncated: recommendation === "",
      };
    })
    .sort((a, b) => a.number - b.number);
  return { ok: true, questions };
}
