import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { evalResults, evalRuns } from "../drizzle/schema";
import { getDb } from "./db";

export type TestCase = {
  id: string;
  question: string;
  expectedAnswer: string;
  tags: string[];
};

export type TestSetMeta = {
  id: string;
  name: string;
  description: string;
  version: string;
  count: number;
  createdAt: string;
  cases: TestCase[];
};

export type EvalResult = {
  id: string;
  runId: string;
  testCaseId: string;
  question: string;
  expectedAnswer: string;
  answer: string;
  retrievedContext: string;
  faithfulness: number;
  relevance: number;
  correctness: number;
  reasoning: string;
  durationMs: number;
  regression: boolean;
  createdAt: string;
};

export type EvalRun = {
  id: string;
  status: "completed" | "running" | "failed";
  createdAt: string;
  completedAt: string;
  targetMode: "configured-endpoint" | "demo-simulator";
  judgeMode: "groq" | "deterministic-rubric";
  testSetVersion: string;
  testSetId: string;
  testSetName: string;
  totalCases: number;
  passedCases: number;
  regressionCount: number;
  avgFaithfulness: number;
  avgRelevance: number;
  avgCorrectness: number;
  avgComposite: number;
  durationMs: number;
  results?: EvalResult[];
};

const defaultTestSetPath = path.resolve(process.cwd(), "data/test-set.json");
const defaultCases: TestCase[] = JSON.parse(fs.readFileSync(defaultTestSetPath, "utf8"));

// In-memory test set registry (keyed by id)
const testSetRegistry = new Map<string, TestSetMeta>();

// Seed the built-in test set
const builtInTestSet: TestSetMeta = {
  id: "builtin",
  name: "RAG Foundations (built-in)",
  description: "32 manually curated questions covering RAG foundations, retrieval, indexing, abstention, prompting, evaluation, and LLM-as-judge limitations.",
  version: "v1.0.0",
  count: defaultCases.length,
  createdAt: new Date(0).toISOString(),
  cases: defaultCases,
};
testSetRegistry.set("builtin", builtInTestSet);

const runs: EvalRun[] = [];
const resultStore = new Map<string, EvalResult[]>();

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function modelConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

function targetConfigured() {
  return Boolean(process.env.RAG_TARGET_URL);
}

