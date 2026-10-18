---
name: answer-board-delivery
description: 把一轮 grilling 问题通过局域网 HTML 页面投递给用户作答；提交后一次性服务自动退出，agent 拿到结构化答案。替代旧的 socket+Tauri 投递方案。
---

# Answer Board Delivery（简单 Node 服务版）

把一轮 grilling 问题渲染成本地网页，用户在页面作答、点提交、服务自动退出，agent 拿到结构化答案。零依赖 Node 服务，一次启动一次退出，局域网可访问。

## 何时使用

- 用户想让 grilling 通过网页投递（而非纯终端输出）
- 用户明确要求 answer-board
- 正在进行 grilling 会话，且问题较多、结构复杂，需要在页面上集中作答

## ⚠️ 关键约束

- **不要自己写 Node.js 代码**，**必须**用本技能的 `scripts/ask.sh`
- **一轮 = 一个进程**：用户提交后服务自动退出；出下一轮要重新启动
- **问题格式是 JSON**，不是 grilling 原始 markdown（`❓ Qn` / `➡️`）；agent 要把 grilling 前沿转成 JSON
- **推荐项要预选**：JSON 里 `options[].recommended: true` 的项会在页面上自动 `checked`，用户全部同意可直接提交
- **不要在对话里复制问题块**：问题已经渲染在页面上了；agent 只等答案

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

脚本启动后会立即打印一行 `Using port: NNNNN`（stderr），接着是 `LISTENING http://...`（stdout）。从 task 输出文件读取 `LISTENING` 行，把 URL 告诉用户。**优先给局域网地址**（`http://<非内网IP>:<port>/`）。

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
  "answers": { "Q1": {"choice": "A", "note": "..."}, ... },
  "global": "..."
}
```

直接读 `---ANSWERS---` 块，或用文件路径 `Read` 那个 JSON 文件。把答案灌回 grilling 状态，出下一轮。

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
      "title": "问题标题",
      "body": "问题正文（可多行）",
      "options": [
        {
          "key": "A",
          "text": "选项文本",
          "desc": "选项说明（可选）",
          "recommended": true
        },
        {
          "key": "B",
          "text": "另一选项",
          "desc": "...",
          "recommended": false
        }
      ]
    }
  ]
}
```

### 答案文件（服务写出）

```json
{
  "round": 1,
  "answers": {
    "Q1": { "choice": "A", "note": "用户的补充说明" },
    "Q2": { "choice": "B", "note": "" }
  },
  "global": "总备注内容"
}
```

## 示例：最小 round.json

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
      "body": "随便选一",
      "options": [
        { "key": "A", "text": "第一个", "recommended": true },
        { "key": "B", "text": "第二个" }
      ]
    }
  ]
}
```

## 常见错误与处理

| 错误 | 原因 | 处理 |
|------|------|------|
| `Error: node is required but not found` | 系统没装 node | 安装 node |
| `Error: questions file not found` | 路径错或没写 | 检查路径 |
| `Error: failed to find a free port` | 端口耗尽 | 重启服务或换机器 |
| 服务启动后 10 秒内没打印 `LISTENING` | 端口被占用或启动卡住 | 检查 task 输出，必要时 kill 重试 |
| 用户没提交、agent 等太久 | 正常——服务会一直等 | 不要轮询，等 task 完成通知 |

## 与 `answer-board-continuous` 的关系

本技能是**单次投递**。如果用户要「连续投递」（grilling 自动 round-to-round，agent 不出问题块到对话），启用 `$answer-board-continuous`（如果存在）。Continuous 是本技能的循环包装。

## 端口与主题

- **端口**：自动挑选（OS 分配空闲端口），不需要用户或 agent 指定
- **主题**：页面自动跟随系统主题（亮/暗），通过 CSS `prefers-color-scheme` 实现，无需用户操作
