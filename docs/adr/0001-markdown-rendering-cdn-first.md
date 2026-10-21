# q.body 的 markdown 渲染采用 CDN 优先 + vendor 同版回退

问题正文需要完整 markdown 子集（表格/嵌套列表/引用/标题等），手写解析器覆盖不了，决定用 markdown-it 15.0.3 在浏览器端渲染。加载链：jsdelivr CDN（URL 锁定同版本、带 SRI）→ 挂起 2 秒或加载出错后回退本地 vendor 副本（`board.mjs` 服务 `/vendor/` 路由）→ 都不可用时维持服务端基础渲染（换行 + 代码块），即渐进增强。

CDN 层是在知情「vendor 文件反正要进仓库、CDN 在局域网场景只剩成本」后由维护者明确选择保留的（2026-10-20 grilling round 2）。不要把它『简化』成纯 vendor。版本漂移由 CDN URL 与 vendor 副本锁定同版本消除；原始 HTML 永不透传（`html: false`）。
