# ZSimpWin 电路模型库与阻抗定义

实现文件：`lib/eis-zsimp-models.ts`。112 个 CDC 表达式按本机 `Cdclist.cdc` 原始顺序迁移，112 个唯一模型、18 种元件，全部进入同一递归阻抗计算与拟合接口。

## 原始资料及可复核来源

资料核对日期：2026-10-22。源资料来自本机安装的 ZSimpWin。

| 资料 | 用途 |
| --- | --- |
| `Cdclist.cdc` | 全部 112 个模型的实际清单 |
| `html/ZSimpHelp.chm` 中 `html/hs990.htm`、`images/Circuit symbols.png` | R/C/L/W/Q/T/O/G 的导纳、参数与单位 |
| 同一 CHM 中 `html/hs1000.htm` | Boukamp CDC 嵌套串并联规则 |
| 同一 CHM 中 `html/hs1020.htm` | 多孔电极、单双层扩散及轴向薄膜模型的物理描述 |
| 同一 CHM 中 `html/hs2450.htm`、`images/ex9, eqn havriliak.png` | H 的 Havriliak–Negami 复电容定义 |
| `ZSimpWin.exe` 元件参数字符串和纯数值函数 | CHM 只给物理描述的扩展元件之精确计算式与参数次序 |

CHM 已通过 Windows `hh.exe -decompile` 读取。原始安装文件全程只读。独立开发 QA 记录包含提取的帮助、纯函数对照与数值报告。应用运行时使用纯 TypeScript 数值代码。

二进制公式的读取入口是 CDC 数值分派 `0x004B484D`，参数串并联转换为 `0x004C266C`。扩展纯数值函数地址如下（PE ImageBase `0x00400000`）：

| 元件 | 函数虚拟地址 |
| --- | --- |
| U | `0x0050173C` |
| V | `0x00501ACC` |
| M | `0x00501D98` |
| N | `0x00502128` |
| X | `0x0050289C` |
| P | `0x00502AB0` |
| B | `0x00502B84` |
| J | `0x00502DB4` |
| I | `0x00503138` |

复数函数包括加 `0x00500D60`、减 `0x00500D90`、乘 `0x00500DC0`、除 `0x00500E38`、倒数 `0x00500F64`、平方根 `0x00500FC0`、实数乘 `0x00501180`、幂 `0x005011B0`、sinh `0x00501358`、coth `0x0050147C`、tanh `0x00501574`。数值恢复时同时核对调用栈的参数次序与 CDC 中的参数预变换。

