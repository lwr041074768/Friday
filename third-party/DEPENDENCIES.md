# 第三方依赖与原始许可文件

本清单由 `node scripts/collect-licenses.mjs` 从当前 `package-lock.json` 和安装后的包目录生成。许可文件按原始字节保存，未改写正文或版权署名；从官方上游补充的原文另附来源与版本记录。

范围：锁文件中所有 `node_modules/` 条目且 `dev !== true`，共 85 个；另收集 2 个直接进入页面样式的 CSS 包。这个集合包含类型依赖和可能被构建工具移除的代码，不声称每个包都进入最终 JavaScript。

SPDX 栏使用包元数据声明。附带的原始 LICENSE、COPYING、NOTICE 和版权通知文件保留各自完整条款；例如 Lucide 原文还包含 Feather 图标的 MIT 许可。此处不以项目根许可证替代第三方许可证。

| 包名 | 版本 | SPDX（元数据） | 范围 | 锁文件路径 | 原始许可 / NOTICE | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| @floating-ui/core | 1.8.0 | MIT | 锁文件生产依赖 | `node_modules/@floating-ui/core` | [licenses/@floating-ui/core/LICENSE](licenses/%40floating-ui/core/LICENSE) |  |
| @floating-ui/dom | 1.8.0 | MIT | 锁文件生产依赖 | `node_modules/@floating-ui/dom` | [licenses/@floating-ui/dom/LICENSE](licenses/%40floating-ui/dom/LICENSE) |  |
| @floating-ui/react-dom | 2.1.9 | MIT | 锁文件生产依赖 | `node_modules/@floating-ui/react-dom` | [licenses/@floating-ui/react-dom/LICENSE](licenses/%40floating-ui/react-dom/LICENSE) |  |
| @floating-ui/utils | 0.2.12 | MIT | 锁文件生产依赖 | `node_modules/@floating-ui/utils` | [licenses/@floating-ui/utils/LICENSE](licenses/%40floating-ui/utils/LICENSE) |  |
| @radix-ui/number | 1.1.3 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/number` | [licenses/@radix-ui/number/LICENSE](licenses/%40radix-ui/number/LICENSE) |  |
| @radix-ui/primitive | 1.1.7 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/primitive` | [licenses/@radix-ui/primitive/LICENSE](licenses/%40radix-ui/primitive/LICENSE) |  |
| @radix-ui/react-accessible-icon | 1.1.15 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-accessible-icon` | [licenses/@radix-ui/react-accessible-icon/LICENSE](licenses/%40radix-ui/react-accessible-icon/LICENSE) |  |
| @radix-ui/react-accordion | 1.2.20 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-accordion` | [licenses/@radix-ui/react-accordion/LICENSE](licenses/%40radix-ui/react-accordion/LICENSE) |  |
| @radix-ui/react-alert-dialog | 1.1.23 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-alert-dialog` | [licenses/@radix-ui/react-alert-dialog/LICENSE](licenses/%40radix-ui/react-alert-dialog/LICENSE) |  |
| @radix-ui/react-arrow | 1.1.15 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-arrow` | [licenses/@radix-ui/react-arrow/LICENSE](licenses/%40radix-ui/react-arrow/LICENSE) |  |
| @radix-ui/react-aspect-ratio | 1.1.15 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-aspect-ratio` | [licenses/@radix-ui/react-aspect-ratio/LICENSE](licenses/%40radix-ui/react-aspect-ratio/LICENSE) |  |
| @radix-ui/react-avatar | 1.2.6 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-avatar` | [licenses/@radix-ui/react-avatar/LICENSE](licenses/%40radix-ui/react-avatar/LICENSE) |  |
| @radix-ui/react-checkbox | 1.3.11 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-checkbox` | [licenses/@radix-ui/react-checkbox/LICENSE](licenses/%40radix-ui/react-checkbox/LICENSE) |  |
| @radix-ui/react-collapsible | 1.1.20 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-collapsible` | [licenses/@radix-ui/react-collapsible/LICENSE](licenses/%40radix-ui/react-collapsible/LICENSE) |  |
| @radix-ui/react-collection | 1.1.15 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-collection` | [licenses/@radix-ui/react-collection/LICENSE](licenses/%40radix-ui/react-collection/LICENSE) |  |
| @radix-ui/react-compose-refs | 1.1.5 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-compose-refs` | [licenses/@radix-ui/react-compose-refs/LICENSE](licenses/%40radix-ui/react-compose-refs/LICENSE) |  |
| @radix-ui/react-context | 1.2.2 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-context` | [licenses/@radix-ui/react-context/LICENSE](licenses/%40radix-ui/react-context/LICENSE) |  |
| @radix-ui/react-context-menu | 2.3.7 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-context-menu` | [licenses/@radix-ui/react-context-menu/LICENSE](licenses/%40radix-ui/react-context-menu/LICENSE) |  |
| @radix-ui/react-dialog | 1.1.23 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-dialog` | [licenses/@radix-ui/react-dialog/LICENSE](licenses/%40radix-ui/react-dialog/LICENSE) |  |
| @radix-ui/react-direction | 1.1.4 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-direction` | [licenses/@radix-ui/react-direction/LICENSE](licenses/%40radix-ui/react-direction/LICENSE) |  |
| @radix-ui/react-dismissable-layer | 1.1.19 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-dismissable-layer` | [licenses/@radix-ui/react-dismissable-layer/LICENSE](licenses/%40radix-ui/react-dismissable-layer/LICENSE) |  |
| @radix-ui/react-dropdown-menu | 2.1.24 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-dropdown-menu` | [licenses/@radix-ui/react-dropdown-menu/LICENSE](licenses/%40radix-ui/react-dropdown-menu/LICENSE) |  |
| @radix-ui/react-focus-guards | 1.1.6 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-focus-guards` | [licenses/@radix-ui/react-focus-guards/LICENSE](licenses/%40radix-ui/react-focus-guards/LICENSE) |  |
| @radix-ui/react-focus-scope | 1.1.16 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-focus-scope` | [licenses/@radix-ui/react-focus-scope/LICENSE](licenses/%40radix-ui/react-focus-scope/LICENSE) |  |
| @radix-ui/react-form | 0.1.16 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-form` | [licenses/@radix-ui/react-form/LICENSE](licenses/%40radix-ui/react-form/LICENSE) |  |
| @radix-ui/react-hover-card | 1.1.23 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-hover-card` | [licenses/@radix-ui/react-hover-card/LICENSE](licenses/%40radix-ui/react-hover-card/LICENSE) |  |
| @radix-ui/react-id | 1.1.4 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-id` | [licenses/@radix-ui/react-id/LICENSE](licenses/%40radix-ui/react-id/LICENSE) |  |
| @radix-ui/react-label | 2.1.15 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-label` | [licenses/@radix-ui/react-label/LICENSE](licenses/%40radix-ui/react-label/LICENSE) |  |
| @radix-ui/react-menu | 2.1.24 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-menu` | [licenses/@radix-ui/react-menu/LICENSE](licenses/%40radix-ui/react-menu/LICENSE) |  |
| @radix-ui/react-menubar | 1.1.24 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-menubar` | [licenses/@radix-ui/react-menubar/LICENSE](licenses/%40radix-ui/react-menubar/LICENSE) |  |
| @radix-ui/react-navigation-menu | 1.2.22 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-navigation-menu` | [licenses/@radix-ui/react-navigation-menu/LICENSE](licenses/%40radix-ui/react-navigation-menu/LICENSE) |  |
| @radix-ui/react-one-time-password-field | 0.1.16 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-one-time-password-field` | [licenses/@radix-ui/react-one-time-password-field/LICENSE](licenses/%40radix-ui/react-one-time-password-field/LICENSE) |  |
| @radix-ui/react-password-toggle-field | 0.1.11 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-password-toggle-field` | [licenses/@radix-ui/react-password-toggle-field/LICENSE](licenses/%40radix-ui/react-password-toggle-field/LICENSE) |  |
| @radix-ui/react-popover | 1.1.23 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-popover` | [licenses/@radix-ui/react-popover/LICENSE](licenses/%40radix-ui/react-popover/LICENSE) |  |
| @radix-ui/react-popper | 1.3.7 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-popper` | [licenses/@radix-ui/react-popper/LICENSE](licenses/%40radix-ui/react-popper/LICENSE) |  |
| @radix-ui/react-portal | 1.1.17 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-portal` | [licenses/@radix-ui/react-portal/LICENSE](licenses/%40radix-ui/react-portal/LICENSE) |  |
| @radix-ui/react-presence | 1.1.10 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-presence` | [licenses/@radix-ui/react-presence/LICENSE](licenses/%40radix-ui/react-presence/LICENSE) |  |
| @radix-ui/react-primitive | 2.1.10 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-primitive` | [licenses/@radix-ui/react-primitive/LICENSE](licenses/%40radix-ui/react-primitive/LICENSE) |  |
| @radix-ui/react-progress | 1.1.16 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-progress` | [licenses/@radix-ui/react-progress/LICENSE](licenses/%40radix-ui/react-progress/LICENSE) |  |
| @radix-ui/react-radio-group | 1.4.7 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-radio-group` | [licenses/@radix-ui/react-radio-group/LICENSE](licenses/%40radix-ui/react-radio-group/LICENSE) |  |
| @radix-ui/react-roving-focus | 1.1.19 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-roving-focus` | [licenses/@radix-ui/react-roving-focus/LICENSE](licenses/%40radix-ui/react-roving-focus/LICENSE) |  |
| @radix-ui/react-scroll-area | 1.2.18 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-scroll-area` | [licenses/@radix-ui/react-scroll-area/LICENSE](licenses/%40radix-ui/react-scroll-area/LICENSE) |  |
| @radix-ui/react-select | 2.3.7 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-select` | [licenses/@radix-ui/react-select/LICENSE](licenses/%40radix-ui/react-select/LICENSE) |  |
| @radix-ui/react-separator | 1.1.15 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-separator` | [licenses/@radix-ui/react-separator/LICENSE](licenses/%40radix-ui/react-separator/LICENSE) |  |
| @radix-ui/react-slider | 1.4.7 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-slider` | [licenses/@radix-ui/react-slider/LICENSE](licenses/%40radix-ui/react-slider/LICENSE) |  |
| @radix-ui/react-slot | 1.3.3 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-slot` | [licenses/@radix-ui/react-slot/LICENSE](licenses/%40radix-ui/react-slot/LICENSE) |  |
| @radix-ui/react-switch | 1.3.7 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-switch` | [licenses/@radix-ui/react-switch/LICENSE](licenses/%40radix-ui/react-switch/LICENSE) |  |
| @radix-ui/react-tabs | 1.1.21 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-tabs` | [licenses/@radix-ui/react-tabs/LICENSE](licenses/%40radix-ui/react-tabs/LICENSE) |  |
| @radix-ui/react-toast | 1.2.23 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-toast` | [licenses/@radix-ui/react-toast/LICENSE](licenses/%40radix-ui/react-toast/LICENSE) |  |
| @radix-ui/react-toggle | 1.1.18 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-toggle` | [licenses/@radix-ui/react-toggle/LICENSE](licenses/%40radix-ui/react-toggle/LICENSE) |  |
| @radix-ui/react-toggle-group | 1.1.19 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-toggle-group` | [licenses/@radix-ui/react-toggle-group/LICENSE](licenses/%40radix-ui/react-toggle-group/LICENSE) |  |
| @radix-ui/react-toolbar | 1.1.19 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-toolbar` | [licenses/@radix-ui/react-toolbar/LICENSE](licenses/%40radix-ui/react-toolbar/LICENSE) |  |
| @radix-ui/react-tooltip | 1.2.16 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-tooltip` | [licenses/@radix-ui/react-tooltip/LICENSE](licenses/%40radix-ui/react-tooltip/LICENSE) |  |
| @radix-ui/react-use-callback-ref | 1.1.4 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-use-callback-ref` | [licenses/@radix-ui/react-use-callback-ref/LICENSE](licenses/%40radix-ui/react-use-callback-ref/LICENSE) |  |
| @radix-ui/react-use-controllable-state | 1.2.6 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-use-controllable-state` | [licenses/@radix-ui/react-use-controllable-state/LICENSE](licenses/%40radix-ui/react-use-controllable-state/LICENSE) |  |
| @radix-ui/react-use-effect-event | 0.0.5 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-use-effect-event` | [licenses/@radix-ui/react-use-effect-event/LICENSE](licenses/%40radix-ui/react-use-effect-event/LICENSE) |  |
| @radix-ui/react-use-escape-keydown | 1.1.5 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-use-escape-keydown` | [licenses/@radix-ui/react-use-escape-keydown/LICENSE](licenses/%40radix-ui/react-use-escape-keydown/LICENSE) |  |
| @radix-ui/react-use-is-hydrated | 0.1.3 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-use-is-hydrated` | [licenses/@radix-ui/react-use-is-hydrated/LICENSE](licenses/%40radix-ui/react-use-is-hydrated/LICENSE) |  |
| @radix-ui/react-use-layout-effect | 1.1.4 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-use-layout-effect` | [licenses/@radix-ui/react-use-layout-effect/LICENSE](licenses/%40radix-ui/react-use-layout-effect/LICENSE) |  |
| @radix-ui/react-use-previous | 1.1.4 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-use-previous` | [licenses/@radix-ui/react-use-previous/LICENSE](licenses/%40radix-ui/react-use-previous/LICENSE) |  |
| @radix-ui/react-use-rect | 1.1.4 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-use-rect` | [licenses/@radix-ui/react-use-rect/LICENSE](licenses/%40radix-ui/react-use-rect/LICENSE) |  |
| @radix-ui/react-use-size | 1.1.4 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-use-size` | [licenses/@radix-ui/react-use-size/LICENSE](licenses/%40radix-ui/react-use-size/LICENSE) |  |
| @radix-ui/react-visually-hidden | 1.2.11 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/react-visually-hidden` | [licenses/@radix-ui/react-visually-hidden/LICENSE](licenses/%40radix-ui/react-visually-hidden/LICENSE) |  |
| @radix-ui/rect | 1.1.3 | MIT | 锁文件生产依赖 | `node_modules/@radix-ui/rect` | [licenses/@radix-ui/rect/LICENSE](licenses/%40radix-ui/rect/LICENSE) |  |
| @types/react | 19.2.14 | MIT | 锁文件生产依赖 | `node_modules/@types/react` | [licenses/@types/react/LICENSE](licenses/%40types/react/LICENSE) |  |
| @types/react-dom | 19.2.3 | MIT | 锁文件生产依赖 | `node_modules/@types/react-dom` | [licenses/@types/react-dom/LICENSE](licenses/%40types/react-dom/LICENSE) |  |
| aria-hidden | 1.2.6 | MIT | 锁文件生产依赖 | `node_modules/aria-hidden` | [licenses/aria-hidden/LICENSE](licenses/aria-hidden/LICENSE) |  |
| class-variance-authority | 0.7.1 | Apache-2.0 | 锁文件生产依赖 | `node_modules/class-variance-authority` | [licenses/class-variance-authority/LICENSE](licenses/class-variance-authority/LICENSE) |  |
| clsx | 2.1.1 | MIT | 锁文件生产依赖 | `node_modules/clsx` | [licenses/clsx/license](licenses/clsx/license) |  |
| csstype | 3.2.3 | MIT | 锁文件生产依赖 | `node_modules/csstype` | [licenses/csstype/LICENSE](licenses/csstype/LICENSE) |  |
| detect-node-es | 1.1.0 | MIT | 锁文件生产依赖 | `node_modules/detect-node-es` | [licenses/detect-node-es/LICENSE](licenses/detect-node-es/LICENSE) |  |
| fflate | 0.8.3 | MIT | 锁文件生产依赖 | `node_modules/fflate` | [licenses/fflate/LICENSE](licenses/fflate/LICENSE) |  |
| get-nonce | 1.0.1 | MIT | 锁文件生产依赖 | `node_modules/get-nonce` | [licenses/get-nonce/LICENSE](licenses/get-nonce/LICENSE) |  |
| lucide-react | 1.31.0 | ISC | 锁文件生产依赖 | `node_modules/lucide-react` | [licenses/lucide-react/LICENSE](licenses/lucide-react/LICENSE) | 原 LICENSE 还包含部分 Feather 图标的 MIT 许可及署名。 |
| radix-ui | 1.6.7 | MIT | 锁文件生产依赖 | `node_modules/radix-ui` | [licenses/radix-ui/LICENSE](licenses/radix-ui/LICENSE) |  |
| react | 19.2.6 | MIT | 锁文件生产依赖 | `node_modules/react` | [licenses/react/LICENSE](licenses/react/LICENSE) |  |
| react-dom | 19.2.6 | MIT | 锁文件生产依赖 | `node_modules/react-dom` | [licenses/react-dom/LICENSE](licenses/react-dom/LICENSE) |  |
| react-remove-scroll | 2.7.2 | MIT | 锁文件生产依赖 | `node_modules/react-remove-scroll` | [licenses/react-remove-scroll/LICENSE](licenses/react-remove-scroll/LICENSE) |  |
| react-remove-scroll-bar | 2.3.8 | MIT | 锁文件生产依赖 | `node_modules/react-remove-scroll-bar` | [licenses/react-remove-scroll-bar/LICENSE](licenses/react-remove-scroll-bar/LICENSE)<br>[licenses/react-remove-scroll-bar/UPSTREAM-SOURCE.json](licenses/react-remove-scroll-bar/UPSTREAM-SOURCE.json) | 安装包缺正文；补充官方固定提交的原 LICENSE（源码版本 2.3.7），与 v2.3.7 标签相比仅新增 LICENSE。2.3.8 的 npm gitHead 不可访问，未声明取得其精确发布源码；见来源记录。 |
| react-style-singleton | 2.2.3 | MIT | 锁文件生产依赖 | `node_modules/react-style-singleton` | [licenses/react-style-singleton/LICENSE](licenses/react-style-singleton/LICENSE) |  |
| scheduler | 0.27.0 | MIT | 锁文件生产依赖 | `node_modules/scheduler` | [licenses/scheduler/LICENSE](licenses/scheduler/LICENSE) |  |
| tailwind-merge | 3.6.0 | MIT | 锁文件生产依赖 | `node_modules/tailwind-merge` | [licenses/tailwind-merge/LICENSE.md](licenses/tailwind-merge/LICENSE.md) |  |
| tslib | 2.8.1 | 0BSD | 锁文件生产依赖 | `node_modules/tslib` | [licenses/tslib/CopyrightNotice.txt](licenses/tslib/CopyrightNotice.txt)<br>[licenses/tslib/LICENSE.txt](licenses/tslib/LICENSE.txt) |  |
| use-callback-ref | 1.3.3 | MIT | 锁文件生产依赖 | `node_modules/use-callback-ref` | [licenses/use-callback-ref/LICENSE](licenses/use-callback-ref/LICENSE) |  |
| use-sidecar | 1.1.3 | MIT | 锁文件生产依赖 | `node_modules/use-sidecar` | [licenses/use-sidecar/LICENSE](licenses/use-sidecar/LICENSE) |  |
| tailwindcss | 4.2.1 | MIT | 构建时嵌入 CSS | `node_modules/tailwindcss` | [licenses/tailwindcss/LICENSE](licenses/tailwindcss/LICENSE) |  |
| tw-animate-css | 1.4.0 | MIT | 构建时嵌入 CSS | `node_modules/tw-animate-css` | [licenses/tw-animate-css/LICENSE](licenses/tw-animate-css/LICENSE) |  |

## 本地保留的第三方代码

| 文件 | 来源 / 版本 | 许可 | 原始许可文件 |
| --- | --- | --- | --- |
| `src/vendor/shadcn-tailwind-4.13.0.css` | shadcn Tailwind 样式 4.13.0 | MIT | [licenses/local/shadcn-tailwind-4.13.0/LICENSE.md](licenses/local/shadcn-tailwind-4.13.0/LICENSE.md) |

## 官方上游补充与版本对应限制

- react-remove-scroll-bar：安装版本 2.3.8；许可正文取自官方固定提交 [8ca9ba5ea52d](https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE)，该提交的 package.json 为 2.3.7。GitHub 比较确认相对 v2.3.7 仅新增 LICENSE；发布 2.3.8 的 gitHead 不可访问，不能证明取得了该发布快照的许可文件。原文、哈希、npm 完整性信息与限制见 [licenses/react-remove-scroll-bar/UPSTREAM-SOURCE.json](licenses/react-remove-scroll-bar/UPSTREAM-SOURCE.json)。

## 缺失正文

当前收集范围未发现缺失的原始 LICENSE/COPYING 正文文件。

## 复现

先运行 `npm ci`，再运行 `node scripts/collect-licenses.mjs`。脚本检查安装版本与锁文件一致，按每个锁文件包路径保存独立副本，保留嵌套依赖和同名文件的区别。已有本地 shadcn 原许可和上游补充原文/来源记录必须随源码保留；默认使用这些副本并核对原文 SHA-256。

使用 `node scripts/collect-licenses.mjs --fetch-upstream` 可重新下载固定提交的补充原文；脚本核对上游 package.json 版本及预先验证的原文 SHA-256，不使用最新分支或通用许可模板。

Node.js 运行时的许可证与随附第三方声明由本机运行包另外保留，不属于本清单的 npm 包范围。
