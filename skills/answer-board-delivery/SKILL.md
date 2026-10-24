---
name: answer-board-delivery
description: 用 answer-board 把一轮 grilling/结构化问题渲染成局域网网页表单（浏览器页面），让用户在页面上集中作答；零安装的一次性 HTML 服务，支持单选/多选/开放文本三种题型与推荐项预选（文本题预填），提交后服务自动退出，agent 拿到结构化 JSON 答案。当用户说「把这些问题做成网页让我选/填」「给我个页面回答这些问题」时也使用。
---

# Answer Board Delivery（简单 Node 服务版）

把一轮 grilling 问题渲染成本地网页，用户在页面作答、点提交、服务自动退出，agent 拿到结构化答案。零安装 Node 服务（无 npm、无构建），一次启动一次退出，局域网可访问。

## 何时使用

- 用户想让 grilling 通过网页投递（而非纯终端输出）
- 用户明确要求 answer-board
- 正在进行 grilling 会话，且问题较多、结构复杂，需要在页面上集中作答

## 关键约束

- **不要自己写 Node.js 代码**，**必须**用本技能的 `scripts/ask.sh`
- **一轮 = 一个进程**：用户提交后服务自动退出；出下一轮要重新启动
- **问题格式是 JSON**，不是 grilling 原始 markdown（`❓ Qn` / `➡️`）；agent 要把 grilling 的原始问题转成 JSON
- **推荐项要预选/预填**：选择题 `options[].recommended: true` 的项会在页面上自动 `checked`；文本题 `recommended` 是字符串，会预填进输入框（用户可改）。用户全部同意可直接提交
- **不要在对话里复制问题块**：问题已经渲染在页面上了；agent 只等答案
- **只在可信局域网使用，不要放敏感内容**：服务监听所有网卡（`0.0.0.0`）且无认证，知道 URL 的任何人都能查看问题并提交回答。这不只是安全边界，也是信任边界——题目会暴露你的计划，陌生人提交的回答会混进答案里、agent 无法分辨。所以不要把密码、密钥、敏感个人信息或未公开商业信息写进 round JSON；跨不可信网络时请改用其他投递方式

## 流程

### 1. 写 round JSON

把当前一轮 grilling 问题写成 JSON 文件（schema 见下方）。文件路径随意（建议 `/tmp/<project>-round<N>.json`）。

### 2. 启动服务（后台运行）

```bash
bash <skill_dir>/scripts/ask.sh --questions /tmp/round-N.json
```

**以 `run_in_background: true` 运行**。脚本会：
- 自动挑一个空闲端口
- 启动 `board.mjs`，打印 `LISTENING http://...` 行
- 等待用户提交
- 提交后打印 `---ANSWERS_FILE---` 和 `---ANSWERS---` 块
- 退出

### 3. 读 URL 告诉用户

脚本启动后会立即打印一行 `Using port: NNNNN`（stderr），接着是 `LISTENING http://...`（stdout）。从 task 输出文件读取 `LISTENING` 行，把 URL 告诉用户。**优先给局域网地址**（`http://<局域网IP>:<port>/`）。

### 4. 等任务完成

用户提交后，服务自动退出 → `board.mjs` 退出 → `ask.sh` 打印答案 → `ask.sh` 退出 → background task 完成通知触发。

### 5. 读答案

task 完成后，输出文件里会有：
```
---ANSWERS_FILE---
/tmp/round-N.answers.json
---ANSWERS---
{
  "round": N,
  "answers": { "Q1": {"choice": "A", "note": "..."}, "Q2": {"choices": ["A","B"]}, "Q3": {"text": "..."} },
  "global": "..."
}
```

直接读 `---ANSWERS---` 块，或用文件路径 `Read` 那个 JSON 文件。把答案灌回 grilling 状态，出下一轮。

### 取消或修改本轮

如果要取消或修改当前轮次：

1. 先停止承载该轮服务的后台任务（board 进程随之一起退出）
2. 重写 round JSON
3. 重新启动服务，把新 URL 告诉用户

不要同时保留多个等待提交的 board：同一时刻只应有一个当前轮次，否则用户可能答错页面，agent 也会拿到来源不明的答案。

## JSON Schema

### 问题文件（agent 写）

```json
{
  "round": 1,
  "title": "Grilling Round 1: 范围与策略",
  "subtitle": "可选的副标题说明",
  "facts": [
    "背景事实 1：...",
    "背景事实 2：..."
  ],
  "defaults": [
    "按项目惯例默认的项 1（有异议写总备注）",
    "按项目惯例默认的项 2"
  ],
  "questions": [
    {
      "id": "Q1",
      "title": "单选题标题",
      "body": "问题正文（支持 markdown，见下）",
      "options": [
        {
          "key": "A",
          "text": "选项文本",
          "desc": "选项说明（可选）",
          "recommended": true
        },
        {
          "key": "B",
          "text": "另一选项"
        }
      ]
    },
    {
      "id": "Q2",
      "type": "multi",
      "title": "多选题标题",
      "body": "问题正文（页面会标「可多选」）",
      "options": [
        { "key": "A", "text": "选项一", "recommended": true },
        { "key": "B", "text": "选项二", "recommended": true }
      ]
    },
    {
      "id": "Q3",
      "type": "text",
      "title": "开放题标题",
      "body": "问题正文（textarea 作答）",
      "placeholder": "输入框占位提示（可选）",
      "recommended": "预填的推荐答案（可选，用户可改）"
    }
  ]
}
```

