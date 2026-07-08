import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Clock, Flag, CheckCircle2, XCircle, MinusCircle, Loader2, Play, RotateCcw, ChevronLeft, ChevronRight, AlertTriangle, Settings2 } from "lucide-react";
import "./test.css";

const BACKEND_URL = "https://api.samiramgain.com.np/api/generate-questions/";
const BATCH_SIZE = 4;
const TOTAL_QUESTIONS = 100;
const MIN_REQUEST_GAP_MS = 6500; // backend caps NaraRouter calls at 10/min ≈ 1 every 6s; pace with a small safety margin
const PART_A_COUNT = 60; // 1 mark each
const PART_B_COUNT = 40; // 2 marks each
const TOTAL_MARKS = PART_A_COUNT * 1 + PART_B_COUNT * 2; // 140, official IOE 2083/84 pattern
const EXAM_SECONDS = 2 * 60 * 60;
const RECENT_TOPICS_CAP = 40;

// marks scale by global question position: first 60 = 1 mark (Part A), last 40 = 2 marks (Part B)
const marksForIndex = (i) => (i < PART_A_COUNT ? 1 : 2);

// Subject weights reflect the official IOE marks split (Math 50 / Physics 45 / Chemistry 25 / English 20 = 140)
const DEFAULT_SUBJECTS = [
  {
    key: "Mathematics",
    color: "#2E4057",
    weight: 50,
    chapters: [
      "Sets, relations and functions — algebraic, trigonometric, exponential, logarithmic, hyperbolic functions and their inverses",
      "Algebra — determinants, matrices, inverse of a matrix, complex numbers, polynomial equations",
      "Sequence & series, permutation and combination, binomial theorem, exponential and logarithmic series",
      "Trigonometry — trigonometric equations and general values, inverse trigonometric functions, properties of triangles (centroid, incentre, orthocentre, circumcentre)",
      "Coordinate geometry — straight lines, pair of lines, circles",
      "Conic sections (parabola, ellipse, hyperbola), coordinates in space, plane and its equation",
      "Limits and continuity of functions",
      "Derivatives and applications — tangent and normal, rate of change, maxima and minima",
      "Integration — rules of integration, standard integrals, definite integral, area under a curve and between two curves",
      "Vectors — addition, linear combination, linear dependence/independence, scalar and vector product",
    ],
  },
  {
    key: "Physics",
    color: "#6B4C9A",
    weight: 45,
    chapters: [
      "Mechanics — dimensions, equations of motion, projectile motion, laws of motion, vector addition/subtraction, relative velocity, equilibrium of forces, moments, centre of mass/gravity, friction, work-power-energy, conservation of energy",
      "Rotational mechanics & gravitation — angular speed, centripetal force, moment of inertia, torque, angular momentum, rotational kinetic energy, laws of gravitation, escape velocity",
      "Elasticity & simple harmonic motion — Hooke's law, breaking stress, modulus of elasticity, energy in a stretched wire, SHM and its energy",
      "Fluid mechanics & surface tension — surface tension, surface energy, capillarity, fluid pressure, Pascal's law, Archimedes' principle, flotation, Stokes' law, terminal velocity",
      "Heat & thermodynamics — temperature scales, specific heat capacity, latent heat, humidity, first and second laws of thermodynamics, Carnot's engine, gas laws, kinetic theory of gases, conduction/convection/radiation, thermal expansion",
      "Optics — plane and curved mirrors, refraction, total internal reflection, prisms, lenses, dispersion, telescope and microscope, wave theory of light, interference, diffraction, polarization",
      "Waves & sound — damped and forced oscillation, resonance, progressive waves, superposition, velocity of sound, Laplace's correction, beats, Doppler effect, stationary waves",
      "Electricity & magnetism — electric charge, Coulomb's law, electric field, Gauss's law, electric potential, capacitors, Ohm's law, Kirchhoff's laws, Wheatstone bridge, galvanometer conversion, magnetic field, Ampere's law, Biot-Savart law, electromagnetic induction, AC circuits",
      "Modern physics & electronics — cathode rays, Bohr's atomic theory, energy levels, X-rays, photoelectric effect, radioactivity, nuclear fission and fusion, semiconductors, junction transistors",
    ],
  },
  {
    key: "Chemistry",
    color: "#3A7D44",
    weight: 25,
    chapters: [
      "Language of chemistry & stoichiometry — symbols, valency, chemical equations, weight-weight and weight-volume problems",
      "Atomic structure — cathode rays, Rutherford's scattering experiment, Rutherford and Bohr models, quantum numbers, electron configuration",
      "Chemical bonding — octet rule, electrovalency, covalency, coordinate valency, ionic and covalent compounds",
      "Oxidation, reduction & electrochemistry — balancing redox equations, electrolytes, Faraday's laws of electrolysis, solubility product",
      "Periodic classification & properties — Mendeleev's and modern periodic law, ionization potential, electronegativity, atomic radii",
      "Acids, bases & volumetric analysis — Arrhenius, Bronsted-Lowry and Lewis theories, pH scale, acidimetry and alkalimetry",
      "Non-metals and their compounds — water hardness, nitrogen and its compounds, sulphur and its compounds, halogens",
      "Metals and metallurgy — extraction of sodium, copper, zinc and iron; compounds of metals (oxides, hydroxides, chlorides, sulphates, carbonates)",
      "Organic chemistry fundamentals — purification, classification and IUPAC nomenclature, functional groups, isomerism",
      "Hydrocarbons & aromatic compounds — alkanes, alkenes, alkynes, alkyl halides, structure and preparation of benzene",
    ],
  },
  {
    key: "English",
    color: "#C97A2B",
    weight: 20,
    chapters: [
      "Grammar I — parts of speech, tense and aspect, direct and indirect speech, kinds of sentences and their transformation",
      "Grammar II — conditional sentences, active and passive voice, verbals (infinitives, gerunds, participles), concord/agreement",
      "Vocabulary and usage — prepositions, idiomatic expressions, punctuation",
      "Phonetics — phonemes and phonetic symbols, syllables and word stress",
      "Reading comprehension — general English and technical English passages",
    ],
  },
];

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ---------------------------------------------------------------------------
// KaTeX loader — injected once, lazily, so the app has no build-time deps.
// ---------------------------------------------------------------------------
let katexLoadPromise = null;
function loadKatex() {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.katex) return Promise.resolve(true);
  if (katexLoadPromise) return katexLoadPromise;

  katexLoadPromise = new Promise((resolve) => {
    const cssHref = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css";
    if (!document.querySelector(`link[href="${cssHref}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssHref;
      document.head.appendChild(link);
    }
    const scriptSrc = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js";
    const existing = document.querySelector(`script[src="${scriptSrc}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      if (window.katex) resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = scriptSrc;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return katexLoadPromise;
}

function useKatexReady() {
  const [ready, setReady] = useState(typeof window !== "undefined" && !!window.katex);
  useEffect(() => {
    let mounted = true;
    loadKatex().then((ok) => mounted && setReady(ok));
    return () => {
      mounted = false;
    };
  }, []);
  return ready;
}

// Renders text containing $...$ inline LaTeX spans via KaTeX; falls back to
// plain text for anything KaTeX can't parse or before it has loaded.
function MathText({ text, katexReady, className }) {
  // Split on $$...$$ (display math — matrices, determinants, multi-line
  // expressions) before falling back to single $...$ (inline math).
  const segments = useMemo(() => {
    if (!text) return [];
    return String(text)
      .split(/(\$\$[\s\S]+?\$\$|\$[^$]+\$)/g)
      .filter((s) => s !== "");
  }, [text]);

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        const isDisplay = seg.startsWith("$$") && seg.endsWith("$$") && seg.length > 4;
        const isInline = !isDisplay && seg.startsWith("$") && seg.endsWith("$") && seg.length > 2;
        if (isDisplay || isInline) {
          const expr = isDisplay ? seg.slice(2, -2) : seg.slice(1, -1);
          if (katexReady && window.katex) {
            try {
              const html = window.katex.renderToString(expr, {
                throwOnError: false,
                output: "html",
                displayMode: isDisplay,
              });
              const Wrapper = isDisplay ? "span" : "span";
              return (
                <Wrapper
                  key={i}
                  className={isDisplay ? "math-display" : undefined}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              );
            } catch {
              return <span key={i}>{expr}</span>;
            }
          }
          return <span key={i} className="math-loading">{expr}</span>;
        }
        return <span key={i}>{seg}</span>;
      })}
    </span>
  );
}

