# 更新记录

## 0.2.1 — 2026-10-18

### 修复：卡片里的按钮点不动

**现象**：卡片上的 `Button("跑一次测试", @ToAssistant("跑一次测试"))` 渲染正常、看起来能点，
鼠标悬停也有手型光标，但点下去什么也不发生。

**根因**：不是渲染问题，是动作**发出去了没人接**。

官方渲染器 `@openuidev/react-lang` 把 `@ToAssistant(...)` 降级成一个
`continue_conversation` 动作事件交给 `onAction` 回调。事件本身是对的，参数也对：
文字在 `humanFriendlyMessage` 里，`params` 只带一个可选的 `context`。

但本插件的 `onAction` 只把事件转给 `runLibraryAction()`，而那个函数只认
`CopyToClipboard`，其余一律返回 `null` 表示"不是我管的"，然后就没人管了。
于是按钮真的点了、事件真的产生了、也确实被丢掉了。

**修复**：新增 `handleCardAction()` 作为所有卡片动作的唯一入口，把
`continue_conversation` 接到 DSH 自己的 composer 上：

```ts
actions.setDraft(text);   // 写进输入框
actions.submit();         // 提交，等同于按回车
```

走 composer 而不是另外调一个 Host 接口是刻意的：这条路径就是用户自己按回车发消息
的路径，排队、录入对话、错误处理全是现成的，不需要再造一套。

顺带把 `@OpenUrl(...)` 也接上了（原来同样是丢掉的）。

### 修复：多个对话轮次同屏时会串台

第一版修复把 composer 绑定放在**模块级变量**里，靠渲染时覆盖来"找到当前轮次"。
这在单轮测试里看不出问题，但多轮对话同时挂载时，最后渲染的那一轮会接管所有点击——
A 轮卡片上的按钮会把消息发进 B 轮的输入框。

改为 React context：每个轮尾组件用自己的 ref 向自己的卡片树提供绑定，卡片只认自己那一轮的
composer。`test/crosstalk.test.cjs` 专门守这个回归。

### 修复：文件名里的下划线被当成斜体

`run_minimax_h3_6gb.bat` 会被渲染成 `run*minimax*h3_6gb.bat`——`Text` 组件的行内
Markdown 把 `_minimax_` 当成了强调。

严格按 CommonMark，两个字母数字之间的 `_` 本来就不该开启强调，所以这里补了同样的规则：
被字母数字包住的下划线按字面处理。`*italic*` 不受影响。

### 改进：提示词教模型正确用 `Row` 和 `Button`

截图里"标签 / 值"两栏挤成一左一中，是因为 `Row([Caption, Spacer, Text], 2)` 少了
`justify` 参数——`Row` 的第五个参数才是 `justify`，不传就只是默认左对齐排列。
新增两条规则：

- 讲清 `Row` 是 `[children, gap, align, justify, wrap]`，标签+值要对齐两端就传 `"between"`。
- 讲清答案有明显下一步时，结尾给短按钮，一个动作一个按钮，不要把状态塞进按钮。

### 测试

新增 3 个套件、18 项检查，连同原有的 `verify.mjs` 共 **29 项全部通过**：

| 套件 | 项数 | 覆盖 |
|---|---|---|
| `test/verify.mjs` | 11 | 组件渲染（原有） |
| `test/crosstalk.test.cjs` | 5 | 多轮不串台 |
| `test/click.test.cjs` | 7 | 点击 → 写草稿 → 提交 |
| `test/actions.test.mjs` | 6 | 按钮渲染、`Row` 对齐、文件名下划线 |

`handleCardAction` 之所以是导出的，就是为了让点击链路能被直接测到——出问题的地方正是
"事件进来之后发生了什么"，光测渲染测不出来。

### 升级

替换 `lib/client.js` 即可热更新；`package.json` 版本号变了，若之前装的是 0.2.0，
建议按 README 的方式重装一次再重启 DSH。