原厂产品入口：[AMETEK ZSimpWin](https://www.ameteksi.com/products/software/zsimpwin)。原厂演示安装包只解包读取，用于来源交叉检查；本次112模型清单取自本机实际安装库。

## 阻抗与参数约定

所有式子使用 `Z = Z′ + j Z″`，`ω = 2πf`。输入 Nyquist 纵坐标为有符号的 `−Z″`，界面预测输出为 `−Im(Z)`。

下表全部列为**阻抗**。原帮助的标准元件表列为导纳，因此这里统一取倒数。使用原软件 `Y0` 约定：W 的 `Y0` 单位为 `S·s^0.5`；对应常见 σ 写法满足 `σ = 1/Y0`，即 `Z_W = (1−j)/(Y0√(2ω))`。

| 元件 | 参数 | 阻抗 Z(ω) |
| --- | --- | --- |
| R | R [Ω] | `R` |
| C | C [F] | `1/(jωC)` |
| L | L [H] | `jωL` |
| W | Y0 [S·s^0.5] | `1/(Y0√(jω))` |
| Q | Y0 [S·s^n], n | `1/(Y0(jω)^n)` |
| T | Y0 [S·s^0.5], B [s^0.5] | `1/[Y0√(jω)tanh(B√(jω))]` |
| O | Y0 [S·s^0.5], B [s^0.5] | `tanh(B√(jω))/(Y0√(jω))` |
| G | Y0 [S·s^0.5], Ka [s^-1] | `1/[Y0√(Ka+jω)]` |
| H | ΔC [F], τ [s], μ, ψ | `[1+(jωτ)^μ]^ψ/(jωΔC)` |
| P | RW [Ω], ω0 [s^-1] | `RW coth(s)/s`，`s=√(jω/ω0)` |

H 表示弛豫电容部分 `C*(ω)=ΔC[1+(jωτ)^μ]^(-ψ)`；独立并联 C 元件提供高频电容 C∞，因此 `(HC)` 即原帮助所示介电模型。

### U、V、M、N：多孔电极传输线

U/M 参数为 `Xa, Xb, ω0, ω1, K, ω3`；V/N 参数为 `Xa, ω0, ω1, K, ω3`。`Xa/Xb` 是原软件的电阻幅度参数（Ω），`ω0/ω1/ω3` 为角频率（s^-1），`K=k·a/D` 为无量纲参数。

定义：

```text
u = √(jω/ω3)
Fcyl = coth(u)/u
Fsph = 1/[u coth(u) − 1]
F = Fcyl 对应 U/V，Fsph 对应 M/N
h = √{[jω + ω0/(1+K F)]/ω1}

ZU = Xa coth(h)/h + Xb [1 + 2/(h sinh(h))]
ZM = Xa coth(h)/h + Xb [1 + 2/(h sinh(h))]
ZV = Xa tanh(h)/h
ZN = Xa tanh(h)/h
```

U/M 对应金属–膜–溶液的不对称边界；V/N 对应溶液–膜–溶液的对称边界。U/V 使用柱状孔局部扩散，M/N 使用球状孔局部扩散。

### B、I、J：归一化有限扩散

定义 `t=jω/ω0`，`s=√t`。

```text
B: 参数 Y0, ω0, K, n
   F = s coth(s), q = t^n
   ZB = (K q + F)/[Y0(K q F + t)]

J: 参数 Y0, ω0, A, λ
   F = tanh(s)/s
   G = tanh(λs)/(λs)
   ZJ = (A G + F/λ)/[Y0(A t F G + 1/λ)]

I: 参数 Y0, ω0, A, λ
   F = s coth(s)
   G = λs coth(λs)
   ZI = (A F G + λt)/[Y0 t(λF + A G)]
```

`ω0` 为 s^-1；`K/A/λ/n` 为无量纲参数。这三个函数使用 `ω/ω0` 的归一化表达式，式中 `Y0` 的量纲为 S。原软件参数字符串沿用了标准 Warburg 的 `S·s^0.5` 标签；页面按实际归一化计算式标记为 S，数值参数约定与原始函数一致。

### X：薄膜轴向扩散

参数次序为 `Rp, Cdl, n, Rs, L, Xw`，与原软件参数列表一致：

```text
z = Rp/[1+(jω Cdl Rp)^n]
h = √(Rs/z)
ZX = √(Rs z)/L × coth(Xw h)
```

这里 `Cdl` 按原字段标为 F，`ω Cdl Rp` 在指数 n 的内部。`L/Xw` 保留原软件的几何参数定义和 cm 单位，实际含义取决于薄膜尺寸与阻抗归一化方式；拟合结果保存完整几何参数，便于按实验配置复核。

## CDC 解析与 API

CDC 的第0层为串联，第1层为并联，第2层为串联，随括号深度交替。例如 `R(Q(RW))` 为 `R1 + [Q2 || (R3 + W4)]`。所有简单元件按表达式出现顺序全局编号，参数键稳定为 `R1_R`、`Q2_Y0`、`Q2_n` 等。

- `ZSIMP_MODELS`：112项，包含 `value/label/equation/expression/tree/elementCount/parameterCount`。值使用 `zsimp:EXPRESSION`。
- `zsimpModel(kind)`：读取模型元数据及树。
- `zsimpParseExpression(expression)`：按 CDC 交替规则返回元素/串联/并联树。
- `zsimpSpec(kind)`：返回 `parameters`、`transforms` 与 `impedance(params, omega)`。
- `zsimpInitialGuess(kind, points)`：由频率排序、高低频阻抗、弧顶与对数频段分配参数初值。
- `zsimpTotalResistance(kind, params)`：按串并联树解析有限 DC 极限；发散时返回 NaN。

拟合使用正值幅度、时间和频率（log变换），以及 `0<n, μ, ψ≤1`（有界变换）。原软件同时提供手动负号选项；本页面自动模型选择采用上述正值域。

DC 解析包含 `R→R`、`L→0`、`O→B/Y0`、`G→1/(Y0√Ka)`、`J→(1+Aλ)/Y0`、`V/N→Xa`、`X→√(RsRp)coth(Xw√(Rs/Rp))/L`；其余在当前正值参数域发散。串联取和、并联取导纳和再求逆，故模型可能在包含发散元件时仍有有限 DC 极限。

## 数值核验

1. 原清单112项与实现逐项一致、唯一。
2. 每个模型用数据驱动初值计算101个角频率点，覆盖 `10^-8` 至 `10^8 rad/s`，共11312个复数值全部有限。
3. 对81个有限 DC 极限模型，在 `ω=10^-20 rad/s` 对照直接复数计算，全部通过。
4. 将本机原EXE的9个扩展纯数值函数映射到 Unicorn x86 仿真内存，直接调用108组固定随机参数；仿真过程执行纯数学函数，应用程序主入口保持未启动。
5. P/B/I/J/V/N/X 与原函数的复数相对误差最高 `1.41×10^-7`。U/M 的小 h 个案最高 `8.47×10^-4` / `2.87×10^-4`，已定位于原 `sinh` 函数小参数展开。把仿真中的该单个基础函数换成标准双精度 sinh 后，U/M 误差分别降至 `6.69×10^-8` / `6.23×10^-8`；其余原始元件函数及调用顺序保持一致。
6. 页面实现使用双精度复数运算、传输线小参数解析展开和稳定的 csch 指数形式，保留上述完整数学表达式。

公开回归命令：

```powershell
node scripts/verify-eis-auto-fit.mjs
node scripts/verify-eis-circuit.mjs
```

历史原软件对照记录保留在维护者的开发资料中，公开回归使用代码生成的数值数据。

## 文件校验值

| 文件 | SHA-256 |
| --- | --- |
| `Cdclist.cdc` | `081eaf67f0cfd10503a12a96c8a74f9e6b698087f2678393c97ae1a9dcca93d5` |
| `html/ZSimpHelp.chm` | `920f2c0afd1666c33458877d5a58d91b626f634a8da4472fb0246e1345c43e56` |
| `ZSimpWin.exe` | `de9e6aabadb9791e6d1813679c0d2047e0e07cafc6a3ac1c918aa7d8ce031823` |
