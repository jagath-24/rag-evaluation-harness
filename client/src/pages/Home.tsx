import { trpc } from "@/lib/trpc";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileJson,
  FlaskConical,
  Gauge,
  GitCompareArrows,
  Layers3,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type Metric = "faithfulness" | "relevance" | "correctness";
type View = "overview" | "testset" | "regressions";

type Result = {
  testCaseId: string;
  question: string;
  expectedAnswer: string;
  answer: string;
  retrievedContext: string;
  faithfulness: number;
  relevance: number;
  correctness: number;
  reasoning: string;
  regression: boolean;
};

type TestSetMeta = {
  id: string;
  name: string;
  description: string;
  version: string;
  count: number;
  createdAt: string;
};

const metricMeta: Record<Metric, { label: string; color: string; soft: string; icon: typeof ShieldCheck }> = {
  faithfulness: { label: "Faithfulness", color: "#17b897", soft: "bg-[#e2fbf4] text-[#087c67]", icon: ShieldCheck },
  relevance: { label: "Relevance", color: "#7b61ff", soft: "bg-[#efebff] text-[#6444e8]", icon: Gauge },
  correctness: { label: "Correctness", color: "#ef9b45", soft: "bg-[#fff2df] text-[#b4691f]", icon: CheckCircle2 },
};

function Score({ value, compact = false }: { value: number; compact?: boolean }) {
  return (
    <span className={`score-badge ${value >= 4 ? "score-good" : value >= 3 ? "score-mid" : "score-low"} ${compact ? "score-compact" : ""}`}>
      {value.toFixed(1)}
    </span>
  );
}

