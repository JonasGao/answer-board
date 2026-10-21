# Answer Board

把 grilling 问题通过局域网网页投递给用户作答的技能集：一轮问题一次进程，提交即退出，答案结构化返还 agent。

## Language

**轮（Round）**:
一次完整的问答投递：一个 ask.sh 进程、一批问题、一次提交、自动退出。下一轮是全新进程。
_Avoid_: 会话、批次、页面

**零安装（Zero-install）**:
技能的使用属性：无需 npm、无需构建，拷贝即用；运行时所需资源随仓库自带。
_Avoid_: 零依赖、无依赖

**推荐项预选（Recommended pre-check）**:
round JSON 中 `recommended: true` 的选项在页面上自动处于选中状态；用户全部同意即可直接提交。
_Avoid_: 默认选中、预勾选
