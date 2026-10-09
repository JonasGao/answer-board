import { describe, expect, it } from "vitest";
import { parsePastedQuestions } from "./paste";

// Distilled from a real `zellij action dump-screen` capture of a grilling
// session: shell prompts, spinner/status lines, "Round N" headers, `---`
// separators, unbolded question numbers, and a status bar of box-drawing
// characters at the bottom.
const TERMINAL_DUMP = `god@god-NUC11PAHi5:~$ zellij action dump-screen


● Skill(domain-modeling)
  ⎿  Successfully loaded skill

  Thought for 2m 2s

● 我先派两个探索代理去查系统事实，同时开始第一轮拷问。

  ---

  Round 1

  ❓ Q1 - 两处确认是同一个问题吗： 需求第二步问"是否将该仓库添加为系统采集源"，第四步又问"是否需要采集该仓库"。这两个问题是不是重复的？

  ➡  推荐：合并为一个确认。接口报"采集源不存在"后，直接问"要把这个仓库接入并立即收集吗？"——答应 → 列邮箱；拒绝 → 结束。

  ---

  ❓ Q2 - 已存在源的边界： 源已存在 → 直接触发收集。那用户如果其实想改这个源的用户邮箱或分支配置，本技能管不管？

  ➡  推荐：不管。已存在 → 只触发收集，输出里附一句"如需调整邮箱/分支请到系统页面"。

✻ Waiting for 2 background agents to finish

● Agent "探查现有技能调用模式" finished · 2m 51s

──────────────────────────────────────────────────────────────────────────────────
❯
  weekly-reporter | git:main | glm-5.3[1m] | ctx: 7% | effort:high | thinking
god@god-NUC11PAHi5:~$ ^C
god@god-NUC11PAHi5:~$`;

describe("parsePastedQuestions", () => {
  it("parses questions out of a noisy terminal dump", () => {
    const parsed = parsePastedQuestions(TERMINAL_DUMP);
    expect(parsed).toEqual({
      ok: true,
      questions: [
        {
          number: 1,
          question:
            "两处确认是同一个问题吗： 需求第二步问\"是否将该仓库添加为系统采集源\"，第四步又问\"是否需要采集该仓库\"。这两个问题是不是重复的？",
          recommendation:
            "推荐：合并为一个确认。接口报\"采集源不存在\"后，直接问\"要把这个仓库接入并立即收集吗？\"——答应 → 列邮箱；拒绝 → 结束。",
          truncated: false,
        },
        {
          number: 2,
          question:
            "已存在源的边界： 源已存在 → 直接触发收集。那用户如果其实想改这个源的用户邮箱或分支配置，本技能管不管？",
          recommendation:
            "推荐：不管。已存在 → 只触发收集，输出里附一句\"如需调整邮箱/分支请到系统页面\"。",
          truncated: false,
        },
      ],
    });
  });

  it("accepts the bold canonical form and keeps the bolded title in the body", () => {
    const parsed = parsePastedQuestions(
      "❓ **Q3** - **Scope**: Which users are included?\n\n➡️ Start with signed-in retail users.",
    );
    expect(parsed).toEqual({
      ok: true,
      questions: [
        {
          number: 3,
          question: "**Scope**: Which users are included?",
          recommendation: "Start with signed-in retail users.",
          truncated: false,
        },
      ],
    });
  });

  it("accepts en dash, em dash, and colon after the number", () => {
    for (const separator of ["–", "—", ":"]) {
      const parsed = parsePastedQuestions(
        `❓ Q7 ${separator} question text\n➡️ recommendation text`,
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.questions[0].number).toBe(7);
        expect(parsed.questions[0].question).toBe("question text");
      }
    }
  });

  it("keeps multi-line content and inner blank lines, trimming outer blanks", () => {
    const parsed = parsePastedQuestions(
      [
        "❓ Q1 - title",
        "",
        "first paragraph",
        "",
        "second paragraph",
        "",
        "➡️ step one",
        "step two",
        "",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      ok: true,
      questions: [
        {
          number: 1,
          question: "title\n\nfirst paragraph\n\nsecond paragraph",
          recommendation: "step one\nstep two",
          truncated: false,
        },
      ],
    });
  });

  it("does not split on delimiters inside a fenced code block", () => {
    const parsed = parsePastedQuestions(
      [
        "❓ Q1 - how does the config look",
        "",
        "```yaml",
        "❓ Q9 - fake question inside the fence",
        "➡️ fake recommendation inside the fence",
        "```",
        "",
        "➡️ like the example above",
      ].join("\n"),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.questions).toHaveLength(1);
      expect(parsed.questions[0].question).toContain("fake question inside the fence");
      expect(parsed.questions[0].recommendation).toBe("like the example above");
    }
  });

  it("flags a block without a recommendation as truncated but keeps it", () => {
    const parsed = parsePastedQuestions(
      "❓ Q4 - cut off by the screen edge\n\n---\n\nnoise between blocks",
    );
    expect(parsed).toEqual({
      ok: true,
      questions: [
        {
          number: 4,
          question: "cut off by the screen edge",
          recommendation: "",
          truncated: true,
        },
      ],
    });
  });

  it("rejects a paste whose question numbers repeat", () => {
    const parsed = parsePastedQuestions(
      "❓ Q3 - one\n➡️ first\n\n---\n\n❓ Q3 - two\n➡️ second",
    );
    expect(parsed).toEqual({ ok: false, reason: "duplicate", duplicates: [3] });
  });

  it("rejects a paste with no question blocks at all", () => {
    const parsed = parsePastedQuestions(
      "god@god-NUC11PAHi5:~$ ls\nREADME.md\nsrc\ngod@god-NUC11PAHi5:~$",
    );
    expect(parsed).toEqual({ ok: false, reason: "empty" });
  });

  it("returns questions sorted by number", () => {
    const parsed = parsePastedQuestions(
      "❓ Q5 - five\n➡️ r5\n\n❓ Q2 - two\n➡️ r2\n\n❓ Q9 - nine\n➡️ r9",
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(parsed.questions.map((question) => question.number)).toEqual([2, 5, 9]);
  });

  it("ends a recommendation at a terminal status bar line", () => {
    const parsed = parsePastedQuestions(
      "❓ Q1 - title\n➡️ recommendation\n──────────────────────\n❯ prompt noise",
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.questions[0].recommendation).toBe("recommendation");
      expect(parsed.questions[0].truncated).toBe(false);
    }
  });

  it("ends the last section at agent status chrome instead of swallowing it", () => {
    const parsed = parsePastedQuestions(
      [
        "❓ Q1 - title",
        "➡️ recommendation",
        "",
        "等你答完这轮 + 探索代理回来，我会有第二轮。",
        "✻ Waiting for 2 background agents to finish",
        "❯",
      ].join("\n"),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // The plain prose paragraph stays (it is structurally indistinguishable
      // from recommendation content and remains editable in the preview);
      // the chrome lines and everything after them do not.
      expect(parsed.questions[0].recommendation).toBe(
        "recommendation\n\n等你答完这轮 + 探索代理回来，我会有第二轮。",
      );
      expect(parsed.questions[0].recommendation).not.toContain("✻");
      expect(parsed.questions[0].recommendation).not.toContain("❯");
    }
  });
});
