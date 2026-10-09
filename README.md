# dsh-enter-using

DSH Web 界面插件：**命令授权（审批）支持键盘回车 + 数字键**，手感类似 Codex。

默认的 DSH 审批面板只认「回车允许 / Esc 拒绝」。装上这个插件后，面板变成带编号选项的键盘面板，不用鼠标也能授权。

## 按键

| 按键 | 作用 |
| --- | --- |
| `1` | 允许一次 |
| `2` | 拒绝 |
| `Enter` | 确认当前高亮项（默认第 1 项＝允许一次） |
| `Esc` | 拒绝 |
| `↑` `↓` `←` `→` | 切换高亮项（循环） |
| 鼠标悬停 / 点击 | 同样可用 |

面板选项顺序固定为 `1 允许一次`、`2 拒绝`，与 Codex 一致：默认回车＝放行，误按回车也不会拒绝。

## 实现方式

- 以 `priority: 0.5` 注册到会话编辑器的链式槽位 `conversation.composer`，比官方审批面板（`priority: 1`）更早被匹配，从而接管审批渲染。
- `select` 只匹配 `kind === "approval"` 且可作答的待处理交互；其它待处理交互（例如计划评审）仍返回 `null`，继续由官方面板处理，互不干扰。
- 键盘监听注册在 `document` 的**捕获阶段**，命中后 `preventDefault()` + `stopPropagation()`。下列情况一律让行：
  - 事件已被处理（`defaultPrevented`）、输入框/文本域/`contenteditable` 内、页面上存在 `[role="dialog"]` / `[aria-modal="true"]` 弹窗；
  - 带 `Ctrl` / `Meta` / `Alt` 修饰、输入法组合态（`isComposing` / `keyCode 229`）、系统按键重复（`repeat`）。
- 不调用 `ctx.shortcuts.registerFixed`：官方审批面板已占用 `Enter` / `Escape` 两个固定快捷键，键位处理放在插件组件内部，避免重复注册冲突。
- 每次审批只作答一次：作答中禁用按钮，Host 拒绝/失败后自动恢复可作答状态，组件卸载后不再更新状态。
- 样式通过 `ctx.effect` 注入一串带 `data-plugin-css` 标记的 `<style>`，卸载时移除；类名统一 `deu_` 前缀，颜色只引用 `--dsw-alias-*` 主题变量并带兜底值。

## 安装

本仓库本身就是一个 DSH bundle（`package.json` 里的 `dsh.bundle.patch` + `dsh.client`）。

- **DSH 内**：`plugin_manager` → `install_bundle`，target 填本仓库目录（例如 `D:\dsh-project`）。
- **命令行**：`dsh plugin add D:\dsh-project`。

安装后按提示刷新页面或重启 `dsh web` 生效；命令授权面板出现时即可用数字键 / 回车 / Esc 作答。

## 开发

```bash
npm test
```

26 项测试，全部通过。测试在 `vm` 沙箱中加载 `client.js`（stub 掉 `window.__ModuleLoader__`、`document` 与 `react`），覆盖：槽位注册契约、locale 词典完整性、样式注入与回收、按键映射与全部守卫条件、作答状态机（重复按键 / 不可作答 / 失败回滚）、以及卸载时监听器清理。

## 目录

```
package.json          # dsh.bundle.patch + dsh.client（platform: web, immediately）
cordis.patch.yml      # bundle 注入声明
index.js              # Host 半边（无行为，UI 全在 Client）
client.js             # Client 半边：审批面板 + 键盘交互
test/client.test.mjs  # 测试
```
