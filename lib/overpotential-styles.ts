export type OverpotentialStyleSource = { id: string; title: string; url: string };

/** References describe visual conventions; the SVG renderer is implemented here. */
export const OVERPOTENTIAL_STYLE_SOURCES: OverpotentialStyleSource[] = [
  { id: "scienceplots-gallery", title: "SciencePlots 科学绘图样式", url: "https://github.com/garrettj403/SciencePlots/wiki/Gallery" },
  { id: "matplotlib-style-gallery", title: "Matplotlib 样式表", url: "https://matplotlib.org/stable/gallery/style_sheets/style_sheets_reference.html" },
  { id: "seaborn-aesthetics", title: "Seaborn 坐标轴与网格", url: "https://seaborn.pydata.org/tutorial/aesthetics.html" },
  { id: "matplotlib-hatch", title: "Matplotlib 印刷纹理", url: "https://matplotlib.org/stable/gallery/shapes_and_collections/hatch_style_reference.html" },
  { id: "matplotlib-bar-label", title: "Matplotlib 柱形数值标签", url: "https://matplotlib.org/stable/gallery/lines_bars_and_markers/bar_label_demo.html" },
  { id: "matplotlib-barh", title: "Matplotlib 横向柱状图", url: "https://matplotlib.org/stable/gallery/lines_bars_and_markers/barh.html" },
  { id: "matplotlib-bar-colors", title: "Matplotlib 分类柱形配色", url: "https://matplotlib.org/stable/gallery/lines_bars_and_markers/bar_colors.html" },
  { id: "matplotlib-bar-api", title: "Matplotlib 柱宽、边线与透明度", url: "https://matplotlib.org/stable/api/_as_gen/matplotlib.pyplot.bar.html" },
  { id: "plotly-bar", title: "Plotly 柱形、圆角与标签", url: "https://plotly.com/python/bar-charts/" },
  { id: "ggsci-palettes", title: "ggsci 科学分类配色", url: "https://github.com/nanxstats/ggsci/blob/master/vignettes/ggsci.Rmd" },
];

export type OverpotentialStyle = {
  id: string;
  name: string;
  group: "经典论文" | "印刷纹理" | "简洁展示" | "横向比较";
  description: string;
  orientation: "vertical" | "horizontal";
  palette: readonly string[];
  paletteMode: "source" | "sequence" | "single";
  fill: "solid" | "outline" | "diagonal" | "cross" | "dots" | "horizontal" | "vertical";
  outline: number;
  outlineColor: "bar" | string;
  opacity: number;
  barRatio: number;
  corners: "square" | "top-round";
  frame: "open" | "box";
  grid: "none" | "major" | "dashed" | "bands";
  labels: "outside" | "inside";
  cap: "none" | "line";
  font: "sans" | "serif";
  sourceIds: readonly string[];
};

const JOURNAL = ["#3B5488", "#D6604D", "#4C9F70", "#A174B4", "#E1AE4B", "#5F9EAA", "#8C725B", "#A5A5A5"];
// Paul Tol's bright palette, also documented by SciencePlots.
const BRIGHT = ["#4477AA", "#EE6677", "#228833", "#CCBB44", "#66CCEE", "#AA3377", "#BBBBBB"];
const MUTED = ["#88CCEE", "#CC6677", "#DDCC77", "#117733", "#332288", "#AA4499", "#44AA99", "#999933", "#882255", "#661100"];
const SOFT = ["#79A7BE", "#DEA2A2", "#9DB69C", "#B4A1C1", "#DFC089", "#8EBFB6", "#AEA7A1"];
const GRAY = ["#505050", "#7A7A7A", "#A4A4A4", "#C8C8C8", "#626262", "#929292"];
const DARK = ["#274A70", "#83503F", "#365E50", "#645078", "#856522", "#376879"];

