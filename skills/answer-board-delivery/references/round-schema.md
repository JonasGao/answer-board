# Round JSON Schema

`ask.mjs` 接受一个问题 JSON 文件，并在提交后写出答案 JSON。当前服务不替 agent 做完整 schema 校验，因此写文件前按以下契约检查字段、题型和唯一性。

## 问题文件

```json
{
  "round": 1,
  "title": "Grilling Round 1: 范围与策略",
  "subtitle": "可选副标题",
  "width": 1100,
  "facts": ["背景事实"],
  "defaults": ["按项目惯例默认的项"],
  "questions": [
    {
      "id": "Q1",
      "title": "单选题标题",
      "body": "问题正文，支持 Markdown",
      "options": [
        { "key": "A", "text": "选项文本", "desc": "可选说明", "recommended": true },
        { "key": "B", "text": "另一选项" }
      ]
    },
    {
      "id": "Q2",
      "type": "multi",
      "title": "多选题标题",
      "body": "可勾选多个选项",
      "optional": true,
      "options": [
        { "key": "A", "text": "选项一", "recommended": true },
        { "key": "B", "text": "选项二" }
      ]
    },
    {
      "id": "Q3",
      "type": "text",
      "title": "开放题标题",
      "body": "开放填写",
      "placeholder": "可选占位提示",
      "recommended": "可选预填文本"
    }
  ]
}
```

顶层字段：

- 必填：`round`、`title`、`questions`。
- 可选：`subtitle`、`facts`、`defaults`、`width`。
- `width` 是页面文档初始宽度的像素值（默认 820）。表格较多的轮次可调宽；超出窗口宽度时由页面自动夹到窗口宽度。用户在页面顶部仍可拖动调节，调节结果在同一轮刷新后保留。
- `facts` 和 `defaults` 是纯文本数组，只用于页面背景信息。
- `questions` 中每个 `id` 必须唯一；同一题的 `options[].key` 必须唯一。
- `questions` 至少包含一题。

题型规则：

- `choice`：单选；`type` 可省略，省略时默认为 `choice`。
- `multi`：多选；使用 checkbox，不设置机器强制的最少或最多选择数。
- `text`：开放填写；使用 textarea，不带题目级 `note` 字段。
- `choice` 和 `multi` 必须有至少一个 option；`text` 不需要 options。
- 所有题默认必答；`optional: true` 允许留空提交。
- `choice` 最多一个 `recommended: true`；`multi` 可以有多个；`text` 的 `recommended` 必须是预填字符串。
- 表单字段使用独立的 `__answer_board_q_<id>`、`__answer_board_note_<id>` 和 `__answer_board_global` 命名空间，不会改变答案中的原始题目 ID。
- `title`、`options[].text`、`options[].desc`、`facts` 和 `defaults` 按纯文本填写；只有 `body` 按 Markdown 渲染。

## 答案文件

服务写出的答案形状如下，choice 和 multi 都会包含 `note`：

```json
{
  "round": 1,
  "answers": {
    "Q1": { "choice": "A", "note": "补充说明" },
    "Q2": { "choices": ["A", "B"], "note": "" },
    "Q3": { "text": "用户填写的回答" }
  },
  "global": "总备注"
}
```

- `text` 题的正文就是回答本身，不生成题目级 `note`；补充内容写入 `global`。
- optional 题留空时仍保留答案键：choice 为 `{ "choice": "", "note": "" }`，multi 为 `{ "choices": [], "note": "" }`，text 为 `{ "text": "" }`。
- 服务只接受第一份成功提交；答案来源是可信网络中第一个向 `/submit` 发起成功请求的客户端。

## Markdown 范围

`body` 支持列表、嵌套列表、粗体、斜体、行内链接、表格、引用、标题、行内代码、代码块、换行和分隔线。标题、选项、事实和默认项不按 Markdown 渲染。HTML 原文会被转义。

表格渲染规则：表头（`th`）永不换行，只有单元格内容（`td`）换行；每个表格被包进独立的横向滚动容器，宽度不超过正文列，溢出时容器内出现横向滚动条，不会撑破卡片。溢出容器可用键盘方向键滚动。
