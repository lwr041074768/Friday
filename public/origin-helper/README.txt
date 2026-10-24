Scientific Plot Studio - Origin 本机助手 v2.6

适用：64 位 Windows，已安装并正常授权的 Origin/OriginPro。
本机 OriginPro 2024 已验证；其他版本需要实际检查其 COM 兼容性。
此助手由科研绘图网站提供，不是 OriginLab 官方软件。

安装一次
1. 解压整个安装包到任意普通文件夹。
2. 双击 install.cmd。无需管理员权限。
3. 回到网页点击“导出至Origin”，选择“已安装 v2.6，导出并打开 Origin”。
   这一步保存安装声明并立即请求导出和打开；没有数据时先保存设置，导入数据后再导出。
4. 以后直接点击“导出至Origin”。网站首次生成当前数据的 .lsvdata 交接文件后会请求打开
   lsv-origin://import/UUID；在浏览器提示中允许打开本机助手。

使用过程
助手会显示导入进度窗口，并按本次 UUID 精确查找 Windows 默认“下载”文件夹，
以及本机 Edge、Chrome 的自定义下载文件夹，不遍历其他文件。
如果文件仍未找到，等待最多 10 秒后将弹出前台文件选择框。
选择刚下载的 .lsvdata 交接文件；兼容旧 .json，文件内部 requestId 必须匹配本次网页请求。
交接文件由助手自动读取，无需手动双击，也无需 CatGo。不修改系统的 JSON 文件关联。
文件内容仍是严格验证的 JSON，专用后缀用于避免手动打开时启动其他软件。
浏览器仍可能每次询问是否打开外部应用，这是浏览器的正常授权流程。
若点击导出后没有弹出打开程序的提示，请点击网页提示中的“打开 Origin”。
该按钮直接使用当前交接文件，不会重新下载。同样可以从“Origin 连接设置”中打开。
当前页面内重复导出相同数据会复用交接文件，不再重复下载；修改数据或确认新的 IR 后，
才会生成新的交接文件。刷新网页后需要重新生成。浏览器请求下载不等于已保存或已导入。
每次允许打开连接程序仍会创建新的 Origin Book，不代表数据会覆盖到上一个 Book。
进度窗口按查找文件、检查数据、打开 Origin、写入和校验数据显示当前步骤。
如果 Origin 的许可或首次启动提示被挡住，可以取消进度窗口的“窗口置顶”。
最小化或关闭进度窗口时，助手会显示并激活本次导入的新 Origin 窗口。
关闭进度窗口不会取消导入；未结束的导入会在后台继续，完成后助手自动退出。
需要取消本次导入时，请使用“停止等待”。已打开的其他 Origin 项目不参与窗口切换。

数据与 Origin
助手仅打开一个独立的新 Origin 窗口并新增 Book，不连接已打开的项目，
不清空、载入或覆盖用户原有 Book，不自动保存到任何现有文件。
全部样品横向放在一个 LSV 工作表中，每组五列：空白标记列，随后为
原始电位、原始电流、网页修正 X、网页修正 Y。
第一组为 A（注释 Sample1→）及 B–E；第二组为 F（注释 Sample2→）及 G–J，依次排列。
标记列不填数据。工作表行数按最长样品保留，较短样品后面的单元格留空。
全部原始行按输入次序保留，修正数据中的空值写为 Origin 的缺失值 --。
各列 Long Name、Units、Comments 包含样品名、来源、IR、面积、公式、
补偿状态、模拟数据标识、扫描显示模式、eta10 和网站备注。
公式仅作为文本备注；Origin 不执行传入公式，X/Y 数值按网站计算结果原样写入。
不按单位或面积再次换算。Y 的数值含义请结合公式、原始单位和备注判断。
导入后自行在 Origin 保存项目；助手退出后新 Origin 窗口继续可用。
助手使用本次新 Origin 的进程、启动时间和窗口句柄核验窗口身份；若同时启动多个
Origin 导致身份无法确定，会保留窗口现状，不尝试控制其他项目。

限制与故障
每次 1 至 10 个样品，总计不超过 500,000 行，交接文件不超过 50 MB。
若本机没有正常注册 Origin COM，先从开始菜单启动并正常使用一次 Origin。
Origin 版本、权限或 COM 注册异常时会显示明确错误，不回退到控制现有项目。
打开 Origin 超过 90 秒，或其他处理阶段超过 120 秒没有进度更新，会停止本次助手
工作进程并保留诊断记录。选择文件期间不计超时。停止不能撤销已发送给 Origin 的操作，
新 Origin 窗口可能仍忙或包含部分 Book；请手动检查。助手不会终止任何 Origin 进程。
进度窗口的“查看日志”可打开本次记录，日志位于助手文件夹的 Logs 中，不记录实验数据行。
在保存目录不同或浏览器未允许外部协议时，再次点击“导出至Origin”重试打开；
随后用文件选择框选择本次交接文件。不要把旧请求文件用于新的 UUID。
若取消了下载或文件已删除，点击导出按钮旁的“Origin 连接设置”，选择“重新生成文件”，
再回到页面导出。恢复操作会生成新的请求 ID，避免读取到损坏的旧文件。
本机助手不安装 Python、不启动 HTTP 服务、不上传实验数据。
安装只复制到 %USERPROFILE%\ScientificPlotStudio\OriginHelper，并写入
当前用户 HKCU\Software\Classes\lsv-origin 自定义协议键。
安装会核对实际用户注册项，避免应用私有目录的更新未被浏览器使用。
v2 安装时从安装包内的固定源代码生成无控制台启动器，不修改 Windows Terminal 设置，
不修改系统脚本策略，不下载或执行额外的远程程序。
系统已有其他程序注册同名协议时，助手拒绝覆盖。

升级
旧助手可直接解压新安装包并双击 install.cmd 更新，无需先卸载。
v2.6 增加本次 Origin 窗口激活，并将关闭进度窗口与停止导入分开。
v2.4 及更早版本不能读取新的 .lsvdata；旧版本均可直接升级到 v2.6 后在网页确认安装。
安装只更新助手和其自有协议，不启动 Origin。当前网页和已有交接文件可继续使用。
安装完成会通知 Windows 更新协议关联。若浏览器仍保留旧启动命令，
先保留原始数据，再关闭并重新打开浏览器。安装后的程序独立于 Codex 运行。

卸载（可逆，不删除实验交接文件或 Origin 项目）
打开 Windows PowerShell，粘贴以下命令；它只删除本助手拥有的协议键：
$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\lsv-origin')
if ($k) { $owned = $k.GetValue('ScientificPlotStudioOwner') -eq 'ScientificPlotStudio/OriginHelper/v1'; $k.Dispose(); if ($owned) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\Classes\lsv-origin') } else { Write-Host '协议不属于本助手，保留。' } }
然后用文件资源管理器手动删除上述 OriginHelper 文件夹即可。

OriginLab 官方 COM 参考
https://docs.originlab.com/com/classes/application/createpage/
https://docs.originlab.com/com/classes/application/putworksheet/
https://docs.originlab.com/com/classes/column/comments/
https://docs.originlab.com/com/arraydataformat/
https://docs.originlab.com/origin-help/number-in-origin/