async function fetchQuestionBatch(subjectDef, difficulty, count, chapterCounts, targetCount, generatedCount, recentTopics) {
  const response = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: subjectDef.key,
      chapters: subjectDef.chapters,
      difficulty,
      count,
      chapterCounts,
      targetCount,
      generatedCount,
      recentTopics,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error);
  if (!Array.isArray(data.questions)) throw new Error("Malformed response");
  return data.questions.map((q) => ({ ...q, subject: subjectDef.key }));
}

export default function IOEOfficialMock() {
  const [phase, setPhase] = useState("setup"); // setup | exam | results
  const [subjectDefs, setSubjectDefs] = useState(DEFAULT_SUBJECTS);
  const [difficulty, setDifficulty] = useState("Mixed");
  const [negPct, setNegPct] = useState(10); // IOE's official negative marking is 10% per wrong answer
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [marked, setMarked] = useState({});
  const [current, setCurrent] = useState(0);
  const [timeLeft, setTimeLeft] = useState(EXAM_SECONDS);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [initLoading, setInitLoading] = useState(false);

  const katexReady = useKatexReady();

  const fetchingRef = useRef(false);
  const configRef = useRef({ subjectDefs, difficulty });
  const lastFetchAtRef = useRef(0);

  // topic-tracking: { [subject]: { [chapter]: count } }, plus a rolling
  // window of short "topic" labels used to stop the LLM repeating concepts.
  const chapterCountsRef = useRef({});
  const recentTopicsRef = useRef([]);

  const weightSum = subjectDefs.reduce((a, s) => a + s.weight, 0);

  // section boundaries e.g. [36, 68, 86, 100] scaled to TOTAL_QUESTIONS
  const boundaries = useMemo(() => {
    let acc = 0;
    const raw = subjectDefs.map((s) => {
      const c = Math.round((s.weight / weightSum) * TOTAL_QUESTIONS);
      acc += c;
      return acc;
    });
    raw[raw.length - 1] = TOTAL_QUESTIONS; // force exact total
    return raw;
  }, [subjectDefs, weightSum]);

  const boundariesRef = useRef(boundaries);
  useEffect(() => {
    boundariesRef.current = boundaries;
  }, [boundaries]);

  const subjectColor = (name) => subjectDefs.find((s) => s.key === name)?.color || "#2E4057";

  const nextBatchPlan = useCallback((existingCount, questionsSoFar) => {
    if (existingCount >= TOTAL_QUESTIONS) return null;
    const defs = configRef.current.subjectDefs;
    const bnds = boundariesRef.current;
    let idx = defs.findIndex((_, i) => existingCount < bnds[i]);
    if (idx === -1) idx = defs.length - 1;
    const sectionStart = idx === 0 ? 0 : bnds[idx - 1];
    const remainingInSection = bnds[idx] - existingCount;
    const count = Math.max(1, Math.min(BATCH_SIZE, remainingInSection));
    const subjectDef = defs[idx];
    const targetCount = bnds[idx] - sectionStart;
    const generatedCount = questionsSoFar.filter((q) => q.subject === subjectDef.key).length;
    return { subjectDef, count, targetCount, generatedCount };
  }, []);

  const recordGenerated = useCallback((batch) => {
    for (const q of batch) {
      const subj = q.subject;
      const chap = q.chapter || "Unspecified";
      if (!chapterCountsRef.current[subj]) chapterCountsRef.current[subj] = {};
      chapterCountsRef.current[subj][chap] = (chapterCountsRef.current[subj][chap] || 0) + 1;
      if (q.topic) {
        recentTopicsRef.current.push(`${subj}: ${q.topic}`);
        if (recentTopicsRef.current.length > RECENT_TOPICS_CAP) {
          recentTopicsRef.current = recentTopicsRef.current.slice(-RECENT_TOPICS_CAP);
        }
      }
    }
  }, []);

  const loadBatch = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true; // claim the slot immediately so no duplicate is scheduled
    setFetching(true);
    setFetchError(null);

    const now = Date.now();
    const wait = Math.max(0, MIN_REQUEST_GAP_MS - (now - lastFetchAtRef.current));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }

    setQuestions((prevQ) => {
      const plan = nextBatchPlan(prevQ.length, prevQ);
      if (!plan) {
        fetchingRef.current = false;
        setFetching(false);
        return prevQ;
      }
      lastFetchAtRef.current = Date.now();
      const chapterCounts = chapterCountsRef.current[plan.subjectDef.key] || {};
      fetchQuestionBatch(
        plan.subjectDef,
        configRef.current.difficulty,
        plan.count,
        chapterCounts,
        plan.targetCount,
        plan.generatedCount,
        recentTopicsRef.current
      )
        .then((batch) => {
          recordGenerated(batch);
          setQuestions((p) => [...p, ...batch]);
        })
        .catch(() => {
          setFetchError("Couldn't generate more questions. Check your connection and retry.");
        })
        .finally(() => {
          fetchingRef.current = false;
          setFetching(false);
        });
      return prevQ;
    });
  }, [nextBatchPlan, recordGenerated]);

  const startExam = async () => {
    configRef.current = { subjectDefs, difficulty };
    boundariesRef.current = boundaries;
    chapterCountsRef.current = {};
    recentTopicsRef.current = [];
    setQuestions([]);
    setAnswers({});
    setMarked({});
    setCurrent(0);
    setTimeLeft(EXAM_SECONDS);
    setInitLoading(true);
    setFetchError(null);
    try {
      const plan = nextBatchPlan(0, []);
      lastFetchAtRef.current = Date.now();
      const batch = await fetchQuestionBatch(
        plan.subjectDef,
        difficulty,
        plan.count,
        {},
        plan.targetCount,
        plan.generatedCount,
        []
      );
      recordGenerated(batch);
      setQuestions(batch);
      setPhase("exam");
    } catch (e) {
      setFetchError("Couldn't start the mock. Check your connection and try again.");
    } finally {
      setInitLoading(false);
    }
  };

  useEffect(() => {
    if (phase !== "exam") return;
    if (timeLeft <= 0) {
      setPhase("results");
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, timeLeft]);

  // Rolling background generation: the moment one batch lands, immediately
  // kick off the request for the next one — independent of which question
  // the user is currently viewing — so the whole paper keeps filling in
  // the background until all TOTAL_QUESTIONS are buffered.
  useEffect(() => {
    if (phase !== "exam") return;
    if (questions.length >= TOTAL_QUESTIONS) return;
    if (fetchingRef.current) return;
    loadBatch();
  }, [phase, questions.length, loadBatch]);

  const selectAnswer = (qIdx, optIdx) => setAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
  const toggleMark = (qIdx) => setMarked((prev) => ({ ...prev, [qIdx]: !prev[qIdx] }));
  const goto = (idx) => idx >= 0 && setCurrent(idx);
  const submitExam = () => setPhase("results");
  const restart = () => {
    setPhase("setup");
    setQuestions([]);
    setAnswers({});
    setMarked({});
    setCurrent(0);
  };
  const updateWeight = (key, val) => {
    setSubjectDefs((prev) => prev.map((s) => (s.key === key ? { ...s, weight: val } : s)));
  };

  let correctCount = 0, wrongCount = 0, unattempted = 0, scoredMarks = 0, maxPossibleMarks = 0;
  const subjectStats = {};
  questions.forEach((q, i) => {
    const marks = marksForIndex(i);
    maxPossibleMarks += marks;
    if (!(q.subject in subjectStats)) subjectStats[q.subject] = { correct: 0, total: 0 };
    subjectStats[q.subject].total += 1;
    const ans = answers[i];
    if (ans === undefined) unattempted += 1;
    else if (ans === q.correctIndex) {
      correctCount += 1;
      scoredMarks += marks;
      subjectStats[q.subject].correct += 1;
    } else {
      wrongCount += 1;
      scoredMarks -= marks * (negPct / 100);
    }
  });

  const attempted = correctCount + wrongCount;
  const accuracy = attempted > 0 ? Math.round((correctCount / attempted) * 100) : 0;

  const timePct = timeLeft / EXAM_SECONDS;
  const timeBarColor = timePct > 0.5 ? "var(--accent)" : timePct > 0.15 ? "var(--warning)" : "var(--danger)";

  return (
    <div className="ioe-root">
      {phase === "setup" && (
        <div className="setup-wrap">
          <div className="setup-eyebrow">IOE B.E./B.Arch Entrance · 2083/84 Pattern</div>
          <h1 className="setup-title display">A fresh {TOTAL_QUESTIONS}-question paper, every attempt</h1>
          <p className="setup-sub">Each mock is generated live to match the current official format — {TOTAL_QUESTIONS} questions, {TOTAL_MARKS} marks (Part A: {PART_A_COUNT}×1 mark, Part B: {PART_B_COUNT}×2 marks), 10% negative marking — with entirely new, syllabus-balanced questions every time.</p>

          <div className="format-card">
            <div className="format-grid">
              <div><div className="format-stat-num">{TOTAL_QUESTIONS}</div><div className="format-stat-label">Questions</div></div>
              <div><div className="format-stat-num">{TOTAL_MARKS}</div><div className="format-stat-label">Marks</div></div>
              <div><div className="format-stat-num">2:00:00</div><div className="format-stat-label">Duration</div></div>
              <div><div className="format-stat-num">−{negPct}%</div><div className="format-stat-label">Per wrong</div></div>
            </div>
            <div className="part-note">Part A: Q1–{PART_A_COUNT} · 1 mark each &nbsp;·&nbsp; Part B: Q{PART_A_COUNT + 1}–{TOTAL_QUESTIONS} · 2 marks each</div>
            {subjectDefs.map((s) => (
              <div className="section-row" key={s.key}>
                <span className="section-dot" style={{ background: s.color }} />
                <span className="section-name">{s.key}</span>
                <span className="section-marks">{Math.round((s.weight / weightSum) * TOTAL_QUESTIONS)} questions</span>
                <span className="section-chapters">· {s.chapters.length} chapters</span>
              </div>
            ))}
          </div>

          <div className="field-block">
            <span className="field-label">Difficulty</span>
            <select className="select-box" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option>Mixed</option>
              <option>Easy</option>
              <option>Medium</option>
              <option>Hard</option>
            </select>
          </div>

          <button className="adv-toggle" onClick={() => setShowAdvanced((v) => !v)}>
            <Settings2 size={14} /> {showAdvanced ? "Hide" : "Adjust"} weightage & negative marking
          </button>

          {showAdvanced && (
            <div className="adv-panel">
              {subjectDefs.map((s) => (
                <div className="weight-row" key={s.key}>
                  <span className="weight-label">{s.key}</span>
                  <input
                    type="number"
                    className="weight-input"
                    value={s.weight}
                    onChange={(e) => updateWeight(s.key, Number(e.target.value) || 0)}
                  />
                  <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>relative weight</span>
                </div>
              ))}
              <div className="weight-row" style={{ marginTop: 6, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                <span className="weight-label">Negative %</span>
                <input type="number" className="weight-input" value={negPct} onChange={(e) => setNegPct(Number(e.target.value) || 0)} />
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>deducted per wrong answer (official IOE value is 10%)</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 10, lineHeight: 1.5 }}>
                Weights scale proportionally across {TOTAL_QUESTIONS} questions — defaults mirror the official {TOTAL_MARKS}-mark subject split (Math 50 / Physics 45 / Chemistry 25 / English 20).
              </div>
            </div>
          )}

          <button className="start-btn" disabled={initLoading} onClick={startExam}>
            {initLoading ? <Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={17} />}
            {initLoading ? "Preparing your mock…" : "Start full mock test"}
          </button>
          {fetchError && (
            <div className="error-banner">
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{fetchError}</span>
            </div>
          )}
        </div>
      )}

      {phase === "exam" && questions.length > 0 && (
        <div>
          <div className="exam-topbar">
            <div className="timer-block">
              <Clock size={18} color={timeBarColor} />
              <span className="timer-num mono" style={{ color: timeBarColor }}>{formatTime(timeLeft)}</span>
            </div>
            <span style={{ fontSize: 13, color: "var(--ink-soft)", fontWeight: 600 }}>
              Question {current + 1} of {TOTAL_QUESTIONS} {fetching ? "· loading more…" : ""}
            </span>
            <button className="submit-btn" onClick={submitExam}>Submit test</button>
          </div>
          <div className="time-bar-track">
            <div className="time-bar-fill" style={{ width: `${timePct * 100}%`, background: timeBarColor }} />
          </div>

          <div className="exam-shell">
            <div className="exam-main">
              {(() => {
                const q = questions[current];
                if (!q) return null;
                const marks = marksForIndex(current);
                return (
                  <div className="q-card">
                    <div className="q-meta">
                      <span className="subject-tag" style={{ background: subjectColor(q.subject) }}>{q.subject}</span>
                      <span className="marks-tag">{marks} mark{marks > 1 ? "s" : ""}</span>
                      <button className={`mark-btn ${marked[current] ? "on" : ""}`} onClick={() => toggleMark(current)}>
                        <Flag size={13} /> {marked[current] ? "Marked" : "Mark for review"}
                      </button>
                    </div>
                    {q.chapter && <div className="chapter-tag">{q.chapter}</div>}
                    <div className="q-text"><MathText text={q.question} katexReady={katexReady} /></div>
                    {q.options.map((opt, i) => (
                      <div key={i} className={`opt ${answers[current] === i ? "selected" : ""}`} onClick={() => selectAnswer(current, i)}>
                        <span className="opt-letter">{String.fromCharCode(65 + i)}</span>
                        <MathText text={opt} katexReady={katexReady} />
                      </div>
                    ))}
                    <div className="nav-row">
                      <button className="nav-btn" disabled={current === 0} onClick={() => goto(current - 1)}><ChevronLeft size={15} /> Previous</button>
                      <button className="nav-btn primary" disabled={current === TOTAL_QUESTIONS - 1} onClick={() => goto(current + 1)}>Next <ChevronRight size={15} /></button>
                    </div>
                    {fetchError && (
                      <div className="error-banner">
                        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span>{fetchError}</span>
                        <button style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--danger)", fontWeight: 700, fontSize: 12.5 }} onClick={loadBatch}>Retry</button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="palette-panel">
              <div className="palette-title">Question palette</div>
              {subjectDefs.map((s, si) => {
                const start = si === 0 ? 0 : boundaries[si - 1];
                const end = boundaries[si];
                const items = questions.slice(start, end);
                if (items.length === 0) return null;
                return (
                  <div key={s.key}>
                    <div className="palette-section-label" style={{ color: s.color }}>
                      <span className="section-dot" style={{ background: s.color }} /> {s.key}
                    </div>
                    <div className="palette-grid">
                      {items.map((_, j) => {
                        const i = start + j;
                        return (
                          <button
                            key={i}
                            className={`palette-cell ${answers[i] !== undefined ? "answered" : ""} ${marked[i] ? "marked" : ""} ${i === current ? "current" : ""}`}
                            style={answers[i] !== undefined ? { background: s.color } : {}}
                            onClick={() => goto(i)}
                          >
                            {i + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="gen-status">
                {fetching ? (<><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> loading next section…</>) : questions.length < TOTAL_QUESTIONS ? (<>{questions.length}/{TOTAL_QUESTIONS} loaded</>) : (<>all {TOTAL_QUESTIONS} questions loaded</>)}
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === "results" && (
        <div className="results-wrap">
          <div className="setup-eyebrow">IOE Full Mock — Results</div>
          <div className="score-hero">
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>Net score</div>
            <div className="score-num">{scoredMarks.toFixed(2)} <span style={{ fontSize: 20, fontWeight: 500, color: "rgba(255,255,255,0.55)" }}>/ {maxPossibleMarks || TOTAL_MARKS}</span></div>
            <div className="score-stats">
              <div><div className="stat-num" style={{ color: "#7CC08A" }}>{correctCount}</div><div className="stat-label">Correct</div></div>
              <div><div className="stat-num" style={{ color: "#E1948E" }}>{wrongCount}</div><div className="stat-label">Wrong</div></div>
              <div><div className="stat-num" style={{ color: "rgba(255,255,255,0.7)" }}>{unattempted}</div><div className="stat-label">Skipped</div></div>
              <div><div className="stat-num">{accuracy}%</div><div className="stat-label">Accuracy</div></div>
            </div>
          </div>

          <h3 className="display" style={{ fontSize: 17, marginBottom: 16 }}>By subject</h3>
          {Object.entries(subjectStats).map(([subj, st]) => (
            <div className="subj-bar-row" key={subj}>
              <span className="subj-bar-label">{subj}</span>
              <div className="subj-bar-track"><div className="subj-bar-fill" style={{ width: `${(st.correct / st.total) * 100}%`, background: subjectColor(subj) }} /></div>
              <span className="subj-bar-frac">{st.correct}/{st.total}</span>
            </div>
          ))}

          <h3 className="display" style={{ fontSize: 17, margin: "28px 0 16px" }}>Review</h3>
          {questions.map((q, i) => {
            const ans = answers[i];
            const isCorrect = ans === q.correctIndex;
            const marks = marksForIndex(i);
            return (
              <div className="review-card" key={i}>
                <div className="review-head">
                  <span className="subject-tag" style={{ background: subjectColor(q.subject) }}>{q.subject}</span>
                  <span className="marks-tag">{marks} mark{marks > 1 ? "s" : ""}</span>
                  {ans === undefined ? <MinusCircle size={16} color="var(--ink-soft)" /> : isCorrect ? <CheckCircle2 size={16} color="var(--success)" /> : <XCircle size={16} color="var(--danger)" />}
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)" }}>Q{i + 1}</span>
                </div>
                <div className="review-q"><MathText text={q.question} katexReady={katexReady} /></div>
                {q.options.map((opt, oi) => {
                  let color = "var(--ink-soft)", icon = null;
                  if (oi === q.correctIndex) { color = "var(--success)"; icon = <CheckCircle2 size={14} color="var(--success)" />; }
                  else if (oi === ans) { color = "var(--danger)"; icon = <XCircle size={14} color="var(--danger)" />; }
                  return (
                    <div className="review-opt" key={oi} style={{ color, fontWeight: oi === q.correctIndex || oi === ans ? 600 : 400 }}>
                      {icon || <span style={{ width: 14 }} />}<MathText text={opt} katexReady={katexReady} />
                    </div>
                  );
                })}
                <div className="review-explain"><MathText text={q.explanation} katexReady={katexReady} /></div>
              </div>
            );
          })}

          <button className="restart-btn" onClick={restart}><RotateCcw size={16} /> Start a new mock</button>
        </div>
      )}
    </div>
  );
}