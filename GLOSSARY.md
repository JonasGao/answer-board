# Answer Board

把 grilling 问题通过局域网网页投递给用户作答的技能集：一轮问题一次进程，提交即退出，答案结构化返还 agent。

## Language

**轮（Round）**:
一次完整的问答投递：一个 ask.mjs 进程、一批问题、一次提交、自动退出。下一轮是全新进程。
_Avoid_: 会话、批次、页面

**零安装（Zero-install）**:
技能的使用属性：无需 npm、无需构建，拷贝即用；运行时所需资源随仓库自带。
_Avoid_: 零依赖、无依赖

**推荐项预选（Recommended pre-check）**:
round JSON 中的推荐项在页面上自动就位：选择题 `recommended: true` 的选项自动 `checked`，文本题 `recommended` 字符串预填进输入框（用户可改）。用户全部同意即可直接提交。
_Avoid_: 默认选中、预勾选

**题型（Question type）**:
`questions[].type` 区分的三种作答形式：`choice`（单选，默认可省略）、`multi`（多选）、`text`（开放填写）。任意题型可标 `optional: true` 允许留空提交，页面标「可跳过」。
_Avoid_: 输入类型、问题种类

**可调文档宽度（Adjustable document width）**:
页面主内容列的宽度：默认 820px，由问题 JSON 顶层 `width` 设初始值，用户在页面顶部拖动覆盖；同一轮刷新后保留，超出窗口宽度时夹到窗口宽度。
_Avoid_: 响应式断点、布局宽度

**表格滚动容器（Table scroll container）**:
Markdown 渲染后包住每个表格的独立容器：宽度不超过正文列，表头不换行、内容换行，表格溢出时只在这个容器内横向滚动。
_Avoid_: 响应式表格、表格折叠