契约（脚本不做校验，靠 agent 写对；写错会在页面渲染或提交时暴露）：

- 三种题型，由 `questions[].type` 区分：
  - `choice`（默认，可省略）：单选
  - `multi`：多选（checkbox，可勾多项）
  - `text`：开放填写（textarea）
- `choice` / `multi` 必须有 `options`（至少一项）；`text` 不写 `options`，可选 `placeholder`（占位提示）
- 必填：`round`、`title`、`questions`、`questions[].id`、`questions[].title`、`questions[].body`、（choice/multi）`options[].key`、`options[].text`
- 可选：`subtitle`、`facts`、`defaults`、`questions[].type`、`questions[].optional`、`questions[].options[].desc`、`questions[].options[].recommended`、`questions[].placeholder`（仅 text）
- 所有题默认必答（没答完不能提交）；`optional: true` 允许留空提交，页面会标「可跳过」
- 每个 `questions[].id` 在文件内唯一；同一题内 `options[].key` 唯一
- `recommended`：`choice` 至多一项（预选）；`multi` 可多项（全部预勾）；`text` 是字符串（预填）。如果希望用户全同意时直接提交，每题都要有推荐：choice 正好一项、multi 一组、text 预填文本

### 答案文件（服务写出）

```json
{
  "round": 1,
  "answers": {
    "Q1": { "choice": "A", "note": "用户的补充说明" },
    "Q2": { "choices": ["A", "B"], "note": "" },
    "Q3": { "text": "用户填写的回答" }
  },
  "global": "总备注内容"
}
```

- `text` 题没有 `note` 字段：正文就是回答本身，补充内容写总备注
- 留空提交的 optional 题：choice 是 `{"choice": "", "note": ...}`、multi 是 `{"choices": [], "note": ...}`、text 是 `{"text": ""}`——键仍在，空值表示「跳过」

## 示例：三种题型的 round.json

```json
{
  "round": 1,
  "title": "测试 Round",
  "subtitle": "",
  "facts": ["事实 A"],
  "defaults": ["默认项 X"],
  "questions": [
    {
      "id": "Q1",
      "title": "选一个",
      "body": "单选题，type 省略即 choice",
      "options": [
        { "key": "A", "text": "第一个", "recommended": true },
        { "key": "B", "text": "第二个" }
      ]
    },
    {
      "id": "Q2",
      "type": "multi",
      "title": "选多个",
      "body": "多选题",
      "options": [
        { "key": "A", "text": "甲", "recommended": true },
        { "key": "B", "text": "乙" }
      ]
    },
    {
      "id": "Q3",
      "type": "text",
      "title": "写一段",
      "body": "开放题",
      "recommended": "预填示例，用户可改"
    }
  ]
}
```

## 常见错误与处理

| 错误 | 原因 | 处理 |
|------|------|------|
| `Error: node is required but not found` | 系统没装 node | 安装 node |
| `Error: questions file not found` | 路径错或没写 | 检查路径 |
| `Failed to read questions: ...` | round JSON 语法错误 | 校验 round 文件（如 `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"`） |
| 页面空白、请求时报错或问题串组 | JSON 结构不符合 schema 或 `id` 重复 | 检查必填字段和 `id`/`key` 唯一性 |
| 开放题渲染成没有选项的单选框、无法作答 | 该题漏写 `"type": "text"`（默认按 choice 渲染） | 给开放题补上 `type` 字段 |
| 多选题只能选一个 | `type` 写错或漏写（默认 choice） | 改成 `"type": "multi"` |
| `Error: failed to find a free port` | 端口耗尽 | 重启服务或换机器 |
| 服务启动后 10 秒内没打印 `LISTENING` | 端口被占用或启动卡住 | 检查 task 输出，必要时 kill 重试 |
| 用户没提交、agent 等太久 | 正常——服务会一直等 | 不要轮询，等 task 完成通知 |

## 端口与主题

- **端口**：自动挑选（OS 分配空闲端口），不需要用户或 agent 指定
- **主题**：页面自动跟随系统主题（亮/暗），通过 CSS `prefers-color-scheme` 实现，无需用户操作

## q.body 的 markdown 支持

`body` 字段支持 markdown 子集：**列表（有序/无序/嵌套）、粗体/斜体、行内链接、表格、引用、标题（h1-h4）、行内代码、代码块、换行、分隔线**。仅 `body` 生效；`title` / `options` / `facts` / `defaults` 仍是纯文本。原始 HTML 不透传（会被转义成文本显示），不要在 body 里写 HTML 标签。
