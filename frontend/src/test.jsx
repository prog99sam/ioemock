import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Clock, Flag, CheckCircle2, XCircle, MinusCircle, Loader2, Play, RotateCcw, ChevronLeft, ChevronRight, AlertTriangle, Settings2 } from "lucide-react";
import "./test.css";

const BACKEND_URL = "https://api.samiramgain.com.np/api/generate-questions/";
const BATCH_SIZE = 4;
const TOTAL_QUESTIONS = 100;
const EXAM_SECONDS = 2 * 60 * 60;

const DEFAULT_SUBJECTS = [
  {
    key: "Mathematics",
    color: "#2E4057",
    weight: 40,
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
    weight: 30,
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
    weight: 20,
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
    weight: 10,
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

async function fetchQuestionBatch(subjectDef, difficulty, count) {
  const response = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: subjectDef.key,
      chapters: subjectDef.chapters,
      difficulty,
      count,
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
  const [negPct, setNegPct] = useState(5);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [marked, setMarked] = useState({});
  const [current, setCurrent] = useState(0);
  const [timeLeft, setTimeLeft] = useState(EXAM_SECONDS);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [initLoading, setInitLoading] = useState(false);

  const fetchingRef = useRef(false);
  const configRef = useRef({ subjectDefs, difficulty });

  const weightSum = subjectDefs.reduce((a, s) => a + s.weight, 0);

  // section boundaries e.g. [36, 65, 86, 100] scaled to TOTAL_QUESTIONS
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

  const subjectColor = (name) => subjectDefs.find((s) => s.key === name)?.color || "#2E4057";

  const nextBatchPlan = useCallback(
    (existingCount) => {
      if (existingCount >= TOTAL_QUESTIONS) return null;
      let idx = configRef.current.subjectDefs.findIndex((_, i) => existingCount < boundariesRef.current[i]);
      if (idx === -1) idx = configRef.current.subjectDefs.length - 1;
      const sectionStart = idx === 0 ? 0 : boundariesRef.current[idx - 1];
      const remainingInSection = boundariesRef.current[idx] - existingCount;
      const count = Math.max(1, Math.min(BATCH_SIZE, remainingInSection));
      return { subjectDef: configRef.current.subjectDefs[idx], count };
    },
    []
  );

  const boundariesRef = useRef(boundaries);
  useEffect(() => {
    boundariesRef.current = boundaries;
  }, [boundaries]);

  const loadBatch = useCallback(async () => {
    if (fetchingRef.current) return;
    setQuestions((prevQ) => {
      const plan = nextBatchPlan(prevQ.length);
      if (!plan) return prevQ;
      fetchingRef.current = true;
      setFetching(true);
      setFetchError(null);
      fetchQuestionBatch(plan.subjectDef, configRef.current.difficulty, plan.count)
        .then((batch) => {
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
  }, [nextBatchPlan]);

  const startExam = async () => {
    configRef.current = { subjectDefs, difficulty };
    boundariesRef.current = boundaries;
    setQuestions([]);
    setAnswers({});
    setMarked({});
    setCurrent(0);
    setTimeLeft(EXAM_SECONDS);
    setInitLoading(true);
    setFetchError(null);
    try {
      const plan = nextBatchPlan(0);
      const batch = await fetchQuestionBatch(plan.subjectDef, difficulty, plan.count);
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

  useEffect(() => {
    if (phase !== "exam") return;
    if (questions.length < TOTAL_QUESTIONS && questions.length - current <= 2 && !fetchingRef.current) {
      loadBatch();
    }
  }, [phase, current, questions.length, loadBatch]);

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

  let correctCount = 0, wrongCount = 0, unattempted = 0;
  const subjectStats = {};
  questions.forEach((q, i) => {
    if (!(q.subject in subjectStats)) subjectStats[q.subject] = { correct: 0, total: 0 };
    subjectStats[q.subject].total += 1;
    const ans = answers[i];
    if (ans === undefined) unattempted += 1;
    else if (ans === q.correctIndex) {
      correctCount += 1;
      subjectStats[q.subject].correct += 1;
    } else wrongCount += 1;
  });
  const negPerWrong = negPct / 100;
  const rawScore = correctCount - wrongCount * negPerWrong;
  const attempted = correctCount + wrongCount;
  const accuracy = attempted > 0 ? Math.round((correctCount / attempted) * 100) : 0;

  const timePct = timeLeft / EXAM_SECONDS;
  const timeBarColor = timePct > 0.5 ? "var(--accent)" : timePct > 0.15 ? "var(--warning)" : "var(--danger)";

  // section label lookup for palette dividers
  const sectionForIndex = (i) => {
    let idx = boundaries.findIndex((b) => i < b);
    if (idx === -1) idx = subjectDefs.length - 1;
    return subjectDefs[idx];
  };

  return (
    <div className="ioe-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap');
        .ioe-root {
          --bg: #F7F6F2; --surface: #FFFFFF; --ink: #1B1B18; --ink-soft: #6B6A63;
          --border: #E4E2DA; --accent: #2E4057; --accent-soft: #E8ECF1;
          --danger: #C1443D; --danger-soft: #F7E6E4; --success: #3A7D44; --success-soft: #E7F0E8;
          --warning: #C97A2B; --warning-soft: #FBEBDA;
          font-family: 'Inter', sans-serif; background: var(--bg); color: var(--ink);
          min-height: 100%; width: 100%; box-sizing: border-box;
        }
        .ioe-root *, .ioe-root *::before, .ioe-root *::after { box-sizing: border-box; }
        .ioe-root button { font-family: inherit; cursor: pointer; }
        .ioe-root input, .ioe-root select { font-family: inherit; }
        .display { font-family: 'Space Grotesk', sans-serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .setup-wrap { max-width: 640px; margin: 0 auto; padding: 40px 24px 64px; }
        .setup-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 8px; }
        .setup-title { font-size: 30px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.01em; }
        .setup-sub { color: var(--ink-soft); font-size: 15px; margin: 0 0 26px; line-height: 1.5; }
        .format-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 22px 24px; margin-bottom: 24px; }
        .format-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 18px; }
        .format-stat-num { font-size: 20px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; }
        .format-stat-label { font-size: 11px; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
        .section-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
        .section-dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
        .section-name { width: 92px; flex-shrink: 0; font-weight: 600; }
        .section-marks { color: var(--ink-soft); font-family: 'JetBrains Mono', monospace; font-size: 12px; }
        .section-chapters { color: var(--ink-soft); font-size: 12px; }
        .field-block { margin-bottom: 22px; }
        .field-label { font-size: 13px; font-weight: 600; margin-bottom: 10px; display: block; }
        .select-box { width: 100%; border: 1.5px solid var(--border); background: var(--surface); border-radius: 10px; padding: 11px 14px; font-size: 14px; font-weight: 500; color: var(--ink); }
        .adv-toggle { display: flex; align-items: center; gap: 7px; background: none; border: none; color: var(--ink-soft); font-size: 13px; font-weight: 600; padding: 0; margin-bottom: 16px; }
        .adv-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 20px; margin-bottom: 22px; }
        .weight-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .weight-label { width: 100px; font-size: 13px; font-weight: 600; flex-shrink: 0; }
        .weight-input { width: 64px; border: 1.5px solid var(--border); border-radius: 8px; padding: 6px 8px; font-size: 13px; font-family: 'JetBrains Mono', monospace; }
        .start-btn { width: 100%; background: var(--accent); color: white; border: none; border-radius: 12px; padding: 16px; font-size: 15px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 8px; }
        .start-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .error-banner { background: var(--danger-soft); color: var(--danger); border-radius: 10px; padding: 12px 14px; font-size: 13.5px; margin-top: 14px; display: flex; gap: 8px; align-items: flex-start; }
        .exam-topbar { display: flex; align-items: center; justify-content: space-between; padding: 18px 28px; border-bottom: 1px solid var(--border); background: var(--surface); position: sticky; top: 0; z-index: 5; }
        .timer-block { display: flex; align-items: center; gap: 10px; }
        .timer-num { font-size: 20px; font-weight: 700; }
        .time-bar-track { height: 4px; background: var(--border); width: 100%; border-radius: 999px; overflow: hidden; position: sticky; top: 63px; z-index: 5; }
        .time-bar-fill { height: 100%; transition: width 1s linear, background 0.3s ease; }
        .submit-btn { background: var(--ink); color: white; border: none; border-radius: 8px; padding: 10px 20px; font-weight: 700; font-size: 13.5px; }
        .exam-shell { display: flex; min-height: 100%; }
        .exam-main { flex: 1; padding: 0 28px 28px; min-width: 0; }
        .q-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 32px; margin-top: 24px; }
        .q-meta { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .subject-tag { font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 999px; color: white; text-transform: uppercase; letter-spacing: 0.04em; }
        .chapter-tag { font-size: 12px; color: var(--ink-soft); margin-bottom: 16px; }
        .mark-btn { display: flex; align-items: center; gap: 6px; background: none; border: 1.5px solid var(--border); border-radius: 999px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); }
        .mark-btn.on { background: var(--warning-soft); color: var(--warning); border-color: transparent; }
        .q-text { font-size: 18px; font-weight: 600; line-height: 1.5; margin-bottom: 22px; }
        .opt { display: flex; align-items: center; gap: 12px; border: 1.5px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; font-size: 14.5px; font-weight: 500; transition: all 0.12s ease; }
        .opt:hover { border-color: var(--accent); }
        .opt.selected { border-color: var(--accent); background: var(--accent-soft); }
        .opt-letter { width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; font-family: 'JetBrains Mono', monospace; }
        .opt.selected .opt-letter { background: var(--accent); border-color: var(--accent); color: white; }
        .nav-row { display: flex; justify-content: space-between; margin-top: 22px; }
        .nav-btn { display: flex; align-items: center; gap: 6px; background: var(--surface); border: 1.5px solid var(--border); border-radius: 10px; padding: 10px 18px; font-weight: 600; font-size: 13.5px; }
        .nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .nav-btn.primary { background: var(--accent); color: white; border-color: transparent; }
        .palette-panel { width: 270px; flex-shrink: 0; border-left: 1px solid var(--border); padding: 24px 20px; background: var(--surface); overflow-y: auto; }
        .palette-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-soft); margin-bottom: 14px; }
        .palette-section-label { font-size: 11px; font-weight: 700; margin: 14px 0 8px; display: flex; align-items: center; gap: 6px; }
        .palette-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; }
        .palette-cell { aspect-ratio: 1; border-radius: 7px; border: 1.5px solid var(--border); font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; background: var(--surface); color: var(--ink-soft); position: relative; }
        .palette-cell.answered { color: white; border-color: transparent; }
        .palette-cell.marked { border-color: var(--warning); }
        .palette-cell.marked::after { content: ''; position: absolute; top: -3px; right: -3px; width: 7px; height: 7px; border-radius: 50%; background: var(--warning); }
        .palette-cell.current { outline: 2.5px solid var(--ink); outline-offset: 2px; }
        .gen-status { margin-top: 18px; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ink-soft); }
        .results-wrap { max-width: 780px; margin: 0 auto; padding: 44px 24px 80px; }
        .score-hero { background: var(--ink); color: white; border-radius: 20px; padding: 36px; margin-bottom: 28px; }
        .score-num { font-size: 52px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; line-height: 1; }
        .score-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; margin-top: 24px; }
        .stat-num { font-size: 22px; font-weight: 700; }
        .stat-label { font-size: 11.5px; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
        .subj-bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .subj-bar-label { width: 110px; font-size: 13px; font-weight: 600; flex-shrink: 0; }
        .subj-bar-track { flex: 1; height: 10px; background: var(--border); border-radius: 999px; overflow: hidden; }
        .subj-bar-fill { height: 100%; border-radius: 999px; }
        .subj-bar-frac { width: 48px; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-soft); flex-shrink: 0; }
        .review-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 22px; margin-bottom: 14px; }
        .review-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .review-q { font-size: 15px; font-weight: 600; margin-bottom: 12px; line-height: 1.5; }
        .review-opt { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 13.5px; }
        .review-explain { margin-top: 12px; padding: 12px 14px; background: var(--bg); border-radius: 10px; font-size: 13px; color: var(--ink-soft); line-height: 1.5; }
        .restart-btn { display: flex; align-items: center; gap: 8px; justify-content: center; width: 100%; background: var(--accent); color: white; border: none; border-radius: 12px; padding: 15px; font-weight: 700; font-size: 14.5px; margin-top: 8px; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {phase === "setup" && (
        <div className="setup-wrap">
          <div className="setup-eyebrow">IOE B.E./B.Arch Entrance · Full Mock</div>
          <h1 className="setup-title display">A fresh 100-question paper, every attempt</h1>
          <p className="setup-sub">Each mock is generated live to match the current official format — same question count, marking scheme, and syllabus weightage every time, with entirely new questions.</p>

          <div className="format-card">
            <div className="format-grid">
              <div><div className="format-stat-num">100</div><div className="format-stat-label">Questions</div></div>
              <div><div className="format-stat-num">100</div><div className="format-stat-label">Marks</div></div>
              <div><div className="format-stat-num">2:00:00</div><div className="format-stat-label">Duration</div></div>
              <div><div className="format-stat-num">−{negPct}%</div><div className="format-stat-label">Per wrong</div></div>
            </div>
            {subjectDefs.map((s, i) => (
              <div className="section-row" key={s.key}>
                <span className="section-dot" style={{ background: s.color }} />
                <span className="section-name">{s.key}</span>
                <span className="section-marks">{Math.round((s.weight / weightSum) * TOTAL_QUESTIONS)} marks</span>
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
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>deducted per wrong answer</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 10, lineHeight: 1.5 }}>
                Weights scale proportionally to fill exactly 100 marks — update these if IOE revises the official weightage.
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
                return (
                  <div className="q-card">
                    <div className="q-meta">
                      <span className="subject-tag" style={{ background: subjectColor(q.subject) }}>{q.subject}</span>
                      <button className={`mark-btn ${marked[current] ? "on" : ""}`} onClick={() => toggleMark(current)}>
                        <Flag size={13} /> {marked[current] ? "Marked" : "Mark for review"}
                      </button>
                    </div>
                    {q.chapter && <div className="chapter-tag">{q.chapter}</div>}
                    <div className="q-text">{q.question}</div>
                    {q.options.map((opt, i) => (
                      <div key={i} className={`opt ${answers[current] === i ? "selected" : ""}`} onClick={() => selectAnswer(current, i)}>
                        <span className="opt-letter">{String.fromCharCode(65 + i)}</span>
                        <span>{opt}</span>
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
            <div className="score-num">{rawScore.toFixed(2)} <span style={{ fontSize: 20, fontWeight: 500, color: "rgba(255,255,255,0.55)" }}>/ 100</span></div>
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
            return (
              <div className="review-card" key={i}>
                <div className="review-head">
                  <span className="subject-tag" style={{ background: subjectColor(q.subject) }}>{q.subject}</span>
                  {ans === undefined ? <MinusCircle size={16} color="var(--ink-soft)" /> : isCorrect ? <CheckCircle2 size={16} color="var(--success)" /> : <XCircle size={16} color="var(--danger)" />}
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)" }}>Q{i + 1}</span>
                </div>
                <div className="review-q">{q.question}</div>
                {q.options.map((opt, oi) => {
                  let color = "var(--ink-soft)", icon = null;
                  if (oi === q.correctIndex) { color = "var(--success)"; icon = <CheckCircle2 size={14} color="var(--success)" />; }
                  else if (oi === ans) { color = "var(--danger)"; icon = <XCircle size={14} color="var(--danger)" />; }
                  return (
                    <div className="review-opt" key={oi} style={{ color, fontWeight: oi === q.correctIndex || oi === ans ? 600 : 400 }}>
                      {icon || <span style={{ width: 14 }} />}{opt}
                    </div>
                  );
                })}
                <div className="review-explain">{q.explanation}</div>
              </div>
            );
          })}

          <button className="restart-btn" onClick={restart}><RotateCcw size={16} /> Start a new mock</button>
        </div>
      )}
    </div>
  );
}