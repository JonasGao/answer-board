# 题内引用 questions[].refs

## 反馈

2026-11-18 OMC/SCC/FOC 需求面板 round 1 Q3 题干出现「整合后新增 ① 之前半」，① 指向需求文档第十节第 3 条，但左侧参考栏（facts）没有该条原文。作答者不知道 ① 指什么，未作答并在补充说明里反问「'新增 ①'如何解释」；round 2 改直白问法才拿到答案，多耗一整轮投递。

面板数据：`/tmp/omc-scc-foc-round1.json`（Q3）、`/tmp/omc-scc-foc-round1.answers.json`（Q3 反问）、`/tmp/omc-scc-foc-round2.json`。

## 决策

两层落地（用户确认 1+2 全做）：

1. SKILL.md 约束区新增出题规则：正文引用编号条目时，被引原文必须上页面（题内 `refs` / 顶层 `facts` / 内联 body），禁止悬空编号。
2. schema/渲染层新增 `questions[].refs`：纯文本数组，渲染在题干下方、选项之前。取舍见 [docs/adr/0006-question-refs.md](../../docs/adr/0006-question-refs.md)。

## Comments

- 2026-11-18：用户经 AskUserQuestion 选择「1+2」（SKILL.md 规则 + schema/渲染层同时做）。
