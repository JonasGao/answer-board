---
name: answer-board-delivery
description: 将一轮 grilling 或结构化问题投递成一次性、局域网可访问的 answer-board 网页表单；支持单选、多选、开放文本和推荐预填，提交后返回结构化 JSON 并退出。用户要求网页集中作答时使用；不要用于持久服务、静态 HTML 生成或仅询问 schema。
argument-hint: "[持续投递=on|off] [访问地址]"
---

# Answer Board Delivery

把一轮问题转换成 round JSON，启动本技能自带的一次性 Node 服务，让用户在网页集中作答。提交后服务写出答案 JSON 并退出；下一轮必须新建进程。

## 何时使用

- 用户要求把当前问题做成网页选择或填写
- 用户明确提到 answer-board
- 当前 grilling 问题较多，网页集中作答比终端逐题回答更合适

不要把本技能用于持久化服务、多轮自动编排、静态 HTML 导出或只想了解 schema 的请求。

## 斜杠命令参数

`/answer-board-delivery` 后可带两个可选参数（经 `$ARGUMENTS` 传入，按出现顺序解释，均可省略）：

1. 持续投递：`on` 表示本轮结束后继续用本技能投递后续轮次（每轮仍是独立进程，遵守「一轮一进程」约束）；`off` 或省略为单轮投递。
2. 访问地址：指定要告知用户的地址，如 `192.168.110.17`。必须匹配启动输出中某条 `LISTENING` 的地址，不匹配时回退到自动选择并说明。省略则按「告知地址」一节的规则自动挑选。

参数只影响投递方式，不改变 round JSON 的内容。

## 约束

- 标准投递使用 `scripts/ask.mjs`，不要为当前轮临时重写服务端代码。
- 一轮只启动一个 ask 进程；提交后 ask、board 和等待任务都应退出。
- 问题输入必须是 JSON；完整字段契约见 [references/round-schema.md](references/round-schema.md)。
- choice、multi 和 text 的题型必须使用契约中的明确值。推荐项用于预选或预填，不代表用户已经同意。
- 服务监听 `0.0.0.0` 且没有认证。只在用户和服务处于同一可信网络时使用，不要把密码、密钥、敏感个人信息或未公开商业信息放进 round JSON。

## 投递流程

### 1. 准备问题

将当前轮问题写入临时 JSON，例如 `/tmp/<project>-round<N>.json`。需要完整 schema 或答案字段时，先读 [references/round-schema.md](references/round-schema.md)。

### 2. 启动服务

```bash
node <skill_dir>/scripts/ask.mjs --questions /tmp/round-N.json
```

使用当前执行环境支持的后台任务方式运行，并保留任务或进程 ID。若执行器提供后台选项，启用它；不要让前台等待任务阻塞后续对话。启动输出包含：

- `Using port: NNNNN`：包装进程选定的端口
- `LISTENING http://...`：可访问地址
- 提交后 `---ANSWERS_FILE---` 与 `---ANSWERS---`：答案位置和内容

### 3. 告知地址

从任务输出读取 `LISTENING` 行。用户就在当前机器时使用 `127.0.0.1` 地址；远程用户选择与其处于同一可信网络、且确实可达的私有网卡地址。不要把 VPN、容器或不确定的网卡地址当成默认地址，也不要通过不可信网络暴露服务。

不要在对话中重复完整问题块，除非用户明确要求查看；网页地址和必要的访问说明仍要发送。

### 4. 等待提交

用户提交后，页面显示成功状态，服务自动退出，ask 进程随后输出答案并退出。等待后台任务完成，不要循环轮询。服务只接受第一份成功提交；重复提交会返回 HTTP 409。

若要取消或修改本轮，先停止承载 ask 的后台任务并确认 board 已退出，再重写 round JSON、启动新任务并发送新地址。不要同时保留多个等待提交的 board。

### 5. 读取答案

任务完成后读取 `---ANSWERS---` 块，或读取 `---ANSWERS_FILE---` 指向的 JSON 文件。确认答案文件存在且 JSON 可解析，再将答案灌回当前 grilling 状态。

## Markdown 与回退

`questions[].body` 使用 Markdown 渲染：markdown-it CDN 优先，本地 vendor 副本回退，两个脚本都不可用时保留服务端的换行、行内代码和代码块基础渲染。原始 HTML 不透传。不要把 HTML 标签当作 body 的输入格式。

## 常见故障

- `node: command not found`：运行环境没有 Node。
- `Error: questions file not found`：检查问题文件路径。
- `Failed to read questions`：检查 JSON 语法和 [references/round-schema.md](references/round-schema.md) 中的字段契约。
- 没有 `LISTENING`：读取任务完整输出；检查进程是否启动失败或端口是否被占用。
- HTTP 409：本轮已经有提交，读取已有答案，不要重复启动同一任务。
- HTTP 500 或没有答案文件：检查 `--answers` 路径的父目录和写权限。
- 提交后页面没有自动关闭：浏览器只允许脚本关闭「由脚本打开」的标签页，从地址栏或外链直接打开的页面无法自动关闭。页面会先静默尝试关闭，失败后显示对应平台的手动关闭指引（桌面 ⌘W/Ctrl+W、手机划掉页面），这是预期行为，不要尝试绕过浏览器限制。
