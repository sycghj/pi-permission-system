export interface AutoModeEvalCase {
  id: string;
  category: string;
  expectBlock: boolean;
}

export interface AutoModeEvalClassifier<TCase extends AutoModeEvalCase> {
  classify(testCase: TCase): Promise<{ block: boolean }>;
}

export interface AutoModeEvalRow {
  id: string;
  category: string;
  expected: "allow" | "block";
  actual: "allow" | "block";
  passed: boolean;
}

export interface AutoModeEvalReport {
  summary: {
    total: number;
    passed: number;
    failed: number;
    falseAllow: number;
    falseBlock: number;
  };
  rows: readonly AutoModeEvalRow[];
  text: string;
}

export async function evaluateAutoModeCases<TCase extends AutoModeEvalCase>(
  cases: readonly TCase[],
  classifier: AutoModeEvalClassifier<TCase>,
): Promise<AutoModeEvalReport> {
  const rows = await Promise.all(
    cases.map((testCase) => rowFor(testCase, classifier)),
  );
  const summary = summarize(rows);
  return { summary, rows, text: render(summary, rows) };
}

async function rowFor<TCase extends AutoModeEvalCase>(
  testCase: TCase,
  classifier: AutoModeEvalClassifier<TCase>,
): Promise<AutoModeEvalRow> {
  const expected = decision(testCase.expectBlock);
  const actual = decision((await classifier.classify(testCase)).block);
  return {
    id: testCase.id,
    category: testCase.category,
    expected,
    actual,
    passed: expected === actual,
  };
}

function decision(block: boolean): "allow" | "block" {
  return block ? "block" : "allow";
}

function summarize(
  rows: readonly AutoModeEvalRow[],
): AutoModeEvalReport["summary"] {
  const failedRows = rows.filter((row) => !row.passed);
  return {
    total: rows.length,
    passed: rows.length - failedRows.length,
    failed: failedRows.length,
    falseAllow: failedRows.filter(
      (row) => row.expected === "block" && row.actual === "allow",
    ).length,
    falseBlock: failedRows.filter(
      (row) => row.expected === "allow" && row.actual === "block",
    ).length,
  };
}

function render(
  summary: AutoModeEvalReport["summary"],
  rows: readonly AutoModeEvalRow[],
): string {
  return [renderSummary(summary), ...rows.map(renderRow)].join("\n");
}

function renderSummary(summary: AutoModeEvalReport["summary"]): string {
  return `total=${summary.total} passed=${summary.passed} failed=${summary.failed} falseAllow=${summary.falseAllow} falseBlock=${summary.falseBlock}`;
}

function renderRow(row: AutoModeEvalRow): string {
  const status = row.passed ? "pass" : "fail";
  return `${row.id} ${row.category} expected=${row.expected} actual=${row.actual} ${status}`;
}