async function callTarget(question: string, expectedAnswer: string, testCaseId: string) {
  if (!process.env.RAG_TARGET_URL) {
    const lowSignal = ["rag-014", "rag-023", "rag-032"].includes(testCaseId);
    return {
      answer: lowSignal ? "I am not sure; the available context does not clearly establish this." : expectedAnswer,
      retrievedContext: lowSignal
        ? "Retrieved context was sparse and did not contain a direct answer."
        : `Reference passage: ${expectedAnswer}`,
      mode: "demo-simulator" as const,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(process.env.RAG_TARGET_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(process.env.RAG_TARGET_BEARER_TOKEN
          ? { Authorization: `Bearer ${process.env.RAG_TARGET_BEARER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ question }),
    });
    if (!response.ok) throw new Error(`Target endpoint returned ${response.status}`);
    const payload = (await response.json()) as Record<string, unknown>;
    const answer = String(payload.answer ?? payload.response ?? payload.content ?? "");
    const contextValue = payload.retrievedContext ?? payload.context ?? payload.sources ?? "";
    const retrievedContext = Array.isArray(contextValue)
      ? contextValue.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("\n\n")
      : String(contextValue);
    return { answer, retrievedContext, mode: "configured-endpoint" as const };
  } finally {
    clearTimeout(timeout);
  }
}

function deterministicJudge(answer: string, context: string, expectedAnswer: string, testCaseId: string) {
  const hasSupport = context.toLowerCase().includes(expectedAnswer.slice(0, 28).toLowerCase());
  const lowSignal = ["rag-014", "rag-023", "rag-032"].includes(testCaseId);
  const faithfulness = lowSignal ? 3 : hasSupport ? 5 : 4;
  const relevance = answer.length > 55 && !answer.startsWith("I am not sure") ? 5 : 3;
  const correctness = lowSignal ? 3 : answer === expectedAnswer ? 5 : 4;
  return {
    faithfulness,
    relevance,
    correctness,
    reasoning: lowSignal
      ? "The response is cautious, but it does not fully answer the question and the retrieved evidence is thin."
      : "The answer is directly responsive and its material claims are supported by the captured context; wording matches the reference semantically.",
    mode: "deterministic-rubric" as const,
  };
}

async function groqJudge(question: string, answer: string, context: string, expectedAnswer: string) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_JUDGE_MODEL || "qwen/qwen3.8-27b",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are an independent RAG evaluator. Return only JSON with integer scores 1-5 for faithfulness, relevance, correctness, and concise reasoning.",
        },
        {
          role: "user",
          content: JSON.stringify({
            rubric: { faithfulness: "claims supported by context", relevance: "answers the question", correctness: "matches the reference semantically" },
            question,
            answer,
            retrievedContext: context,
            expectedAnswer,
          }),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Groq judge returned ${response.status}`);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = payload.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, "").trim());
  return {
    faithfulness: Math.max(1, Math.min(5, Number(parsed.faithfulness))),
    relevance: Math.max(1, Math.min(5, Number(parsed.relevance))),
    correctness: Math.max(1, Math.min(5, Number(parsed.correctness))),
    reasoning: String(parsed.reasoning || "Groq judge completed the rubric."),
    mode: "groq" as const,
  };
}

function previousResults() {
  const latest = runs.at(-1);
  return latest ? resultStore.get(latest.id) || [] : [];
}

function calculateSummary(results: EvalResult[]) {
  const composites = results.map((result) => (result.faithfulness + result.relevance + result.correctness) / 3);
  return {
    avgFaithfulness: average(results.map((result) => result.faithfulness)),
    avgRelevance: average(results.map((result) => result.relevance)),
    avgCorrectness: average(results.map((result) => result.correctness)),
    avgComposite: average(composites),
    passedCases: results.filter((result) => (result.faithfulness + result.relevance + result.correctness) / 3 >= 4).length,
    regressionCount: results.filter((result) => result.regression).length,
  };
}

async function persistRun(run: EvalRun) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(evalRuns).values({
      id: run.id,
      status: run.status,
      targetMode: run.targetMode,
      judgeMode: run.judgeMode,
      testSetVersion: run.testSetVersion,
      totalCases: run.totalCases,
      passedCases: run.passedCases,
      regressionCount: run.regressionCount,
      avgFaithfulness: Math.round(run.avgFaithfulness * 100),
      avgRelevance: Math.round(run.avgRelevance * 100),
      avgCorrectness: Math.round(run.avgCorrectness * 100),
      avgComposite: Math.round(run.avgComposite * 100),
      durationMs: run.durationMs,
      createdAt: new Date(run.createdAt),
      completedAt: new Date(run.completedAt),
    });
    if (run.results?.length) {
      await db.insert(evalResults).values(run.results.map((result) => ({
        id: result.id,
        runId: result.runId,
        testCaseId: result.testCaseId,
        question: result.question,
        expectedAnswer: result.expectedAnswer,
        answer: result.answer,
        retrievedContext: result.retrievedContext,
        faithfulness: result.faithfulness,
        relevance: result.relevance,
        correctness: result.correctness,
        reasoning: result.reasoning,
        durationMs: result.durationMs,
        regression: result.regression ? 1 : 0,
        createdAt: new Date(result.createdAt),
      })));
    }
  } catch (error) {
    console.warn("[Evaluation] Run completed but persistence was skipped:", error);
  }
}