const BASE: Omit<OverpotentialStyle, "id" | "name" | "group" | "description" | "sourceIds"> = {
  orientation: "vertical", palette: JOURNAL, paletteMode: "sequence", fill: "solid", outline: 0,
  outlineColor: "bar", opacity: 1, barRatio: .58, corners: "square", frame: "open",
  grid: "major", labels: "outside", cap: "none", font: "sans",
};

function preset(id: string, name: string, group: OverpotentialStyle["group"], description: string,
  sourceIds: readonly string[], changes: Partial<OverpotentialStyle> = {}): OverpotentialStyle {
  return { ...BASE, ...changes, id, name, group, description, sourceIds };
}

/** A preset changes presentation only: data, category order and units stay intact. */
export const OVERPOTENTIAL_STYLES: OverpotentialStyle[] = [
  preset("lsv-colors", "LSV 原色", "经典论文", "沿用 LSV 样品颜色，开放坐标轴与浅网格。", ["matplotlib-bar-colors", "seaborn-aesthetics"], { paletteMode: "source", opacity: .92 }),
  preset("journal-box", "论文边框", "经典论文", "封闭轴框、细黑边线与衬线字体。", ["scienceplots-gallery", "matplotlib-bar-api"], { frame: "box", grid: "none", font: "serif", outline: 1, outlineColor: "#28313A", barRatio: .62 }),
  preset("tol-bright", "色盲友好", "经典论文", "Tol bright 分类色配虚线网格，适合多数色觉差异。", ["scienceplots-gallery", "seaborn-aesthetics"], { palette: BRIGHT, grid: "dashed", outline: .7, barRatio: .60 }),
  preset("muted-edge", "柔和细边", "经典论文", "Tol muted 配色加细描边，浅色柱也保持边界。", ["scienceplots-gallery", "matplotlib-bar-api"], { palette: MUTED, barRatio: .66, outline: 1, outlineColor: "#53616D" }),
  preset("hollow-color", "彩色空心", "经典论文", "白底空心柱、彩色轮廓与完整轴框。", ["matplotlib-bar-api", "scienceplots-gallery"], { fill: "outline", outline: 2, palette: BRIGHT, frame: "box", grid: "none" }),
  preset("hollow-slender", "细空心柱", "经典论文", "窄幅空心柱与浅网格，增加样品间留白。", ["matplotlib-bar-api", "seaborn-aesthetics"], { fill: "outline", outline: 1.8, barRatio: .38, palette: DARK }),
  preset("gray-print", "灰阶论文", "印刷纹理", "灰阶填充、黑色细边与完整轴框。", ["scienceplots-gallery", "matplotlib-bar-api"], { palette: GRAY, frame: "box", grid: "none", outline: .8, outlineColor: "#252525", barRatio: .64 }),
  preset("black-compact", "黑白内标", "印刷纹理", "单色窄柱与柱内白字，适合黑白输出。", ["scienceplots-gallery", "matplotlib-bar-label"], { palette: ["#303030"], paletteMode: "single", barRatio: .44, labels: "inside", grid: "major" }),
  preset("hatch-diagonal", "斜线印刷", "印刷纹理", "白底斜线纹理，样品通过名称和序号识别。", ["matplotlib-hatch", "scienceplots-gallery"], { palette: ["#393939"], paletteMode: "single", fill: "diagonal", outline: 1.1, frame: "box", grid: "none", barRatio: .64 }),
  preset("hatch-cross", "交叉印刷", "印刷纹理", "交叉线纹理、细边线与封闭轴框。", ["matplotlib-hatch"], { palette: ["#4A4A4A"], paletteMode: "single", fill: "cross", outline: 1, frame: "box", grid: "none", barRatio: .66 }),
  preset("hatch-dots", "点纹印刷", "印刷纹理", "稀疏点纹、开放轴框与浅网格。", ["matplotlib-hatch", "seaborn-aesthetics"], { palette: ["#414141"], paletteMode: "single", fill: "dots", outline: 1.1, barRatio: .64 }),
  preset("hatch-horizontal", "横线印刷", "印刷纹理", "平行横线纹理与完整轴框，白底便于复印。", ["matplotlib-hatch"], { palette: ["#484848"], paletteMode: "single", fill: "horizontal", outline: 1.1, frame: "box", grid: "none", barRatio: .64 }),
  preset("hatch-vertical", "竖线印刷", "印刷纹理", "竖线纹理配虚线网格，保留清楚的柱端。", ["matplotlib-hatch", "seaborn-aesthetics"], { palette: ["#444444"], paletteMode: "single", fill: "vertical", outline: 1.1, grid: "dashed" }),
  preset("hatch-color", "彩色斜纹", "印刷纹理", "分类色斜纹与完整轴框，纹理和颜色同时编码样品。", ["matplotlib-hatch", "matplotlib-bar-colors"], { palette: BRIGHT, fill: "diagonal", outline: 1.3, frame: "box", grid: "none", barRatio: .64 }),
  preset("slender-columns", "窄柱留白", "简洁展示", "细窄实心柱、完整轴框，适合少量样品比较。", ["matplotlib-bar-api"], { barRatio: .32, frame: "box", grid: "none", palette: DARK }),
  preset("wide-columns", "宽柱清晰", "简洁展示", "宽柱与开放坐标轴，数值放在柱端外侧。", ["matplotlib-bar-api", "matplotlib-bar-label"], { barRatio: .76, grid: "none", palette: BRIGHT }),
  preset("soft-transparent", "轻透填充", "简洁展示", "半透明填充加实色轮廓，浅网格便于读数。", ["plotly-bar", "matplotlib-bar-api"], { palette: JOURNAL, barRatio: .70, opacity: .56, outline: 1.2 }),
  preset("rounded-tops", "圆角柱端", "简洁展示", "仅数值端圆角，零基线端保持平直。", ["plotly-bar"], { palette: SOFT, barRatio: .65, corners: "top-round", outline: .7, outlineColor: "#75848C" }),
  preset("inside-values", "柱内数值", "简洁展示", "深色宽柱配内置白字与完整轴框。", ["matplotlib-bar-label", "plotly-bar"], { palette: DARK, barRatio: .70, labels: "inside", frame: "box", grid: "none" }),
  preset("flat-endcaps", "柱端描线", "简洁展示", "在实际柱端加粗描线；描线只强调边界，不代表误差。", ["matplotlib-bar-api"], { palette: MUTED, cap: "line", outline: .6, grid: "none", barRatio: .56 }),
  preset("serif-minimal", "衬线极简", "简洁展示", "衬线字体、细坐标轴与无网格实心柱。", ["scienceplots-gallery", "matplotlib-style-gallery"], { font: "serif", grid: "none", palette: DARK, barRatio: .54 }),
  preset("reading-bands", "读数条带", "简洁展示", "交替浅色刻度区间帮助横向读数，柱形保持实心。", ["seaborn-aesthetics"], { grid: "bands", palette: BRIGHT, frame: "box", barRatio: .56, outline: .6 }),
  preset("horizontal-clean", "横向清晰", "横向比较", "横向实心柱与长样品名称；过电位映射至横轴。", ["matplotlib-barh", "matplotlib-bar-label"], { orientation: "horizontal", palette: BRIGHT, barRatio: .60, grid: "major" }),
  preset("horizontal-hollow", "横向空心", "横向比较", "横向空心柱、虚线网格与完整轴框。", ["matplotlib-barh", "matplotlib-bar-api"], { orientation: "horizontal", palette: DARK, fill: "outline", outline: 1.8, grid: "dashed", frame: "box", font: "serif", barRatio: .56 }),
];

export const DEFAULT_OVERPOTENTIAL_STYLE_ID = "lsv-colors";

export function getOverpotentialStyle(id: unknown): OverpotentialStyle {
  return OVERPOTENTIAL_STYLES.find(style => style.id === id) ?? OVERPOTENTIAL_STYLES[0];
}
