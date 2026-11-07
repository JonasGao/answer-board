# 题型 schema：显式 type、三种题型与 optional 语义

round JSON 的 `questions[].type` 区分三种题型：`choice`（单选，默认，可省略）、`multi`（多选，checkbox）、`text`（开放填写，textarea）。`text` 不带 per-question note——正文即答案，补充内容写总备注。所有题默认必答：必答 `text` 的正文不能为空，必答 `choice` / `multi` 要求选项或补充说明至少一个非空；`optional: true` 允许完全留空提交。留空题的答案始终「键在值空」（`{"choice": ""}` / `{"choices": []}` / `{"text": ""}`），与「漏答」区分开。`multi` 不设 min/max 勾选约束——「恰好 N 个」的需求罕见，写在 body 里靠人读，不靠机器拦。

关键取舍是 type 显式声明、不按「有无 `options`」推断：忘写 type 时开放题会渲染成空选项的单选框，错误在页面上可见；推断则会让 choice 漏写 options 静默变成 text 题，错误被掩盖。这延续了本技能「脚本不校验、写错看得见」的哲学。推荐项语义按题型分叉：choice 至多一项预选、multi 可多项预勾、text 是字符串预填（用户可改），保证「全部同意直接提交」在三种题型下都成立。

以上取舍（含被否方案：类型推断、multi min/max、text 附 note、留空键缺席/值 null）由维护者于 2026-10-24 grilling round 1 经 answer board 投递全推荐项确认。

2026-11-07 修订：choice 与 multi 都增加「以上都不合适」按钮，用于清空该题选项并聚焦说明框。这样推荐项仍可预选，同时允许说明作答；答案字段与服务端不做内容校验的约定保持不变。