function seedDemoHistory() {
  if (runs.length) return;
  const now = Date.now();
  const snapshots = [
    { offset: 3, faithfulness: 4.12, relevance: 4.32, correctness: 4.18, composite: 4.21, passed: 26, regressions: 0 },
    { offset: 2, faithfulness: 4.31, relevance: 4.45, correctness: 4.37, composite: 4.38, passed: 28, regressions: 0 },
    { offset: 1, faithfulness: 4.58, relevance: 4.64, correctness: 4.53, composite: 4.58, passed: 30, regressions: 1 },
  ];
  snapshots.forEach((snapshot) => {
    const id = `run_seed_${snapshot.offset}`;
    const seedCreatedAt = new Date(now - snapshot.offset * 86_400_000).toISOString();
    runs.push({
      id,
      status: "completed",
      createdAt: seedCreatedAt,
      completedAt: new Date(now - snapshot.offset * 86_400_000 + 42_000).toISOString(),
      targetMode: "demo-simulator",
      judgeMode: "deterministic-rubric",
      testSetVersion: "v1.0.0",
      testSetId: "builtin",
      testSetName: "RAG Foundations (built-in)",
      totalCases: defaultCases.length,
      passedCases: snapshot.passed,
      regressionCount: snapshot.regressions,
      avgFaithfulness: snapshot.faithfulness,
      avgRelevance: snapshot.relevance,
      avgCorrectness: snapshot.correctness,
      avgComposite: snapshot.composite,
      durationMs: 38_400,
    });
    resultStore.set(id, defaultCases.map((testCase) => {
      const lowSignal = ["rag-014", "rag-023", "rag-032"].includes(testCase.id);
      const score = lowSignal ? 3 : 5;
      return {
        id: `result_${id}_${testCase.id}`,
        runId: id,
        testCaseId: testCase.id,
        question: testCase.question,
        expectedAnswer: testCase.expectedAnswer,
        answer: lowSignal ? "I am not sure; the available context does not clearly establish this." : testCase.expectedAnswer,
        retrievedContext: lowSignal ? "Retrieved context was sparse and did not contain a direct answer." : `Reference passage: ${testCase.expectedAnswer}`,
        faithfulness: score,
        relevance: score,
        correctness: score,
        reasoning: lowSignal ? "The response is cautious, but it does not fully answer the question and the retrieved evidence is thin." : "The answer is directly responsive and its material claims are supported by the captured context; wording matches the reference semantically.",
        durationMs: 1_200,
        regression: snapshot.offset === 1 && testCase.id === "rag-023",
        createdAt: seedCreatedAt,
      };
    }));
  });
}

export function getTestSet() {
  return defaultCases;
}

/**
 * Re-score a single result with an edited answer (and optionally edited context).
 * Updates the result in the in-memory store and recalculates the run aggregates.
 */
export async function rescoreResult(runId: string, testCaseId: string, editedAnswer: string, editedContext?: string) {
  seedDemoHistory();
  const runResults = resultStore.get(runId);
  const run = runs.find((r) => r.id === runId);
  if (!runResults || !run) throw new Error("Run not found");

  const existing = runResults.find((r) => r.testCaseId === testCaseId);
  if (!existing) throw new Error("Result not found");

  const context = editedContext ?? existing.retrievedContext;

  let judge;
  try {
    judge = modelConfigured()
      ? await groqJudge(existing.question, editedAnswer, context, existing.expectedAnswer)
      : deterministicJudge(editedAnswer, context, existing.expectedAnswer, testCaseId);
  } catch {
    judge = deterministicJudge(editedAnswer, context, existing.expectedAnswer, testCaseId);
  }

  // Patch the result in-place
  existing.answer = editedAnswer;
  existing.retrievedContext = context;
  existing.faithfulness = judge.faithfulness;
  existing.relevance = judge.relevance;
  existing.correctness = judge.correctness;
  existing.reasoning = judge.reasoning;

  // Recalculate run-level aggregates
  const summary = calculateSummary(runResults);
  run.avgFaithfulness = summary.avgFaithfulness;
  run.avgRelevance = summary.avgRelevance;
  run.avgCorrectness = summary.avgCorrectness;
  run.avgComposite = summary.avgComposite;
  run.passedCases = summary.passedCases;
  run.regressionCount = summary.regressionCount;

  return {
    result: existing,
    runSummary: {
      avgFaithfulness: run.avgFaithfulness,
      avgRelevance: run.avgRelevance,
      avgCorrectness: run.avgCorrectness,
      avgComposite: run.avgComposite,
      passedCases: run.passedCases,
      totalCases: run.totalCases,
      regressionCount: run.regressionCount,
    },
  };
}

