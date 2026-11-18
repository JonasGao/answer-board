---
name: answer-board-delivery
description: 将 grilling 或结构化问题投递成局域网可访问的 answer-board 网页表单，支持单选、多选和开放文本。用户要求网页集中作答时使用。支持单轮和持续投递，持续模式在同一页面根据答案进入后续轮次。
argument-hint: "[持续投递=on|off] [访问地址]"
---

# Answer Board Delivery

把问题转换成 round JSON，在网页集中作答。每轮提交产生独立的答案 JSON。

## 何时使用

- 用户要求把当前问题做成网页选择或填写
- 用户明确提到 answer-board
- 当前 grilling 问题较多，网页集中作答比终端逐题回答更合适

## 斜杠命令参数

`/answer-board-delivery` 后可带两个可选参数（经 `$ARGUMENTS` 传入，按出现顺序解释，均可省略）：

1. 持续投递。显式传入 `on` 时，一个服务承接后续轮次，直到问答完成或用户取消。传入 `off` 或省略时，提交一轮后服务退出。
2. 访问地址：指定要告知用户的地址，如 `192.168.110.17`。必须匹配启动输出中某条 `LISTENING` 的地址，不匹配时回退到自动选择并说明。省略则按「告知地址」一节的规则自动挑选。

参数只影响投递方式，不改变 round JSON 的内容。

## 约束

- 标准投递使用 `scripts/ask.mjs`，不要为当前轮临时重写服务端代码。
- 问题输入必须是 JSON；完整字段契约见 [references/round-schema.md](references/round-schema.md)。
- choice、multi 和 text 的题型必须使用契约中的明确值。**生成 round JSON 时必须显式设置题型**：单选题 `"type": "choice"`（或省略，默认为 choice）；多选题 `"type": "multi"`（必须显式写，否则默认单选，页面渲染成 radio 而非 checkbox）；开放题 `"type": "text"`。判断标准：题目允许多个选项同时被选中 → multi；只能选一个 → choice。推荐项用于预选或预填，不代表用户已经同意。
- 问题正文引用源文档的编号条目（「新增 ①」「第 3 条」等）时，被引条目的原文必须同时出现在页面上：单题引用写该题 `refs`（渲染在题干下方），跨题共享的写顶层 `facts`，一句话能说清的可以直接内联进 body。悬空编号会让作答者无法理解题干——曾因此多耗一整轮投递。
- choice 和 multi 可通过「以上都不合适」清空选项，仅填写补充说明作答；必答题要求选项或说明至少一个，`optional: true` 仍允许完全留空。
- 答题页面在可信局域网内开放，无需认证。持续模式的投递和结束命令只在服务所在机器执行。对用户只发送答题地址，保留 `SESSION_DIR` 供本机命令使用。避免把敏感信息放进 round JSON。

## 投递流程

### 1. 准备问题

将当前轮问题写入临时 JSON，例如 `/tmp/<project>-round<N>.json`。需要完整 schema 或答案字段时，先读 [references/round-schema.md](references/round-schema.md)。

### 2. 启动并发送答题地址

```bash
node <skill_dir>/scripts/ask.mjs --questions /tmp/round-N.json
```

持续投递 `on` 时使用 Node.js 18 或更新版本，在首轮启动命令加 `--continuous`。使用执行环境支持的后台任务方式运行，保留任务 ID。持续模式还需从启动输出记录 `SESSION_DIR` 的路径。

从任务输出读取 `LISTENING` 行并发送答题地址。用户就在当前机器时使用 `127.0.0.1` 地址。远程用户选择与其处于同一可信网络且确实可达的私有网卡地址。用户打开网页后在那里作答，无需在对话中重复问题。

### 3. 等待并读取答案

**单轮**。等待启动任务完成，从 `---ANSWERS---` 或 `---ANSWERS_FILE---` 读取答案。用户提交后会看到成功页，服务自行退出。取消或修改尚未提交的问卷时，先停止服务任务，确认退出后再开始新的投递。

**持续投递**。用中间进度消息发送地址，让对话回合保持运行。持续服务在每轮提交后保持监听，另起一个等待任务读取该轮答案。把下列命令里的路径替换成 `SESSION_DIR`，把 `N` 替换成问题 JSON 的 `round`：