function MetricCard({ metric, value, delta }: { metric: Metric; value: number; delta?: number }) {
  const meta = metricMeta[metric];
  const Icon = meta.icon;
  const positive = (delta ?? 0) >= 0;
  return (
    <div className="metric-card">
      <div className="metric-card-head">
        <div className={`metric-icon ${meta.soft}`}><Icon size={17} /></div>
        <span className="metric-name">{meta.label}</span>
        {delta !== undefined && (
          <span className={`metric-delta ${positive ? "delta-up" : "delta-down"}`}>
            {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>
      <div className="metric-value">{value.toFixed(2)}<span>/5</span></div>
      <div className="metric-bar"><div style={{ width: `${value * 20}%`, background: meta.color }} /></div>
    </div>
  );
}

function formatDate(value: string | undefined, withTime = false) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", withTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Add / Edit test set dialog
// ─────────────────────────────────────────────────────────────────────────────
function TestSetDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [parseError, setParseError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const addMutation = trpc.eval.addTestSet.useMutation({
    onSuccess: () => {
      toast.success("Test set added");
      onSaved();
      onClose();
      setName(""); setDescription(""); setJsonText(""); setParseError("");
    },
    onError: (e) => toast.error(e.message),
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setJsonText((ev.target?.result as string) || "");
      setParseError("");
    };
    reader.readAsText(file);
  }

  function handleSave() {
    if (!name.trim()) { setParseError("Name is required"); return; }
    let cases: unknown;
    try {
      cases = JSON.parse(jsonText);
    } catch {
      setParseError("Invalid JSON — could not parse");
      return;
    }
    if (!Array.isArray(cases)) { setParseError("JSON must be an array of test cases"); return; }
    for (const c of cases as unknown[]) {
      const item = c as Record<string, unknown>;
      if (!item.id || !item.question || !item.expectedAnswer) {
        setParseError("Each case needs id, question, and expectedAnswer fields");
        return;
      }
    }
    setParseError("");
    addMutation.mutate({ name: name.trim(), description: description.trim(), cases: cases as never });
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Add test set</h2>
          <button className="icon-button" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          <label className="field-label">Name *</label>
          <input className="field-input" placeholder="My custom test set" value={name} onChange={(e) => setName(e.target.value)} />

          <label className="field-label" style={{ marginTop: 12 }}>Description</label>
          <input className="field-input" placeholder="Optional description" value={description} onChange={(e) => setDescription(e.target.value)} />

          <label className="field-label" style={{ marginTop: 12 }}>Test cases (JSON) *</label>
          <p className="field-hint">
            Array of objects with <code>id</code>, <code>question</code>, <code>expectedAnswer</code>, and optionally <code>tags</code>.
          </p>
          <div className="upload-zone" onClick={() => fileRef.current?.click()}>
            <Upload size={20} />
            <span>Click to upload a <strong>.json</strong> file</span>
            <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleFile} />
          </div>
          <textarea
            className="field-textarea"
            rows={6}
            placeholder={'[\n  { "id": "q-001", "question": "...", "expectedAnswer": "...", "tags": [] }\n]'}
            value={jsonText}
            onChange={(e) => { setJsonText(e.target.value); setParseError(""); }}
          />
          {parseError && <p className="field-error">{parseError}</p>}
        </div>

        <div className="modal-foot">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={handleSave} disabled={addMutation.isPending}>
            {addMutation.isPending ? "Saving…" : "Save test set"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Review & Edit drawer  (with Groq AI review)
// ─────────────────────────────────────────────────────────────────────────────
type AiReview = {
  analysis: string;
  improvements: string[];
  suggestedAnswer: string | null;
  groqAvailable: boolean;
};

function ReviewDrawer({
  result,
  runId,
  onClose,
  onRescored,
}: {
  result: Result;
  runId: string;
  onClose: () => void;
  onRescored: (updated: Result) => void;
}) {
  const [editedAnswer, setEditedAnswer] = useState(result.answer);
  const [editedContext, setEditedContext] = useState(result.retrievedContext);
  const [editingAnswer, setEditingAnswer] = useState(false);
  const [editingContext, setEditingContext] = useState(false);
  const [aiReview, setAiReview] = useState<AiReview | null>(null);
  const [localScores, setLocalScores] = useState({
    faithfulness: result.faithfulness,
    relevance: result.relevance,
    correctness: result.correctness,
    reasoning: result.reasoning,
  });

  // Reset when switching to a different result
  useEffect(() => {
    setEditedAnswer(result.answer);
    setEditedContext(result.retrievedContext);
    setLocalScores({ faithfulness: result.faithfulness, relevance: result.relevance, correctness: result.correctness, reasoning: result.reasoning });
    setAiReview(null);
    setEditingAnswer(false);
    setEditingContext(false);
  }, [result.testCaseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rescore = trpc.eval.rescore.useMutation({
    onSuccess: (data) => {
      const r = data.result as Result;
      setLocalScores({ faithfulness: r.faithfulness, relevance: r.relevance, correctness: r.correctness, reasoning: r.reasoning });
      setEditedAnswer(r.answer);
      setEditedContext(r.retrievedContext);
      setEditingAnswer(false);
      setEditingContext(false);
      onRescored(r);
      const composite = (r.faithfulness + r.relevance + r.correctness) / 3;
      if (composite >= 4) toast.success(`Now passing! Composite ${composite.toFixed(2)}/5`);
      else toast(`Re-scored: ${composite.toFixed(2)}/5 — still needs work`);
    },
    onError: (e) => toast.error(e.message),
  });

  const aiReviewMutation = trpc.eval.aiReview.useMutation({
    onSuccess: (data) => setAiReview(data as AiReview),
    onError: (e) => toast.error(`AI review failed: ${e.message}`),
  });

  const composite = (localScores.faithfulness + localScores.relevance + localScores.correctness) / 3;
  const passes = composite >= 4;

  function triggerAiReview() {
    aiReviewMutation.mutate({
      question: result.question,
      currentAnswer: editedAnswer,
      retrievedContext: editedContext,
      expectedAnswer: result.expectedAnswer,
      faithfulness: localScores.faithfulness,
      relevance: localScores.relevance,
      correctness: localScores.correctness,
    });
  }

  function applySuggestion() {
    if (!aiReview?.suggestedAnswer) return;
    setEditedAnswer(aiReview.suggestedAnswer);
    setEditingAnswer(false);
    toast("Suggestion applied — click Re-score to evaluate it");
  }

  return (
    <div className="review-overlay" onClick={onClose}>
      <div className="review-panel" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="review-head">
          <div className="review-head-left">
            <span className="review-case-id">{result.testCaseId}</span>
            <span className={`review-pass-chip ${passes ? "pass" : "fail"}`}>
              {passes ? <CheckCircle2 size={12} /> : <TriangleAlert size={12} />}
              {passes ? "Passing" : "Failing"}
            </span>
            {result.regression && <span className="regression-badge">REGRESSION</span>}
          </div>
          <button className="icon-button" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="review-body">

          {/* ── Question ── */}
          <div className="review-section">
            <span className="review-section-label">Question</span>
            <p className="review-question">{result.question}</p>
          </div>

          {/* ── Scores ── */}
          <div className="review-scores-row">
            {(["faithfulness", "relevance", "correctness"] as const).map((m) => {
              const v = localScores[m];
              return (
                <div className="review-score-card" key={m}>
                  <span className="review-score-label">{m.charAt(0).toUpperCase() + m.slice(1)}</span>
                  <span className={`review-score-value ${v >= 4 ? "good" : v >= 3 ? "mid" : "low"}`}>{v}<span>/5</span></span>
                  <div className="review-score-bar">
                    <div style={{ width: `${v * 20}%`, background: m === "faithfulness" ? "#17b897" : m === "relevance" ? "#7b61ff" : "#ef9b45" }} />
                  </div>
                </div>
              );
            })}
            <div className="review-score-card composite">
              <span className="review-score-label">Composite</span>
              <span className={`review-score-value ${composite >= 4 ? "good" : composite >= 3 ? "mid" : "low"}`}>
                {composite.toFixed(2)}<span>/5</span>
              </span>
              <div className="review-score-bar">
                <div style={{ width: `${composite * 20}%`, background: "#1c2340" }} />
              </div>
            </div>
          </div>

          {/* ── Groq AI Review ── */}
          {!aiReview && (
            <div className="ai-review-cta">
              <div className="ai-review-cta-left">
                <Bot size={18} />
                <div>
                  <strong>Ask Groq to review this answer</strong>
                  <span>Get an AI diagnosis and a suggested rewrite that targets a passing score.</span>
                </div>
              </div>
              <button
                className="primary-button"
                disabled={aiReviewMutation.isPending}
                onClick={triggerAiReview}
              >
                {aiReviewMutation.isPending
                  ? <><RefreshCw size={14} className="spin" /> Analyzing…</>
                  : <><Bot size={14} /> AI Review</>}
              </button>
            </div>
          )}

          {aiReview && (
            <div className="ai-review-box">
              <div className="ai-review-box-head">
                <Bot size={15} />
                <strong>Groq AI review</strong>
                {!aiReview.groqAvailable && <span className="ai-unavail-badge">API key not configured</span>}
                <button className="icon-button sm" onClick={() => setAiReview(null)} title="Dismiss"><X size={12} /></button>
              </div>

              <p className="ai-analysis">{aiReview.analysis}</p>

              {aiReview.improvements.length > 0 && (
                <ul className="ai-improvements">
                  {aiReview.improvements.map((imp, i) => <li key={i}>{imp}</li>)}
                </ul>
              )}

              {aiReview.suggestedAnswer && (
                <div className="ai-suggestion">
                  <div className="ai-suggestion-head">
                    <span className="review-section-label">Suggested rewrite</span>
                    <button className="edit-pill green" onClick={applySuggestion}>
                      <Pencil size={11} /> Apply to editor
                    </button>
                  </div>
                  <p className="ai-suggestion-text">{aiReview.suggestedAnswer}</p>
                </div>
              )}

              <button className="ai-rerun-link" onClick={() => { setAiReview(null); triggerAiReview(); }}>
                <RefreshCw size={11} /> Re-run AI review
              </button>
            </div>
          )}

          {/* ── Expected answer ── */}
          <div className="review-section">
            <span className="review-section-label">Expected answer <span className="review-label-hint">(reference)</span></span>
            <p className="review-expected">{result.expectedAnswer}</p>
          </div>

          {/* ── Generated answer — editable ── */}
          <div className="review-section">
            <div className="review-section-head">
              <span className="review-section-label">Generated answer</span>
              {!editingAnswer && (
                <button className="edit-pill" onClick={() => setEditingAnswer(true)}>
                  <Pencil size={11} /> Edit
                </button>
              )}
            </div>
            {editingAnswer ? (
              <textarea
                className="review-textarea"
                rows={5}
                value={editedAnswer}
                onChange={(e) => setEditedAnswer(e.target.value)}
                autoFocus
              />
            ) : (
              <p className={`review-text ${editedAnswer !== result.answer ? "review-text-edited" : ""}`}>
                {editedAnswer}
              </p>
            )}
          </div>

          {/* ── Retrieved context — editable ── */}
          <div className="review-section">
            <div className="review-section-head">
              <span className="review-section-label">Retrieved context</span>
              {!editingContext && (
                <button className="edit-pill" onClick={() => setEditingContext(true)}>
                  <Pencil size={11} /> Edit
                </button>
              )}
            </div>
            {editingContext ? (
              <textarea
                className="review-textarea"
                rows={4}
                value={editedContext}
                onChange={(e) => setEditedContext(e.target.value)}
                autoFocus
              />
            ) : (
              <p className={`review-text ${editedContext !== result.retrievedContext ? "review-text-edited" : ""}`}>
                {editedContext}
              </p>
            )}
          </div>

          {/* ── Judge reasoning ── */}
          <div className="review-section">
            <span className="review-section-label">Judge reasoning</span>
            <p className="review-reasoning">{localScores.reasoning}</p>
          </div>

        </div>

        {/* ── Footer ── */}
        <div className="review-foot">
          <span className="review-foot-hint">
            {editedAnswer !== result.answer || editedContext !== result.retrievedContext
              ? "Edits pending — click Re-score to apply."
              : passes ? "This case is passing ✓" : "Edit the answer or apply the AI suggestion, then re-score."}
          </span>
          <div className="review-foot-actions">
            {(editingAnswer || editingContext) && (
              <button className="secondary-button" onClick={() => {
                setEditingAnswer(false); setEditingContext(false);
                setEditedAnswer(result.answer); setEditedContext(result.retrievedContext);
              }}>Discard edits</button>
            )}
            <button
              className="primary-button"
              disabled={rescore.isPending}
              onClick={() => rescore.mutate({ runId, testCaseId: result.testCaseId, editedAnswer, editedContext })}
            >
              {rescore.isPending
                ? <><RefreshCw size={14} className="spin" /> Scoring…</>
                : <><RefreshCw size={14} /> Re-score</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  const dashboard = trpc.eval.dashboard.useQuery();
  const trends = trpc.eval.trends.useQuery();
  const testSetsQuery = trpc.eval.testSet.useQuery();

  const [view, setView] = useState<View>("overview");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [reviewResult, setReviewResult] = useState<Result | null>(null);
  const [selectedTestSetId, setSelectedTestSetId] = useState("builtin");
  const [showAddTestSet, setShowAddTestSet] = useState(false);

  const deleteTestSet = trpc.eval.deleteTestSet.useMutation({
    onSuccess: () => { toast.success("Test set deleted"); void testSetsQuery.refetch(); void dashboard.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const runMutation = trpc.eval.run.useMutation({
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      setReviewResult(null);
      void dashboard.refetch();
      void trends.refetch();
      toast.success(`Evaluation complete · ${run.passedCases}/${run.totalCases} cases passed`);
    },
    onError: (error) => toast.error(error.message || "Evaluation failed"),
  });

  const latest = dashboard.data?.latest;
  const activeRunId = selectedRunId || latest?.id || "";
  const resultsQuery = trpc.eval.results.useQuery({ runId: activeRunId }, { enabled: Boolean(activeRunId) });
  const results = (resultsQuery.data?.results || []) as Result[];
  const worst = (dashboard.data?.worst || []) as Result[];
  const trendRows = trends.data || [];
  const previous = dashboard.data?.runs?.[1];
  const testSets: TestSetMeta[] = (testSetsQuery.data || dashboard.data?.testSets || []) as TestSetMeta[];

  useEffect(() => {
    if (!selectedRunId && latest?.id) setSelectedRunId(latest.id);
  }, [latest?.id, selectedRunId]);

  const trendMax = useMemo(() => Math.max(5, ...trendRows.map((item) => item.composite)), [trendRows]);
  const delta = (metric: Metric) => {
    if (!latest || !previous) return undefined;
    const key = metric === "faithfulness" ? "avgFaithfulness" : metric === "relevance" ? "avgRelevance" : "avgCorrectness";
    return (latest as unknown as Record<string, number>)[key] - (previous as unknown as Record<string, number>)[key];
  };

  const handleRun = () => {
    if (runMutation.isPending) return;
    runMutation.mutate({ testSetId: selectedTestSetId === "builtin" ? undefined : selectedTestSetId });
  };

  const regressionResults = results.filter((r) => r.regression);

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const sidebar = (
    <aside className="app-sidebar">
      <div className="brand-lockup">
        <div className="brand-mark"><Sparkles size={18} /></div>
        <div>
          <div className="brand-name">trace<span>lab</span></div>
          <div className="brand-caption">RAG quality control</div>
        </div>
      </div>

      <div className="sidebar-section-label">Workspace</div>
      <nav className="side-nav">
        <button className={`side-nav-item ${view === "overview" ? "active" : ""}`} onClick={() => setView("overview")}>
          <Activity size={16} /><span>Overview</span>
          {view === "overview" && <span className="nav-pulse" />}
        </button>
        <button className={`side-nav-item ${view === "testset" ? "active" : ""}`} onClick={() => setView("testset")}>
          <FlaskConical size={16} /><span>Test set</span>
          <span className="nav-count">{testSets.reduce((s, t) => s + t.count, 0) || dashboard.data?.testSet.count || 32}</span>
        </button>
        <button className={`side-nav-item ${view === "regressions" ? "active" : ""}`} onClick={() => setView("regressions")}>
          <GitCompareArrows size={16} /><span>Regressions</span>
          <span className={`nav-count ${latest?.regressionCount ? "danger" : ""}`}>{latest?.regressionCount || 0}</span>
        </button>
      </nav>

      <div className="sidebar-section-label">Connectors</div>
      <div className="connector-card">
        <div className="connector-icon"><TerminalSquare size={15} /></div>
        <div className="connector-copy">
          <strong>{dashboard.data?.config.targetConfigured ? "RAG endpoint" : "Demo simulator"}</strong>
          <span>{dashboard.data?.config.targetConfigured ? dashboard.data.config.targetUrl : "Ready to run"}</span>
        </div>
        <span className="status-dot" />
      </div>
      <div className="connector-card">
        <div className="connector-icon judge"><Bot size={15} /></div>
        <div className="connector-copy">
          <strong>{dashboard.data?.config.judgeConfigured ? "Groq judge" : "Rubric fallback"}</strong>
          <span>{dashboard.data?.config.judgeModel}</span>
        </div>
        <span className="status-dot" />
      </div>

      <div className="sidebar-foot">
        <div className="mini-avatar">AR</div>
        <div><strong>Alex Rivera</strong><span>Evaluation engineer</span></div>
      </div>
    </aside>
  );

  // ── Topbar ─────────────────────────────────────────────────────────────────
  const viewLabel = view === "overview" ? "Evaluation overview" : view === "testset" ? "Test sets" : "Regressions";
  const topbar = (
    <header className="topbar">
      <div className="breadcrumb">
        <span>Workspace</span>
        <ChevronRight size={14} />
        <strong>{viewLabel}</strong>
      </div>
      <div className="topbar-actions">
        <span className="live-chip"><span className="live-dot" /> Live workspace</span>
        <button className="icon-button" title="Refresh" onClick={() => { void dashboard.refetch(); void trends.refetch(); void testSetsQuery.refetch(); }}>
          <RotateCcw size={16} />
        </button>
        <button className="avatar-button">AR</button>
      </div>
    </header>
  );

  // ── Test set selector (shown above Run button on overview) ─────────────────
  const testSetSelector = (
    <div className="testset-selector">
      <label className="field-label" style={{ marginBottom: 4 }}>Test set to run</label>
      <select
        className="field-select"
        value={selectedTestSetId}
        onChange={(e) => setSelectedTestSetId(e.target.value)}
      >
        {testSets.map((ts) => (
          <option key={ts.id} value={ts.id}>{ts.name} ({ts.count} cases)</option>
        ))}
        {testSets.length === 0 && <option value="builtin">RAG Foundations (built-in) (32 cases)</option>}
      </select>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // VIEW: Overview
  // ════════════════════════════════════════════════════════════════════════════
  const overviewContent = (
    <div className="content-wrap">
      <section className="hero-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> RAG evaluation harness</div>
          <h1>Does your RAG app<br /><em>deserve your trust?</em></h1>
          <p className="hero-copy">Run a repeatable, evidence-first evaluation suite against your retrieval and generation stack.</p>
        </div>
        <div className="hero-actions">
          {testSetSelector}
          <div className="hero-buttons">
            <button
              className="secondary-button"
              onClick={() => window.open(activeRunId ? `/api/eval/report/${activeRunId}` : "/api/eval/report/run_seed_1", "_blank")}
            >
              <Download size={16} /> Export PDF
            </button>
            <button className="primary-button" onClick={handleRun} disabled={runMutation.isPending}>
              <Play size={16} fill="currentColor" />
              {runMutation.isPending ? "Running…" : "Run evaluation"}
            </button>
          </div>
        </div>
      </section>

      <section className="status-strip">
        <div className="status-main">
          <div className="status-check"><CheckCircle2 size={19} /></div>
          <div>
            <strong>{latest?.passedCases || 0}/{latest?.totalCases || 32} cases passing</strong>
            <span>Latest run · {formatDate(latest?.createdAt, true)} · {latest?.durationMs ? `${(latest.durationMs / 1000).toFixed(1)}s` : "—"}</span>
          </div>
        </div>
        <div className="status-divider" />
        <div className="status-detail">
          <span className="detail-label">Test set</span>
          <strong>{latest?.testSetName || dashboard.data?.testSet.version || "v1.0.0"}</strong>
          <span className="detail-muted">{latest?.totalCases || dashboard.data?.testSet.count || 32} cases</span>
        </div>
        <div className="status-divider" />
        <div className="status-detail">
          <span className="detail-label">Run health</span>
          <strong className="health-text">Stable</strong>
          <span className="detail-muted">No critical failures</span>
        </div>
        <div className="status-divider" />
        <div className="status-detail">
          <span className="detail-label">Regressions</span>
          <strong className={latest?.regressionCount ? "warning-text" : "health-text"}>{latest?.regressionCount || 0}</strong>
          <span className="detail-muted">vs previous run</span>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard metric="faithfulness" value={latest?.avgFaithfulness || 0} delta={delta("faithfulness")} />
        <MetricCard metric="relevance" value={latest?.avgRelevance || 0} delta={delta("relevance")} />
        <MetricCard metric="correctness" value={latest?.avgCorrectness || 0} delta={delta("correctness")} />
        <div className="composite-card">
          <div className="composite-ring" style={{ background: `conic-gradient(#1c2340 ${(latest?.avgComposite || 0) * 20}%, #e9eaf2 0)` }}>
            <div>{(latest?.avgComposite || 0).toFixed(2)}<span>/5</span></div>
          </div>
          <div>
            <span className="metric-name">Composite score</span>
            <strong>{latest?.avgComposite && latest.avgComposite >= 4.5 ? "Excellent" : "On track"}</strong>
            <small>Target ≥ 4.00</small>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="panel trend-panel">
          <div className="panel-heading">
            <div>
              <h2>Score trend</h2>
              <p>Quality across recent evaluation runs</p>
            </div>
            <div className="legend">
              <span><i style={{ background: "#1c2340" }} /> Composite</span>
              <span><i style={{ background: "#17b897" }} /> Faithfulness</span>
            </div>
          </div>
          <div className="trend-chart">
            <div className="y-axis"><span>5.0</span><span>4.0</span><span>3.0</span><span>2.0</span><span>1.0</span></div>
            <div className="chart-area">
              <div className="grid-lines"><i /><i /><i /><i /><i /></div>
              <div className="trend-columns">
                {trendRows.map((item) => (
                  <div className="trend-column" key={item.id}>
                    <div className="bar-stack" title={`${item.label}: ${item.composite}`}>
                      <div className="trend-bar faith" style={{ height: `${(item.faithfulness / trendMax) * 100}%` }} />
                      <div className="trend-bar composite" style={{ height: `${(item.composite / trendMax) * 100}%` }} />
                    </div>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="trend-callout">
            <TrendingUp size={15} />
            <span>
              <strong>+{previous && latest ? ((latest as unknown as Record<string, number>).avgComposite - (previous as unknown as Record<string, number>).avgComposite).toFixed(2) : "0.00"}</strong> composite improvement from the previous run
            </span>
            <span className="callout-tag">TUNING SIGNAL</span>
          </div>
        </div>

        <div className="panel run-panel">
          <div className="panel-heading">
            <div><h2>Run history</h2><p>Immutable evaluation snapshots</p></div>
            <button className="text-button" onClick={() => setView("regressions")}>View regressions <ChevronRight size={14} /></button>
          </div>
          <div className="run-list">
            {(dashboard.data?.runs || []).slice(0, 4).map((run, index) => (
              <button
                className={`run-row ${(run as Record<string, unknown>).id === activeRunId ? "selected" : ""}`}
                key={(run as Record<string, unknown>).id as string}
                onClick={() => { setSelectedRunId((run as Record<string, unknown>).id as string); setReviewResult(null); }}
              >
                <div className={`run-status ${index === 0 ? "latest" : ""}`}><CheckCircle2 size={14} /></div>
                <div className="run-info">
                  <strong>{index === 0 ? "Latest run" : `Baseline ${4 - index}`}</strong>
                  <span>
                    {formatDate((run as Record<string, unknown>).createdAt as string, true)} ·{" "}
                    {(run as Record<string, unknown>).judgeMode === "groq" ? "Groq judge" : "Demo rubric"}
                    {(run as Record<string, unknown>).testSetName ? ` · ${(run as Record<string, unknown>).testSetName}` : ""}
                  </span>
                </div>
                <div className="run-score">
                  <strong>{((run as unknown as Record<string, number>).avgComposite).toFixed(2)}</strong>
                  <span>composite</span>
                </div>
                <ChevronRight size={15} className="run-chevron" />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel worst-panel">
          <div className="panel-heading">
            <div><h2>Worst-performing questions</h2><p>The first places to look when tuning retrieval</p></div>
            <span className="alert-count"><TriangleAlert size={14} /> {worst.length || 0} to inspect</span>
          </div>
          <div className="question-list">
            {(worst.length ? worst : results.slice().sort((a, b) => (a.faithfulness + a.relevance + a.correctness) - (b.faithfulness + b.relevance + b.correctness)).slice(0, 5))
              .map((item) => {
                const composite = (item.faithfulness + item.relevance + item.correctness) / 3;
                return (
                  <button className="question-row" key={item.testCaseId} onClick={() => setReviewResult(item)}>
                    <div className="question-id">{item.testCaseId.replace("rag-", "#")}</div>
                    <div className="question-copy">
                      <strong>{item.question}</strong>
                      <span>{item.regression ? "Score dropped since previous run" : item.reasoning}</span>
                    </div>
                    <div className="question-score"><Score value={composite} compact /><ChevronRight size={14} /></div>
                  </button>
                );
              })}
          </div>
        </div>

        <div className="panel config-panel">
          <div className="panel-heading">
            <div><h2>Evaluation recipe</h2><p>What this harness scores</p></div>
            <CircleHelp size={17} className="muted-icon" />
          </div>
          <div className="recipe-row">
            <div className="recipe-icon green"><ShieldCheck size={16} /></div>
            <div><strong>Faithfulness</strong><span>Claims grounded in retrieved context</span></div>
            <span className="recipe-weight">40%</span>
          </div>
          <div className="recipe-row">
            <div className="recipe-icon purple"><Zap size={16} /></div>
            <div><strong>Relevance</strong><span>Directly answers the user question</span></div>
            <span className="recipe-weight">30%</span>
          </div>
          <div className="recipe-row">
            <div className="recipe-icon orange"><CheckCircle2 size={16} /></div>
            <div><strong>Correctness</strong><span>Semantically matches reference answer</span></div>
            <span className="recipe-weight">30%</span>
          </div>
          <div className="config-foot">
            <Layers3 size={15} />
            <span>{testSets.reduce((s, t) => s + t.count, 0) || 32} total cases across {testSets.length || 1} test set{testSets.length !== 1 ? "s" : ""}</span>
            <button className="text-button-sm" onClick={() => setView("testset")}><ChevronRight size={14} /></button>
          </div>
        </div>
      </section>

    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // VIEW: Test sets
  // ════════════════════════════════════════════════════════════════════════════
  const testSetContent = (
    <div className="content-wrap">
      <section className="hero-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> Test sets</div>
          <h1>Manage your<br /><em>evaluation sets</em></h1>
          <p className="hero-copy">Upload custom test cases and choose which set to run each evaluation against.</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => setShowAddTestSet(true)}>
            <Plus size={16} /> Add test set
          </button>
        </div>
      </section>

      <div className="testset-grid">
        {testSets.map((ts) => (
          <div className={`testset-card ${selectedTestSetId === ts.id ? "selected" : ""}`} key={ts.id}>
            <div className="testset-card-head">
              <div className="testset-icon"><FileJson size={18} /></div>
              <div className="testset-meta">
                <strong>{ts.name}</strong>
                <span>{ts.count} cases · {ts.version}</span>
              </div>
              {ts.id === "builtin" && <span className="builtin-badge">built-in</span>}
            </div>
            {ts.description && <p className="testset-desc">{ts.description}</p>}
            <div className="testset-foot">
              <span className="detail-muted">Added {formatDate(ts.createdAt)}</span>
              <div className="testset-actions">
                <button
                  className={`secondary-button sm ${selectedTestSetId === ts.id ? "active" : ""}`}
                  onClick={() => { setSelectedTestSetId(ts.id); toast.success(`"${ts.name}" selected for the next run`); }}
                >
                  {selectedTestSetId === ts.id ? "✓ Selected" : "Select"}
                </button>
                {ts.id !== "builtin" && (
                  <button
                    className="icon-button danger"
                    title="Delete test set"
                    onClick={() => {
                      if (window.confirm(`Delete "${ts.name}"? This cannot be undone.`)) {
                        deleteTestSet.mutate({ id: ts.id });
                        if (selectedTestSetId === ts.id) setSelectedTestSetId("builtin");
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {testSets.length === 0 && (
          <div className="empty-state">
            <FlaskConical size={32} />
            <p>No test sets loaded yet. Add one above.</p>
          </div>
        )}
      </div>

      <section className="hero-row" style={{ marginTop: 32 }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>JSON format</h2>
          <p className="hero-copy">Each test case needs three required fields and one optional one.</p>
        </div>
      </section>
      <pre className="code-block">{`[
  {
    "id": "q-001",           // unique identifier
    "question": "...",       // the question to ask
    "expectedAnswer": "...", // reference answer for scoring
    "tags": ["optional"]     // optional categorisation
  }
]`}</pre>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // VIEW: Regressions
  // ════════════════════════════════════════════════════════════════════════════
  const regressionsContent = (
    <div className="content-wrap">
      <section className="hero-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> Regressions</div>
          <h1>Score regressions<br /><em>in the latest run</em></h1>
          <p className="hero-copy">Cases where the composite score dropped more than 0.8 points compared to the previous run.</p>
        </div>
        <div className="hero-actions">
          <button className="secondary-button" onClick={() => setView("overview")}>
            ← Back to overview
          </button>
          <button className="primary-button" onClick={handleRun} disabled={runMutation.isPending}>
            <Play size={16} fill="currentColor" />
            {runMutation.isPending ? "Running…" : "Re-run evaluation"}
          </button>
        </div>
      </section>

      {regressionResults.length === 0 ? (
        <div className="empty-state large">
          <CheckCircle2 size={40} style={{ color: "#17b897" }} />
          <h2>No regressions detected</h2>
          <p>All cases are within tolerance of the previous run. Run another evaluation to compare.</p>
        </div>
      ) : (
        <>
          <div className="regression-summary">
            <span className="regression-count"><TriangleAlert size={16} /> {regressionResults.length} regression{regressionResults.length !== 1 ? "s" : ""}</span>
            <span className="detail-muted">in run <code>{activeRunId}</code></span>
          </div>
          <div className="question-list" style={{ marginTop: 12 }}>
            {regressionResults.map((item) => {
              const composite = (item.faithfulness + item.relevance + item.correctness) / 3;
              return (
                <button className="question-row regression-row" key={item.testCaseId} onClick={() => setReviewResult(item)}>
                  <div className="question-id">{item.testCaseId.replace("rag-", "#")}</div>
                  <div className="question-copy">
                    <strong>{item.question}</strong>
                    <span>{item.reasoning}</span>
                  </div>
                  <div className="question-score">
                    <Score value={composite} compact />
                    <span className="regression-badge">REGRESSION</span>
                    <ChevronRight size={14} />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <section style={{ marginTop: 40 }}>
        <div className="panel">
          <div className="panel-heading">
            <div><h2>All results for this run</h2><p>Click a row to view the full detail</p></div>
            <button
              className="secondary-button"
              onClick={() => window.open(activeRunId ? `/api/eval/report/${activeRunId}` : "/api/eval/report/run_seed_1", "_blank")}
            >
              <Download size={14} /> Export PDF
            </button>
          </div>
          <div className="results-table">
            <div className="results-table-head">
              <span>Case</span><span>Question</span><span>Faith.</span><span>Rel.</span><span>Corr.</span><span>Status</span>
            </div>
            {results.map((item) => {
              const composite = (item.faithfulness + item.relevance + item.correctness) / 3;
              return (
                <button className="results-table-row" key={item.testCaseId} onClick={() => setReviewResult(item)}>
                  <span className="case-id">{item.testCaseId}</span>
                  <span className="question-trunc">{item.question.length > 60 ? item.question.slice(0, 57) + "…" : item.question}</span>
                  <Score value={item.faithfulness} compact />
                  <Score value={item.relevance} compact />
                  <Score value={item.correctness} compact />
                  {item.regression
                    ? <span className="regression-badge">REGRESSION</span>
                    : composite >= 4
                    ? <span className="pass-badge">pass</span>
                    : <span className="review-badge">review</span>}
                </button>
              );
            })}
            {results.length === 0 && (
              <div className="empty-state" style={{ padding: "32px 0" }}>
                <Clock3 size={24} />
                <p>No results yet — run an evaluation first.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <div className="app-shell">
      {sidebar}
      <main className="main-content">
        {topbar}
        {view === "overview" && overviewContent}
        {view === "testset" && testSetContent}
        {view === "regressions" && regressionsContent}
      </main>

      <TestSetDialog
        open={showAddTestSet}
        onClose={() => setShowAddTestSet(false)}
        onSaved={() => void testSetsQuery.refetch()}
      />

      {reviewResult && (
        <ReviewDrawer
          result={reviewResult}
          runId={activeRunId}
          onClose={() => setReviewResult(null)}
          onRescored={(updated) => {
            setReviewResult(updated);
            void resultsQuery.refetch();
            void dashboard.refetch();
          }}
        />
      )}
    </div>
  );
}