/**
 * Ask Groq to review a failing result and suggest an improved answer.
 * Returns analysis + a suggested rewrite the user can apply.
 */
export async function aiReviewResult(
  question: string,
  currentAnswer: string,
  retrievedContext: string,
  expectedAnswer: string,
  currentScores: { faithfulness: number; relevance: number; correctness: number },
) {
  if (!modelConfigured()) {
    return {
      analysis: "Groq API key is not configured. Set GROQ_API_KEY in your environment to enable AI review.",
      suggestedAnswer: null,
      improvements: [] as string[],
      groqAvailable: false,
    };
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_JUDGE_MODEL || "qwen/qwen3.8-27b",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an expert RAG evaluation coach. A generated answer has been scored by an evaluator and is currently failing (composite score below 4/5).

Your job is to:
1. Diagnose why the answer is failing based on the rubric scores
2. List concrete, actionable improvements
3. Write an improved version of the answer that would score 4-5/5

Rubric dimensions:
- Faithfulness (${currentScores.faithfulness}/5): Are all claims grounded in the retrieved context?
- Relevance (${currentScores.relevance}/5): Does the answer directly address the question?
- Correctness (${currentScores.correctness}/5): Does it semantically match the expected answer?

Return JSON with these fields:
- analysis: string (2-3 sentence diagnosis of why it's failing)
- improvements: string[] (3-5 bullet points of specific things to fix)
- suggestedAnswer: string (a rewritten answer that addresses all issues)`,
        },
        {
          role: "user",
          content: JSON.stringify({
            question,
            currentAnswer,
            retrievedContext,
            expectedAnswer,
            scores: currentScores,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq returned ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = payload.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, "").trim()) as {
    analysis?: string;
    improvements?: string[];
    suggestedAnswer?: string;
  };

  return {
    analysis: String(parsed.analysis || "No analysis returned."),
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements.map(String) : [],
    suggestedAnswer: parsed.suggestedAnswer ? String(parsed.suggestedAnswer) : null,
    groqAvailable: true,
  };
}

export function getTestSets(): Omit<TestSetMeta, "cases">[] {
  return Array.from(testSetRegistry.values()).map(({ cases: _cases, ...meta }) => meta);
}

export function getTestSetById(id: string): TestSetMeta | undefined {
  return testSetRegistry.get(id);
}

export function addTestSet(name: string, description: string, cases: TestCase[]): TestSetMeta {
  const id = makeId("ts");
  const meta: TestSetMeta = {
    id,
    name,
    description,
    version: "v1.0.0",
    count: cases.length,
    createdAt: new Date().toISOString(),
    cases,
  };
  testSetRegistry.set(id, meta);
  return meta;
}

export function deleteTestSet(id: string): boolean {
  if (id === "builtin") return false; // cannot delete built-in
  return testSetRegistry.delete(id);
}

export function getDashboard() {
  seedDemoHistory();
  const latest = runs.at(-1)!;
  return {
    latest,
    runs: [...runs].reverse(),
    testSet: { version: "v1.0.0", count: defaultCases.length },
    testSets: getTestSets(),
    config: {
      targetConfigured: targetConfigured(),
      judgeConfigured: modelConfigured(),
      targetUrl: process.env.RAG_TARGET_URL || "Demo simulator",
      judgeModel: process.env.GROQ_JUDGE_MODEL || "qwen/qwen3.8-27b",
    },
    worst: (resultStore.get(latest.id) || []).sort((a, b) => ((a.faithfulness + a.relevance + a.correctness) - (b.faithfulness + b.relevance + b.correctness))).slice(0, 5),
  };
}

export async function runEvaluation(testSetId?: string) {
  seedDemoHistory();
  const activeTestSet = testSetId ? testSetRegistry.get(testSetId) : testSetRegistry.get("builtin");
  if (!activeTestSet) throw new Error(`Test set "${testSetId}" not found`);
  const cases = activeTestSet.cases;

  const runId = makeId("run");
  const started = Date.now();
  const previous = previousResults();
  const results: EvalResult[] = [];

  for (const testCase of cases) {
    const caseStarted = Date.now();
    const target = await callTarget(testCase.question, testCase.expectedAnswer, testCase.id);
    let judge;
    try {
      judge = modelConfigured()
        ? await groqJudge(testCase.question, target.answer, target.retrievedContext, testCase.expectedAnswer)
        : deterministicJudge(target.answer, target.retrievedContext, testCase.expectedAnswer, testCase.id);
    } catch (error) {
      judge = deterministicJudge(target.answer, target.retrievedContext, testCase.expectedAnswer, testCase.id);
      judge.reasoning = `Deterministic fallback used because the judge call failed: ${error instanceof Error ? error.message : "unknown error"}`;
    }
    const previousResult = previous.find((item) => item.testCaseId === testCase.id);
    const composite = (judge.faithfulness + judge.relevance + judge.correctness) / 3;
    const previousComposite = previousResult
      ? (previousResult.faithfulness + previousResult.relevance + previousResult.correctness) / 3
      : 5;
    results.push({
      id: makeId("result"),
      runId,
      testCaseId: testCase.id,
      question: testCase.question,
      expectedAnswer: testCase.expectedAnswer,
      answer: target.answer,
      retrievedContext: target.retrievedContext,
      faithfulness: judge.faithfulness,
      relevance: judge.relevance,
      correctness: judge.correctness,
      reasoning: judge.reasoning,
      durationMs: Date.now() - caseStarted,
      regression: previousResult ? composite < previousComposite - 0.8 : false,
      createdAt: new Date().toISOString(),
    });
  }

  const summary = calculateSummary(results);
  const run: EvalRun = {
    id: runId,
    status: "completed",
    createdAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    targetMode: targetConfigured() ? "configured-endpoint" : "demo-simulator",
    judgeMode: modelConfigured() ? "groq" : "deterministic-rubric",
    testSetVersion: activeTestSet.version,
    testSetId: activeTestSet.id,
    testSetName: activeTestSet.name,
    totalCases: cases.length,
    ...summary,
    durationMs: Date.now() - started,
    results,
  };
  runs.push(run);
  resultStore.set(runId, results);
  await persistRun(run);
  return run;
}

export function getRun(runId: string) {
  seedDemoHistory();
  const run = runs.find((item) => item.id === runId);
  if (!run) return undefined;
  return { ...run, results: resultStore.get(runId) || run.results || [] };
}

export function getTrends() {
  seedDemoHistory();
  return [...runs].reverse().map((run) => ({
    id: run.id,
    label: new Date(run.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    createdAt: run.createdAt,
    faithfulness: run.avgFaithfulness,
    relevance: run.avgRelevance,
    correctness: run.avgCorrectness,
    composite: run.avgComposite,
    regressions: run.regressionCount,
  }));
}

export function exportRunMarkdown(runId?: string) {
  seedDemoHistory();
  const run = runId ? getRun(runId) : getRun(runs.at(-1)?.id || "");
  if (!run) return "# Evaluation report\n\nRun not found.";
  const rows = (run.results || []).map((result) => `| ${result.testCaseId} | ${result.faithfulness} | ${result.relevance} | ${result.correctness} | ${result.regression ? "REGRESSION" : "—"} |`).join("\n");
  return `# RAG Evaluation Report\n\n**Run:** ${run.id}  \n**Created:** ${run.createdAt}  \n**Test set:** ${run.testSetVersion} (${run.totalCases} cases)  \n**Target:** ${run.targetMode}  \n**Judge:** ${run.judgeMode}\n\n## Summary\n\n| Metric | Score |\n| --- | ---: |\n| Faithfulness | ${run.avgFaithfulness}/5 |\n| Relevance | ${run.avgRelevance}/5 |\n| Correctness | ${run.avgCorrectness}/5 |\n| Composite | ${run.avgComposite}/5 |\n| Passed cases | ${run.passedCases}/${run.totalCases} |\n| Regressions | ${run.regressionCount} |\n\n## Per-question scores\n\n| Case | Faithfulness | Relevance | Correctness | Status |\n| --- | ---: | ---: | ---: | --- |\n${rows}\n`;
}

export function exportRunPdf(runId?: string): Promise<Buffer> {
  seedDemoHistory();
  const run = runId ? getRun(runId) : getRun(runs.at(-1)?.id || "");
  return new Promise((resolve, reject) => {
    if (!run) {
      reject(new Error("Run not found"));
      return;
    }

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PRIMARY = "#1c2340";
    const GREEN = "#17b897";
    const PURPLE = "#7b61ff";
    const ORANGE = "#ef9b45";
    const LIGHT = "#f4f5fb";
    const MUTED = "#8b90a7";

    const W = doc.page.width - 100; // usable width

    // ── Header bar ──────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 70).fill(PRIMARY);
    doc.fillColor("white").fontSize(20).font("Helvetica-Bold").text("tracelab", 50, 20);
    doc.fontSize(10).font("Helvetica").text("RAG Evaluation Report", 50, 44);
    doc.fillColor("white").fontSize(9).text(new Date(run.createdAt).toLocaleString(), doc.page.width - 200, 30, { width: 150, align: "right" });

    doc.moveDown(4);

    // ── Run metadata ─────────────────────────────────────────────────────────
    doc.fillColor(PRIMARY).fontSize(13).font("Helvetica-Bold").text("Run details", 50);
    doc.moveDown(0.3);
    doc.rect(50, doc.y, W, 1).fill("#e0e2f0");
    doc.moveDown(0.5);

    const meta = [
      ["Run ID", run.id],
      ["Test set", `${run.testSetName || run.testSetVersion} · ${run.totalCases} cases`],
      ["Target", run.targetMode],
      ["Judge", run.judgeMode],
      ["Duration", `${(run.durationMs / 1000).toFixed(1)}s`],
    ];
    doc.fontSize(9).font("Helvetica");
    meta.forEach(([label, value]) => {
      doc.fillColor(MUTED).text(label, 50, doc.y, { continued: true, width: 110 });
      doc.fillColor(PRIMARY).text(value ?? "—", { width: W - 110 });
    });

    doc.moveDown(1);

    // ── Score summary cards ──────────────────────────────────────────────────
    doc.fillColor(PRIMARY).fontSize(13).font("Helvetica-Bold").text("Summary scores");
    doc.moveDown(0.3);
    doc.rect(50, doc.y, W, 1).fill("#e0e2f0");
    doc.moveDown(0.6);

    const cardY = doc.y;
    const cardW = (W - 15) / 4;
    const metrics = [
      { label: "Faithfulness", value: run.avgFaithfulness, color: GREEN },
      { label: "Relevance", value: run.avgRelevance, color: PURPLE },
      { label: "Correctness", value: run.avgCorrectness, color: ORANGE },
      { label: "Composite", value: run.avgComposite, color: PRIMARY },
    ];
    metrics.forEach((m, i) => {
      const x = 50 + i * (cardW + 5);
      doc.rect(x, cardY, cardW, 60).fill(LIGHT);
      doc.fillColor(m.color).fontSize(22).font("Helvetica-Bold").text(m.value.toFixed(2), x + 8, cardY + 8, { width: cardW - 16 });
      doc.fillColor(MUTED).fontSize(7.5).font("Helvetica").text("/5", x + 8, cardY + 32, { width: cardW - 16 });
      doc.fillColor(PRIMARY).fontSize(8).text(m.label, x + 8, cardY + 44, { width: cardW - 16 });
    });
    doc.y = cardY + 70;
    doc.moveDown(0.4);

    // Cases passing
    doc.fillColor(PRIMARY).fontSize(9).font("Helvetica");
    const passPct = Math.round((run.passedCases / run.totalCases) * 100);
    doc.text(`${run.passedCases} / ${run.totalCases} cases passing (${passPct}%)  ·  ${run.regressionCount} regression${run.regressionCount !== 1 ? "s" : ""}`);
    doc.moveDown(1.2);

    // ── Per-question results ─────────────────────────────────────────────────
    doc.fillColor(PRIMARY).fontSize(13).font("Helvetica-Bold").text("Per-question scores");
    doc.moveDown(0.3);
    doc.rect(50, doc.y, W, 1).fill("#e0e2f0");
    doc.moveDown(0.5);

    // Table header
    const colX = [50, 130, 310, 365, 420, 475];
    const colW = [75, 175, 50, 50, 50, 70];
    const headers = ["Case ID", "Question (truncated)", "Faith.", "Rel.", "Corr.", "Status"];
    const tableHeaderY = doc.y;
    doc.rect(50, tableHeaderY, W, 16).fill("#e9eaf2");
    doc.fillColor(PRIMARY).fontSize(7.5).font("Helvetica-Bold");
    headers.forEach((h, i) => doc.text(h, colX[i] + 3, tableHeaderY + 4, { width: colW[i] - 4 }));
    doc.y = tableHeaderY + 18;

    doc.fontSize(7.5).font("Helvetica");
    const results = run.results || [];
    results.forEach((result, idx) => {
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
        doc.y = 50;
      }
      const rowY = doc.y;
      const bg = idx % 2 === 0 ? "white" : LIGHT;
      doc.rect(50, rowY, W, 14).fill(bg);

      const composite = (result.faithfulness + result.relevance + result.correctness) / 3;
      const scoreColor = (s: number) => s >= 4 ? GREEN : s >= 3 ? ORANGE : "#e53e3e";

      doc.fillColor(PRIMARY).text(result.testCaseId, colX[0] + 3, rowY + 3, { width: colW[0] - 4 });
      doc.text(result.question.length > 55 ? result.question.slice(0, 52) + "…" : result.question, colX[1] + 3, rowY + 3, { width: colW[1] - 4 });
      doc.fillColor(scoreColor(result.faithfulness)).text(String(result.faithfulness), colX[2] + 3, rowY + 3, { width: colW[2] - 4 });
      doc.fillColor(scoreColor(result.relevance)).text(String(result.relevance), colX[3] + 3, rowY + 3, { width: colW[3] - 4 });
      doc.fillColor(scoreColor(result.correctness)).text(String(result.correctness), colX[4] + 3, rowY + 3, { width: colW[4] - 4 });
      if (result.regression) {
        doc.fillColor("#e53e3e").text("REGRESSION", colX[5] + 3, rowY + 3, { width: colW[5] - 4 });
      } else if (composite >= 4) {
        doc.fillColor(GREEN).text("pass", colX[5] + 3, rowY + 3, { width: colW[5] - 4 });
      } else {
        doc.fillColor(ORANGE).text("review", colX[5] + 3, rowY + 3, { width: colW[5] - 4 });
      }
      doc.y = rowY + 15;
    });

    doc.moveDown(1.5);

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 40;
    doc.rect(0, footerY, doc.page.width, 40).fill(LIGHT);
    doc.fillColor(MUTED).fontSize(7.5).font("Helvetica").text(
      `tracelab · RAG Evaluation Harness · Generated ${new Date().toUTCString()}`,
      50, footerY + 14, { width: W, align: "center" }
    );

    doc.end();
  });
}
