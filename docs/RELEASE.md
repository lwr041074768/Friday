# Electron 桌面发行

当前版本线为 `desktop-v0.5.3`，与旧浏览器独立版 `v1.0.0` 分开。源码分支沿用 `master` 和既有历史，不强制覆盖旧提交或旧发行版。

## 软件内更新

0.3.1 起，使用者可以点击顶部“检查更新”按钮，或“帮助 → 检查更新”。检查由用户主动触发，不在后台定时运行；绘图和导出仍可离线使用。软件从公开 Gitee 发行版中筛选 `desktop-v<版本号>`，按桌面版本号比较，不把浏览器版 `v1.0.0` 当成桌面更新，也不依赖发行版列表顺序。

有新版本时，使用者可直接下载。下载器读取同版 `release-manifest.json`，下载全部分片并逐个核对长度和 SHA256，再合并并核对完整 ZIP。下载完成后选择重启安装；已有导入数据时沿用退出保存提示，可以取消退出、导出数据后再更新。更新不会自动保存尚未导出的绘图数据。

安装在主程序退出后执行：将当前安装目录备份到同级目录，把已核对的新版放到原安装位置，再启动新版。本机 `%APPDATA%/ScientificPlotStudio` 用户设置目录保留，现有快捷方式仍指向原安装路径。

0.3.0 及更早版本没有更新入口，需要手动下载安装一次带更新功能的版本。0.3.1 安装成功后，后续版本可通过软件内更新获取。

## 本机准备

先完成检查、PDF 渲染、许可证收集，再构建和打包：

```powershell
npm ci
npm --prefix desktop ci
node desktop/install-runtime.mjs
npm run desktop:typecheck
npm run desktop:build
npm run desktop:check
npm run desktop:package
```

完整桌面 ZIP 在 `desktop/release/`。其中包含 Electron 运行时、应用资源、原生桥接、离线 PDF、应用 MIT 和第三方许可。不包含网站环境文件、实验原件或 JADE 数据库。

## 发布资产

每次发布须提高 `desktop/package.json` 的桌面版本号，并保持预加载版本一致。新版本使用唯一的 `desktop-v<版本号>` 标签和独立的发行目录；不复用已有标签，不替换已发布版本的附件。前端根目录 `package.json` 的 `1.0.0` 是浏览器版版本号，不用于桌面更新比较。

完成检查并提交源码后，用当前版本对应的桌面 ZIP 准备上传文件，例如：

```powershell
node scripts/prepare-desktop-assets.mjs "desktop/release/Friday-0.5.3-Windows-x64.zip" "release/desktop-v0.5.3"
```

该工具要求工作区已经提交；生成的源码 ZIP 和 `sourceCommit` 对应当前提交。务必传入刚从该提交构建、且版本号一致的桌面 ZIP。完整 ZIP 的文件名统一为 `ScientificPlotStudio-<版本号>-Windows-x64.zip`；上传文件以 `UPLOAD-ASSETS.json` 为准，包含不超过 90,000,000 字节的分片、配套合并工具、源码 ZIP、中文 PDF、`release-manifest.json` 和 `SHA256SUMS.txt`。完整 ZIP 留在发行目录供校验，超过平台附件大小限制时不作为单附件上传。

软件内更新复用 0.3.0 已公开的清单格式，不需要另一套更新服务：顶层含 `product`、`version`、`sourceCommit`、`createdAt`、`tag`；`desktop` 含完整 ZIP 的 `filename`、`size`、`sha256` 和有序 `parts` 数组。每个分片记录 `filename`、`size`、`sha256`，按数组顺序合并。清单版本、标签和文件名中的版本必须一致；远端必须能匿名下载全部对应附件。

分片使用者应下载同版的全部分片、`release-manifest.json`、`Merge-DesktopRelease.ps1` 和 `Merge-DesktopRelease.cmd`，放在一个文件夹，双击 cmd 完成校验与合并，然后解压。脚本不自动安装或启动 exe。

发布时先准备和上传全部二进制分片及配套附件，核对远程提交、附件名称、长度、SHA256 和匿名下载状态，最后才将新发行版公开给使用者。需要保留未公开的准备阶段，避免软件发现版本时附件尚未上传完整。Gitee 仓库中可以同时保留 `v1.0.0` 与各个 `desktop-v...` 发行版。

公开后应使用旧版本的“检查更新”验证发现新版本、下载并校验、取消退出保留数据、再次重启安装及启动新版的完整流程。本机打包或生成发布脚本不等于上传成功；缺少附件或校验不一致的发行版不能作为可用更新。

## 历史入口

旧 `scripts/Publish-Gitee.ps1`、`scripts/package-release.mjs` 及旧桌面服务启动器只承接浏览器独立版 1.0.0，不用于 Electron 桌面发行。它们的固定版本校验和不可覆盖保护应继续保留。
