import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const evalTestCases = mysqlTable("eval_test_cases", {
  id: varchar("id", { length: 64 }).primaryKey(),
  question: text("question").notNull(),
  expectedAnswer: text("expectedAnswer").notNull(),
  tags: text("tags").notNull(),
  version: varchar("version", { length: 32 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const evalRuns = mysqlTable("eval_runs", {
  id: varchar("id", { length: 96 }).primaryKey(),
  status: mysqlEnum("status", ["running", "completed", "failed"]).notNull(),
  targetMode: varchar("targetMode", { length: 64 }).notNull(),
  judgeMode: varchar("judgeMode", { length: 64 }).notNull(),
  testSetVersion: varchar("testSetVersion", { length: 32 }).notNull(),
  totalCases: int("totalCases").notNull(),
  passedCases: int("passedCases").notNull(),
  regressionCount: int("regressionCount").notNull(),
  avgFaithfulness: int("avgFaithfulness").notNull(),
  avgRelevance: int("avgRelevance").notNull(),
  avgCorrectness: int("avgCorrectness").notNull(),
  avgComposite: int("avgComposite").notNull(),
  durationMs: int("durationMs").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export const evalResults = mysqlTable("eval_results", {
  id: varchar("id", { length: 96 }).primaryKey(),
  runId: varchar("runId", { length: 96 }).notNull(),
  testCaseId: varchar("testCaseId", { length: 64 }).notNull(),
  question: text("question").notNull(),
  expectedAnswer: text("expectedAnswer").notNull(),
  answer: text("answer").notNull(),
  retrievedContext: text("retrievedContext").notNull(),
  faithfulness: int("faithfulness").notNull(),
  relevance: int("relevance").notNull(),
  correctness: int("correctness").notNull(),
  reasoning: text("reasoning").notNull(),
  durationMs: int("durationMs").notNull(),
  regression: int("regression").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
