import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const modules = {};
for (const name of ["xrd-reference-types", "xrd-reference-import", "xrd-reference-compare"]) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/(from\s*["'])\.\/([^"']+)(["'])/g, (_, start, dependency, end) => {
    assert.ok(modules[dependency], `Unexpected dependency ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const { decodeXrdReferenceBytes, previewXrdReferenceText, parseXrdReferenceText } = await import(modules["xrd-reference-import"]);
const { compareXrdReferenceCards, formatXrdReferenceComparisonCsv } = await import(modules["xrd-reference-compare"]);
const bytes = text => new TextEncoder().encode(text);
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const fixture = "PDF# 00-005-0586\nName: Test phase\nFormula: Ni\nWavelength (Å): 1.5406\n2-Theta\td(A)\tI(%)\tk\th\tl\n30.000(2)\t2.9763\t100*\t0\t1\t1\n40.000\t2.2522\t50\t0\t2\t0\n50.000\t1.8227\tbad\t1\t2\t1";
const preview = previewXrdReferenceText(fixture, "jade.txt");
assert.equal(preview.requiresColumnSelection, false);
assert.equal(preview.metadata.cardNumber, "00-005-0586");
assert.equal(preview.metadata.formula, "Ni");
assert.equal(preview.metadata.wavelength, 1.5406);
assert.deepEqual(preview.suggestedMapping.hklColumns, [4, 3, 5], "Miller indices follow h,k,l meanings, not source column order");
const imported = parseXrdReferenceText(fixture, "jade.txt", { mapping: preview.suggestedMapping, wavelength: 1.5406 });
assert.equal(imported.totalRows, 3);
assert.equal(imported.skippedRows, 1);
assert.equal(imported.card.peaks.length, 2);
assert.equal(imported.card.source, "jade");
assert.equal(imported.card.sourceId, "00-005-0586");
assert.equal(imported.card.sourceFile, "jade.txt");
assert.equal(imported.card.peaks[0].hkl, "1 0 1");
assert.equal(imported.card.peaks[0].twoTheta, 30);
assert.equal(imported.card.peaks[0].intensity, 100);
assert.ok(imported.warnings.some(warning => /不确定度/.test(warning)));
assert.ok(imported.warnings.some(warning => /跳过 1 行/.test(warning)));
assert.equal(previewXrdReferenceText("30 100\n40 50", "unknown.txt").suggestedMapping, null, "No magnitude-based guesses for ambiguous headerless columns");
assert.throws(() => parseXrdReferenceText("30 100", "bad.txt", { mapping: { positionColumn: 0, intensityColumn: 0, positionType: "twoTheta" }, wavelength: 1.54 }), /不同的有效列/);
assert.throws(() => parseXrdReferenceText("30 100", "bad.txt", { mapping: { positionColumn: 0, intensityColumn: 9, positionType: "twoTheta" }, wavelength: 1.54 }), /有效列/);
assert.throws(() => parseXrdReferenceText("30 100", "bad.txt", { mapping: { positionColumn: 0, intensityColumn: 1, positionType: "twoTheta" }, wavelength: 0 }), /波长/);
const dFixture = "d(Å),I/Io,hkl\n2.0,50,\"(1 1 1)\"\n1.5,25,\"(2 0 0)\"\n0.01,10,(3 0 0)";
const dPreview = previewXrdReferenceText(dFixture);
assert.equal(dPreview.suggestedMapping.positionType, "d");
const dResult = parseXrdReferenceText(dFixture, "d.txt", { mapping: dPreview.suggestedMapping, wavelength: 1.5406 });
assert.equal(dResult.skippedRows, 1, "Impossible Bragg angle is skipped, never clamped");
assert.equal(dResult.card.peaks[0].d, 2);
near(dResult.card.peaks[0].twoTheta, 2 * Math.asin(1.5406 / 4) * 180 / Math.PI);
assert.equal(dResult.card.peaks[0].hkl, "(1 1 1)");
assert.equal(dResult.card.peaks[1].intensity, 50);
const multi = "Card: 00-001-0001\nName: First\n2theta Intensity\n30 100\n40 50\nCard: 00-001-0002\nName: Second\nd(A) Intensity\n2.5 100\n2.0 80";
assert.equal(previewXrdReferenceText(multi).sections.length, 2);
const second = previewXrdReferenceText(multi, "multi.txt", 1);
assert.equal(second.metadata.cardNumber, "00-001-0002");
assert.equal(second.metadata.name, "Second");
assert.equal(second.suggestedMapping.sectionIndex, 1);
assert.equal(second.suggestedMapping.positionType, "d");
assert.equal(parseXrdReferenceText(multi, "multi.txt", { mapping: second.suggestedMapping, wavelength: 1.5406 }).card.sourceId, "00-001-0002");
const scan = "2theta Intensity\n" + Array.from({ length: 101 }, (_, index) => `${20 + index * 0.02} ${index + 1}`).join("\n");
assert.equal(previewXrdReferenceText(scan).suspectedSpectrum, true);
assert.throws(() => parseXrdReferenceText(scan, "scan.txt", { mapping: previewXrdReferenceText(scan).suggestedMapping, wavelength: 1.5406 }), /连续扫描谱/);
assert.equal(parseXrdReferenceText(scan, "confirmed-peak-list.txt", { mapping: previewXrdReferenceText(scan).suggestedMapping, wavelength: 1.5406, allowSpectrum: true }).card.peaks.length, 101);
assert.equal(decodeXrdReferenceBytes(bytes("\uFEFFName: 中文\n30 100")).encoding, "utf-8");
assert.equal(decodeXrdReferenceBytes(bytes("\uFEFFName: 中文\n30 100")).text, "Name: 中文\n30 100");
const gb = new Uint8Array([...bytes("Name: "), 0xc4, 0xe3, 0xba, 0xc3, ...bytes("\n30 100")]);
assert.equal(decodeXrdReferenceBytes(gb).encoding, "gb18030");
assert.equal(previewXrdReferenceText(decodeXrdReferenceBytes(gb).text).metadata.name, "你好");
const utf16 = Buffer.from("Name: 中文\n30 100", "utf16le");
assert.equal(decodeXrdReferenceBytes(new Uint8Array([0xff, 0xfe, ...utf16])).encoding, "utf-16le");
const bigEndian = Buffer.from(utf16); bigEndian.swap16();
assert.equal(decodeXrdReferenceBytes(new Uint8Array([0xfe, 0xff, ...bigEndian])).text, "Name: 中文\n30 100");
assert.throws(() => decodeXrdReferenceBytes(new Uint8Array([0x41, 0, 0x42])), /控制字符/);
assert.throws(() => decodeXrdReferenceBytes(new Uint8Array(5 * 1024 * 1024 + 1)), /5 MB/);

function card(source, angles, intensities = angles.map(() => 100), wavelength = 1.5406) {
  return { id: source, name: source, source, wavelength, visible: true, color: "#111", warnings: [], peaks: angles.map((angle, index) => ({ twoTheta: angle, d: wavelength / (2 * Math.sin(angle * Math.PI / 360)), intensity: intensities[index] })) };
}
const bounds = { minTwoTheta: 10, maxTwoTheta: 100 };
const global = compareXrdReferenceCards(card("cod", [20, 20.08]), card("jade", [20.05, 20.13]), { ...bounds, toleranceDeg: 0.06 });
assert.equal(global.matches.length, 2, "Global assignment does not sacrifice two pairs for a single closer pair");
near(global.matches[0].deltaTwoTheta, -0.05);
near(global.matches[1].deltaTwoTheta, -0.05);
assert.equal(global.unmatchedCod.length, 0);
assert.equal(global.unmatchedJade.length, 0);
const residual = compareXrdReferenceCards(card("cod", [20, 20.08]), card("jade", [20.05]), { ...bounds, toleranceDeg: 0.1 });
assert.equal(residual.matches.length, 1);
near(residual.matches[0].cod.twoTheta, 20.08, 1e-8);
near(residual.summary.meanAbsDeltaTwoTheta, 0.03);
assert.equal(residual.unmatchedCod.length, 1);
const bounded = compareXrdReferenceCards(card("cod", [15, 30, 50, 150], [1000, 25, 50, 1000]), card("jade", [30, 50], [50, 100]), { minTwoTheta: 20, maxTwoTheta: 60 });
assert.equal(bounded.excludedCodCount, 2);
assert.equal(bounded.summary.codCount, 2);
near(bounded.matches[0].deltaIntensity, 0);
near(bounded.matches[1].deltaIntensity, 0, 1e-8);
const otherLambda = card("jade", [30], [100], 1.5418);
otherLambda.peaks[0].d = card("cod", [30]).peaks[0].d;
const differentWavelength = compareXrdReferenceCards(card("cod", [30]), otherLambda, bounds);
near(differentWavelength.matches[0].deltaTwoTheta, 0);
assert.equal(differentWavelength.intensityComparable, false);
assert.equal(differentWavelength.matches[0].deltaIntensity, null);
assert.equal(differentWavelength.summary.meanAbsDeltaIntensity, null);
assert.ok(differentWavelength.warnings.some(warning => /波长.*不同/.test(warning)));
const unmatched = compareXrdReferenceCards(card("cod", [30, 40]), card("jade", [30.03, 50]), bounds);
assert.equal(unmatched.matches.length, 1);
assert.equal(unmatched.unmatchedCod.length, 1);
assert.equal(unmatched.unmatchedJade.length, 1);
const shiftedBoundaries = compareXrdReferenceCards(card("cod", [20, 40, 60]), card("jade", [20.02, 40.02, 60.02]), { toleranceDeg: 0.1 });
assert.equal(shiftedBoundaries.matches.length, 3, "Default range preserves shifted endpoint peaks");
const shiftedSingle = compareXrdReferenceCards(card("cod", [30]), card("jade", [30.03]), { toleranceDeg: 0.1 });
assert.equal(shiftedSingle.matches.length, 1, "Single-peak cards with a small shift still compare");
assert.throws(() => compareXrdReferenceCards(card("cod", [10, 20]), card("jade", [30, 40]), { minTwoTheta: 15, maxTwoTheta: 25 }), /某张卡没有峰/);
assert.throws(() => compareXrdReferenceCards(card("jade", [30]), card("cod", [30]), bounds), /COD/);
const noPairs = compareXrdReferenceCards(card("cod", [30]), card("jade", [50]), bounds);
assert.equal(noPairs.summary.meanAbsDeltaTwoTheta, null);
assert.equal(noPairs.summary.maxAbsDeltaTwoTheta, null);
const unsafeName = { ...card("cod", [30]), name: "=HYPERLINK(\"example\")" };
const csv = formatXrdReferenceComparisonCsv(compareXrdReferenceCards(unsafeName, card("jade", [30]), bounds), unsafeName, card("jade", [30]));
assert.ok(csv.includes("'=HYPERLINK"), "Spreadsheet formula-like metadata remains text");
assert.ok(csv.includes("Δ2θ(COD−JADE)"));
assert.ok(csv.includes("COD 已排除峰数"));

// Independent exhaustive matching over small random sets validates the DP
// objective against every feasible one-to-one assignment, including crossings.
let seed = 31;
const random = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
function exhaustive(a, b, tolerance) {
  let best = { count: -1, cost: Infinity };
  function visit(index, used, count, cost) {
    if (index === a.length) {
      if (count > best.count || (count === best.count && cost < best.cost)) best = { count, cost };
      return;
    }
    visit(index + 1, used, count, cost);
    for (let j = 0; j < b.length; j++) if (!used.has(j) && Math.abs(a[index] - b[j]) <= tolerance + 1e-10) {
      used.add(j); visit(index + 1, used, count + 1, cost + Math.abs(a[index] - b[j])); used.delete(j);
    }
  }
  visit(0, new Set(), 0, 0); return best;
}
for (let iteration = 0; iteration < 50; iteration++) {
  const a = Array.from({ length: 4 }, () => 30 + random()).sort((x, y) => x - y);
  const b = Array.from({ length: 3 }, () => 30 + random()).sort((x, y) => x - y);
  const tolerance = 0.3, expected = exhaustive(a, b, tolerance);
  const result = compareXrdReferenceCards(card("cod", a), card("jade", b), { ...bounds, toleranceDeg: tolerance });
  assert.equal(result.summary.matchedCount, expected.count);
  near(result.matches.reduce((sum, match) => sum + Math.abs(match.deltaTwoTheta), 0), expected.cost, 1e-8);
}
console.log("XRD reference TXT preview/import, UTF/GB encoding, column/section safeguards, common-wavelength comparison, range normalization, one-to-one optimal matching and CSV checks passed.");
