import type { Express, Request, Response } from "express";
import { exportRunMarkdown, exportRunPdf, getRun, getTrends, runEvaluation } from "./eval";

export function registerEvalRoutes(app: Express) {
  app.post("/api/eval/run", async (req: Request, res: Response) => {
    try {
      const testSetId = typeof req.body?.testSetId === "string" ? req.body.testSetId : undefined;
      const run = await runEvaluation(testSetId);
      res.json(run);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Evaluation failed" });
    }
  });

  app.get("/api/eval/results/:runId", (req: Request, res: Response) => {
    const run = getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: "Run not found" });
    return res.json(run);
  });

  app.get("/api/eval/trends", (_req: Request, res: Response) => {
    res.json(getTrends());
  });

  // PDF report (primary export)
  app.get("/api/eval/report/:runId", async (req: Request, res: Response) => {
    try {
      const pdf = await exportRunPdf(req.params.runId);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=rag-eval-${req.params.runId}.pdf`);
      res.send(pdf);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "PDF export failed" });
    }
  });

  // Markdown report (kept as /api/eval/report-md/:runId for backward compat)
  app.get("/api/eval/report-md/:runId", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=rag-eval-${req.params.runId}.md`);
    res.send(exportRunMarkdown(req.params.runId));
  });
}
