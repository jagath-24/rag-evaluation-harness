# RAG Evaluation Harness

A full-stack evaluation harness for a hallucination-aware RAG application. It runs a manually curated 32-case test set, captures generated answers and retrieved evidence, scores each answer on **faithfulness**, **relevance**, and **correctness**, and surfaces regressions across runs.

## What is included

- **Test set:** `data/test-set.json` contains 32 manually written question/reference pairs covering RAG foundations, retrieval, indexing, abstention, prompting, evaluation, and LLM-as-judge limitations.
- **Evaluation runner:** `server/eval.ts` calls a configured target RAG endpoint or uses a deterministic demo simulator when no target URL is configured.
- **LLM-as-judge:** Groq's OpenAI-compatible API is supported through `GROQ_API_KEY` and `GROQ_JUDGE_MODEL`. The judge receives the question, generated answer, retrieved context, and expected answer and returns 1–5 scores with reasoning.
- **Dashboard:** the React overview shows score cards, run history, trend bars, worst-performing questions, regression flags, connectors, and per-result detail.
- **Regression detection:** each new result is compared with the previous run for the same test case. A score drop greater than 0.8 composite points is flagged.
- **Reports:** Markdown export is available from the dashboard or `GET /api/eval/report/:runId`.
- **Persistence:** MySQL tables are defined in `drizzle/schema.ts`; completed runs and result rows are written when `DATABASE_URL` is available.

## Run locally

```bash
pnpm install
pnpm dev
```

The managed project provides the database connection and frontend/runtime variables. No `.env` file is committed.

## Configure the real RAG app

Set the following server-side environment variables in the project runtime:

```bash
RAG_TARGET_URL=https://your-rag-app.example.com/api/ask
RAG_TARGET_BEARER_TOKEN=optional-token
GROQ_API_KEY=gsk_...
GROQ_JUDGE_MODEL=llama-3.3-70b-versatile
```

The target endpoint should accept:

```json
{ "question": "What is RAG?" }
```

and return any of these common shapes:

```json
{ "answer": "...", "retrievedContext": "..." }
```

or:

```json
{ "response": "...", "context": ["passage 1", "passage 2"] }
```

If `RAG_TARGET_URL` is absent, the dashboard remains fully runnable in demo mode. If `GROQ_API_KEY` is absent or a judge request fails, the deterministic rubric keeps the evaluation workflow available while clearly labelling the fallback in the UI and run metadata.

## API contract

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/eval/run` | Run all test cases and return the completed run with per-question results |
| `GET` | `/api/eval/results/:runId` | Fetch one run and its result rows |
| `GET` | `/api/eval/trends` | Return aggregate scores across runs |
| `GET` | `/api/eval/report/:runId` | Download a Markdown report for a run |

The same operations are exposed as typed tRPC procedures under `eval.dashboard`, `eval.results`, `eval.trends`, `eval.run`, and `eval.export` for the React client.

## Database tables

- `eval_test_cases` stores the versioned test set shape.
- `eval_runs` stores immutable run-level configuration and aggregates. Aggregate score columns are stored as integer hundredths to preserve two decimal places without floating-point database drift.
- `eval_results` stores question, answer, retrieved context, three dimension scores, judge reasoning, duration, and regression status.

The migration has been generated and applied to the project database.

## Verification

```bash
pnpm test
pnpm check
pnpm build
```

The test suite covers test-set integrity, bounded scoring, trends, worst-case discovery, and Markdown export. REST smoke tests were run against the live server for run creation, result retrieval, trend retrieval, and report export.

## Evaluation guidance

Treat LLM-as-judge scores as a calibrated signal rather than ground truth. Keep the rubric stable, sample results for human review, and record prompt/retrieval changes alongside each run when comparing before and after configurations.
