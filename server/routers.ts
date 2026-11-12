import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  addTestSet,
  aiReviewResult,
  deleteTestSet,
  exportRunMarkdown,
  getDashboard,
  getRun,
  getTestSetById,
  getTestSets,
  getTrends,
  rescoreResult,
  runEvaluation,
  type TestCase,
} from "./eval";

const runInput = z.object({ runId: z.string().optional() });

const testCaseSchema = z.object({
  id: z.string(),
  question: z.string(),
  expectedAnswer: z.string(),
  tags: z.array(z.string()).default([]),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  eval: router({
    dashboard: publicProcedure.query(() => getDashboard()),
    testSet: publicProcedure.query(() => getTestSets()),
    testSetById: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => getTestSetById(input.id)),
    addTestSet: publicProcedure
      .input(
        z.object({
          name: z.string().min(1),
          description: z.string().default(""),
          cases: z.array(testCaseSchema),
        })
      )
      .mutation(({ input }) => addTestSet(input.name, input.description, input.cases as TestCase[])),
    deleteTestSet: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => deleteTestSet(input.id)),
    trends: publicProcedure.query(() => getTrends()),
    results: publicProcedure.input(runInput).query(({ input }) => getRun(input.runId || "")),
    run: publicProcedure
      .input(z.object({ testSetId: z.string().optional() }).optional())
      .mutation(({ input }) => runEvaluation(input?.testSetId)),
    rescore: publicProcedure
      .input(z.object({
        runId: z.string(),
        testCaseId: z.string(),
        editedAnswer: z.string(),
        editedContext: z.string().optional(),
      }))
      .mutation(({ input }) => rescoreResult(input.runId, input.testCaseId, input.editedAnswer, input.editedContext)),
    aiReview: publicProcedure
      .input(z.object({
        question: z.string(),
        currentAnswer: z.string(),
        retrievedContext: z.string(),
        expectedAnswer: z.string(),
        faithfulness: z.number(),
        relevance: z.number(),
        correctness: z.number(),
      }))
      .mutation(({ input }) =>
        aiReviewResult(input.question, input.currentAnswer, input.retrievedContext, input.expectedAnswer, {
          faithfulness: input.faithfulness,
          relevance: input.relevance,
          correctness: input.correctness,
        })
      ),
    export: publicProcedure.input(runInput).query(({ input }) => exportRunMarkdown(input.runId || undefined)),
  }),
});

export type AppRouter = typeof appRouter;
