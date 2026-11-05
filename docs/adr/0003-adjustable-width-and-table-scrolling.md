# 文档宽度可调，Markdown 表格在独立容器内横向滚动

问答页原来把主内容列写死成 `max-width: 820px`，Markdown 表格直接落在 `.q-body` 里：表头会随列宽折行，宽表格会把卡片撑破并溢出到正文列之外。

决定：

- 主内容列改用 `--doc-width`（默认 820px，`width: var(--doc-width); max-width: 100%`）。页面顶部加 sticky 宽度工具条（滑块 + 「标准 / 全宽」+ 当前宽度读数），用户的选择写 `localStorage`，同一轮刷新后保留。跨轮次的初始宽度由问题 JSON 顶层 `width`（px）给出；因为 `ask.mjs` 每轮随机端口，localStorage 天然不跨轮次生效，不需要额外同步机制。
- `width` 只接受有限数字并在服务端夹到 640–4000px，非法值回落到 820px；客户端再夹到窗口宽度。窄屏（≤640px）隐藏工具条——此时列宽必然等于窗口宽度，调节没有意义。
- Markdown 渲染完成后，在浏览器端把每个 `<table>` 包进 `.table-scroll` 容器（`max-width: 100%; overflow-x: auto`），而不是改 `table` 自身的 `display`。`th` 一律 `white-space: nowrap`，`td` 用 `white-space: normal; overflow-wrap: anywhere` 允许内容换行但不让长字符串把列的最小内容宽度撑大。表头本身撑宽表格时，表格在容器内横向滚动，不会溢出卡片。
- 只有实测 `scrollWidth > clientWidth` 的容器才加 `tabindex="0"` / `role="region"`，让键盘用户也能横向滚动；窗口尺寸和文档宽度变化后重新判定。

被否方案：

- **CSS 的 `table { display: block; overflow-x: auto }`**：不用包容器，改动最小，但会让表格失去表格格式化上下文，`thead`/`tbody` 列宽容易错位，且外边框、圆角和滚动条样式都难统一。
- **所有单元格 `white-space: nowrap`**：能稳定触发滚动，但违反「只有内容换行」——长段落会被压成单行。
- **只给 `table` 加 `max-width: 100%; overflow-x: auto`**：表格自身既是滚动容器又是被滚动内容，表头底色、边框和圆角会跟着滚，且 `border-collapse` 下边框处理不可靠。
- **把宽度写死成多个响应式断点**：用户面对的是「这轮问题里有一张很宽的对比表」，需要当场调节，不是设备分类问题。

约束延续：服务端基础渲染（CDN 与 vendor 都不可用时）仍只做换行、行内代码和代码块，表格包装只发生在 markdown-it 就绪后的渐进增强阶段；`html: false` 不变；不引入构建和依赖。