```bash
node <skill_dir>/scripts/ask.mjs --session "<SESSION_DIR>" --wait N
```

通过执行环境的等待工具等待读取任务退出。工具一次等待到期但任务仍在运行时，继续等待同一个任务。等待任务返回后，解析 `---ANSWERS---` 或读取 `---ANSWERS_FILE---`，校验答案属于当前轮，再接回 grilling 状态。

### 4. 持续模式下投递下一轮或结束

根据答案生成下一轮 JSON，将 `round` 加 1，并提交给同一个服务：

```bash
node <skill_dir>/scripts/ask.mjs --session "<SESSION_DIR>" --questions /tmp/round-next.json
```

看到 `ROUND_READY` 后，浏览器会在原页自动显示新题。回到第 3 步等待新一轮答案。任务完成或用户取消时，运行下面的命令并确认原服务任务退出：

```bash
node <skill_dir>/scripts/ask.mjs --session "<SESSION_DIR>" --finish
```

每轮的答案保存在 `SESSION_DIR/round-N.answers.json`，服务停止后仍可读取。若执行环境不支持在当前回合继续等待，及时告知用户续轮需要恢复对话，并保留地址、`SESSION_DIR` 和当前轮号。恢复时从第 3 步读取该轮，优先复用存活的服务。服务意外停止时，保留已提交答案，用当前待答轮启动新服务并发送新地址。

## Markdown 与回退

`questions[].body` 使用 Markdown 渲染：markdown-it CDN 优先，本地 vendor 副本回退，两个脚本都不可用时保留服务端的换行、行内代码和代码块基础渲染。原始 HTML 不透传。不要把 HTML 标签当作 body 的输入格式。

表格表头不换行，只有内容换行；宽表格在正文列内横向滚动，不会撑破问题栏。

宽屏（≥1024px）使用左参考、右问题的两栏布局：标题、副标题、背景事实和默认项在左栏粘性保留，右栏是问题流。每道题至少占一个视口高度，宽屏通过滚动吸附切题；总备注与提交按钮共同组成最后一屏。长问题自然增高，吸附使用 `proximity`，不会为了凑满一屏截断内容。

右栏顶部进度条和左栏问题索引随滚动同步，点击索引可直接跳题；进度表示当前位置，不表示已答数量。漏答提交时会滚回第一道未答必答题。窄屏堆叠为参考信息在上、问题在下的单栏，保留逐屏最小高度但关闭滚动吸附，避免长参考区干扰滚动。

题底提供并排居右的「返回上一题 / 滚动到下一题」链接；第一题只显示下一题，总备注可返回最后一题。非输入控件聚焦时，`↑` / `↓` 切换上一屏或下一屏；输入控件聚焦时保留原生方向键行为。每次按键只切一屏，长按不连续跳题，首尾不循环。

页面顶部工具条提供页面宽度和基础字号滑块。页面宽度默认 1440px，提供「标准 / 全宽」快捷键；表格密集的轮次可在问题 JSON 顶层写 `width`（px）作为初始宽度，见 [references/round-schema.md](references/round-schema.md)。基础字号默认 16px，可在 14–28px 间调整，页面所有文字按比例缩放，「标准」恢复默认值。

工具条位于文档顶部但随页面滚动，同时作为页首吸附点，避免首次加载自动跳过设置；窄屏换行且保留两组控制。宽度和字号偏好存于 `localStorage`，服务从 19876 起递增选择端口，因此同一 origin 下会跨轮、跨项目保留；不同主机或端口的偏好互不影响。

## 常见故障

- `node: command not found`：运行环境没有 Node。
- `Error: questions file not found`：检查问题文件路径。
- `Failed to load board` 或 `Invalid first round`：检查 JSON 语法和 [references/round-schema.md](references/round-schema.md) 中的字段契约。
- 没有 `LISTENING`：读取任务完整输出；检查进程是否启动失败、19876 及以上端口是否均不可用，或绑定是否被系统拒绝。
- 推送下一轮返回 HTTP 409。确认前一轮已提交、新文件的轮号恰好加 1。如果推送已经成功，直接对新一轮使用 `--wait`。
- HTTP 500 或没有答案文件：检查 `--answers` 路径的父目录和写权限。
- 单轮的成功页无法自动关闭时，按页面提示手动关闭标签页。持续模式提交后会保留页面，等待下一轮。
