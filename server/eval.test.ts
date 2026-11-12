import { describe, expect, it } from "vitest";
import { exportRunMarkdown, getDashboard, getTestSet, getTrends, runEvaluation } from "./eval";

describe("RAG evaluation harness", () => {
  it("ships a manually curated test set with enough coverage", () => {
    const testSet = getTestSet();
    expect(testSet.length).toBeGreaterThanOrEqual(30);
    expect(testSet.every((item) => item.question && item.expectedAnswer && item.tags.length > 0)).toBe(true);
    expect(new Set(testSet.map((item) => item.id)).size).toBe(testSet.length);
  });

  it("runs the deterministic demo evaluator and returns bounded scores", async () => {
    const run = await runEvaluation();
    expect(run.status).toBe("completed");
    expect(run.totalCases).toBe(32);
    expect(run.results).toHaveLength(32);
    expect(run.avgComposite).toBeGreaterThan(3);
    expect(run.results?.every((item) => [item.faithfulness, item.relevance, item.correctness].every((score) => score >= 1 && score <= 5))).toBe(true);
  });

  it("exposes trends, worst cases, and a Markdown report", () => {
    const dashboard = getDashboard();
    const trends = getTrends();
    expect(dashboard.latest.totalCases).toBe(32);
    expect(dashboard.worst.length).toBeGreaterThan(0);
    expect(trends.length).toBeGreaterThanOrEqual(3);
    expect(exportRunMarkdown(dashboard.latest.id)).toContain("# RAG Evaluation Report");
    expect(exportRunMarkdown(dashboard.latest.id)).toContain("| Faithfulness |");
  });
});
