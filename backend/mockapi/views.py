import os
import re
import json
import time
import threading
from collections import deque

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from openai import OpenAI
from dotenv import load_dotenv
load_dotenv()

# --- NaraRouter client (OpenAI-compatible endpoint) ---
client = OpenAI(
    api_key=os.getenv("NARAROUTER_API_KEY"),
    base_url="https://router.bynara.id/v1",
)

MODEL = os.environ.get("NARAROUTER_MODEL", "mistral-large")

# --- Simple rate limiter: NaraRouter caps this key at 10 req/min ---
RATE_LIMIT = 10
WINDOW_SECONDS = 60
_lock = threading.Lock()
_timestamps = deque()


def wait_for_rate_limit():
    """Blocks just long enough to keep us under RATE_LIMIT requests per WINDOW_SECONDS."""
    with _lock:
        now = time.time()
        while _timestamps and now - _timestamps[0] > WINDOW_SECONDS:
            _timestamps.popleft()
        if len(_timestamps) >= RATE_LIMIT:
            wait = WINDOW_SECONDS - (now - _timestamps[0]) + 0.1
        else:
            wait = 0
        _timestamps.append(now + wait)
    if wait > 0:
        time.sleep(wait)


# ---------------------------------------------------------------------------
# IOE 2083/84 official pattern: 100 questions / 140 marks / 2 hours.
# Part A = first 60 questions @ 1 mark each, Part B = last 40 @ 2 marks each.
# Subject marks split (Math 50 / Physics 45 / Chemistry 25 / English 20 = 140)
# is the reference used to derive question-count targets on the frontend.
# 10% negative marking per wrong answer, applied to that question's marks.
# ---------------------------------------------------------------------------


_MATRIX_ENV_RE = re.compile(
    r'\\begin\{(matrix|pmatrix|bmatrix|vmatrix|Vmatrix|array|cases|aligned)\}'
    r'[\s\S]*?\\end\{\1\}'
)


def _protect_matrix_blocks(text):
    """Pulls out \\begin{...}...\\end{...} environments (matrices,
    determinants, systems of equations) so the token-level cleanup below
    never touches their internal & / \\\\ structure. Returns the text with
    placeholders plus a dict to restore them, each wrapped as display math."""
    blocks = {}

    def stash(match):
        placeholder = f"\x00MATBLK{len(blocks)}\x00"
        block = match.group(0)
        # Wrap the whole environment as its own display-math expression.
        blocks[placeholder] = f"$${block}$$"
        return placeholder

    protected = _MATRIX_ENV_RE.sub(stash, text)
    return protected, blocks


def _restore_matrix_blocks(text, blocks):
    for placeholder, wrapped in blocks.items():
        text = text.replace(placeholder, wrapped)
    return text


_STRAY_LETTER_ESCAPE_RE = re.compile(r'(?<!\\)\\([bfnrt][a-zA-Z]+)')
_STRAY_UNICODE_ESCAPE_RE = re.compile(r'(?<!\\)\\u(?![0-9a-fA-F]{4})')


def repair_latex_json_escapes(raw):
    """Models frequently emit LaTeX like \\begin, \\frac, \\rho, \\tan,
    \\underline with only a single backslash inside the JSON string. JSON
    treats \\b \\f \\n \\r \\t \\u as real escapes (backspace, form-feed,
    newline, carriage-return, tab, unicode) — so a bare \\begin silently
    parses as a backspace control character followed by the literal text
    "egin", corrupting the LaTeX invisibly instead of raising a JSON error.
    This doubles the backslash wherever it's clearly a multi-letter LaTeX
    command name rather than an actual control-char escape, without
    touching backslashes that are already correctly doubled."""
    raw = _STRAY_LETTER_ESCAPE_RE.sub(lambda m: "\\\\" + m.group(1), raw)
    raw = _STRAY_UNICODE_ESCAPE_RE.sub(r"\\\\u", raw)
    return raw


def normalize_latex(text):
    """Best-effort cleanup of near-LaTeX the model sometimes emits, and makes
    sure every math snippet is wrapped in $...$ (or $$...$$ for matrix/array
    environments) so the frontend's KaTeX renderer picks it up cleanly.
    Idempotent-ish: safe to run on already-clean text."""
    if not text:
        return text

    # Matrix/determinant/system-of-equations environments are wrapped whole
    # and shielded from the token-by-token rules below, which would otherwise
    # break their & / \\ row-column structure apart.
    text, matrix_blocks = _protect_matrix_blocks(text)

    # Bare `frac{a}{b}`, `sqrt{x}` / `sqrt(x)` missing their backslash.
    text = re.sub(r'(?<!\\)\bfrac\{', r'\\frac{', text)
    text = re.sub(r'(?<!\\)\bsqrt\(([^()]+)\)', r'\\sqrt{\1}', text)
    text = re.sub(r'(?<!\\)\bsqrt\{', r'\\sqrt{', text)
    text = re.sub(r'(?<!\\)\bint\b', r'\\int', text)
    text = re.sub(r'(?<!\\)\bsum\b', r'\\sum', text)
    text = re.sub(r'(?<!\\)\blim\b', r'\\lim', text)

    # Common bare greek letters -> \greek (word-boundary, not already escaped).
    for g in ["pi", "theta", "alpha", "beta", "gamma", "delta", "lambda",
              "sigma", "omega", "mu", "phi", "epsilon", "rho", "tau"]:
        text = re.sub(rf'(?<![\\a-zA-Z]){g}(?![a-zA-Z])', rf'\\{g}', text)

    # Wrap any run containing a LaTeX command or ^ / _ math syntax in $...$
    # if it isn't already inside $ ... $ delimiters (matrix blocks are
    # already placeholder tokens by this point, so they're untouched).
    def wrap_math(match):
        return f"${match.group(0)}$"

    parts = re.split(r'(\$\$[\s\S]*?\$\$|\$[^$]*\$)', text)
    for i, part in enumerate(parts):
        if part.startswith('$'):
            continue
        parts[i] = re.sub(
            r'(\\[a-zA-Z]+(\{[^{}]*\}|\^\{[^{}]*\}|_\{[^{}]*\})*'
            r'(\^\{[^{}]*\}|_\{[^{}]*\}|\{[^{}]*\})*|'
            r'[A-Za-z0-9]\^\{?[A-Za-z0-9+\-]+\}?|'
            r'[A-Za-z0-9]_\{?[A-Za-z0-9+\-]+\}?)',
            wrap_math,
            part,
        )
    text = "".join(parts)
    # Collapse accidental doubled $$..$$ from re-wrapping adjacent tokens.
    text = re.sub(r'\${3,}', '$$', text)
    text = re.sub(r'\$\s*\$(?!\$)', '', text)

    text = _restore_matrix_blocks(text, matrix_blocks)
    return text


def normalize_question_latex(q):
    for field in ("question", "explanation"):
        if field in q and isinstance(q[field], str):
            q[field] = normalize_latex(q[field])
    if isinstance(q.get("options"), list):
        q["options"] = [normalize_latex(o) if isinstance(o, str) else o for o in q["options"]]
    return q


def format_chapter_priority(chapters, chapter_counts, target_count, generated_count):
    """Builds a human-readable, count-annotated chapter list so the model can
    see exactly which chapters are underrepresented and should be favored."""
    remaining = max(target_count - generated_count, 0)
    lines = []
    # Sort chapters by how under-used they are (ascending count) so the
    # least-covered chapters are listed first -- LLMs weight earlier items
    # more heavily in practice.
    scored = sorted(
        chapters,
        key=lambda c: chapter_counts.get(c, 0),
    )
    for c in scored:
        used = chapter_counts.get(c, 0)
        flag = " <- PRIORITIZE (least covered so far)" if used == 0 else ""
        lines.append(f"- [{used}x used] {c}{flag}")
    chapter_block = "\n".join(lines)
    return chapter_block, remaining


def build_prompt(subject, chapters, difficulty, count, chapter_counts,
                  target_count, generated_count, recent_topics):
    chapter_block, remaining = format_chapter_priority(
        chapters, chapter_counts, target_count, generated_count
    )

    recent_block = (
        "\n".join(f"- {t}" for t in recent_topics[-25:])
        if recent_topics else "(none yet)"
    )

    return f"""You are an expert item-writer generating official-style practice questions for Nepal's IOE (Institute of Engineering, Tribhuvan University) B.E./B.Arch entrance examination.

SUBJECT: {subject}
DIFFICULTY: {difficulty}
GENERATE EXACTLY: {count} multiple-choice questions

SYLLABUS COVERAGE STATUS (chapter: how many questions already generated this attempt):
{chapter_block}

This subject's overall quota for this attempt is {target_count} questions; {generated_count} have been generated so far, {remaining} remain. Favor chapters marked "PRIORITIZE" and any with low usage counts above. Do not let any single chapter dominate -- spread coverage so the finished paper is balanced across the whole syllabus, matching realistic IOE chapter-wise weightage.

SPECIFIC CONCEPTS/TOPICS ALREADY ASKED IN THIS ATTEMPT (do not repeat these, and do not generate near-duplicates or trivial numeric variations of them):
{recent_block}

STRICT RULES:
1. Only use chapters listed above. Never invent syllabus content outside them.
2. Never repeat a concept from the "already asked" list. Each question must test a genuinely distinct idea.
3. Match real IOE exam style: single-concept objective questions, testing conceptual understanding, calculation, or application, similar in tone and difficulty to past IOE entrance papers.
4. Every question must be fully self-contained and solvable from text alone (no images/diagrams/figures required).
5. Distractors (wrong options) must be plausible -- based on common calculation errors or conceptual confusions, not random or obviously wrong.
6. Keep explanations concise (1-2 sentences) but mathematically correct.
7. ALL mathematics, anywhere it appears (question, options, explanation), MUST be written in standard LaTeX. Wrap simple inline expressions in single dollar signs: $\\frac{{4}}{{7}}$, $2^{{x}}$, $\\sqrt{{x}}$, $\\theta$, $\\pi$, $\\int_0^1 x\\,dx$. Never write raw pseudo-LaTeX like "frac{{4}}{{7}}" or "sqrt(x)" without the backslash and dollar signs.
8. Matrices, determinants, and systems of equations MUST use a proper LaTeX array environment (not inline fractions or plain text), wrapped in double dollar signs as display math. Use \\begin{{vmatrix}} ... \\end{{vmatrix}} for determinants, \\begin{{pmatrix}} ... \\end{{pmatrix}} or \\begin{{bmatrix}} ... \\end{{bmatrix}} for matrices, with & separating columns and \\\\ separating rows. Example determinant: $$\\begin{{vmatrix}} 1 & a & a^{{2}} \\\\ 1 & b & b^{{2}} \\\\ 1 & c & c^{{2}} \\end{{vmatrix}}$$. Never lay out matrix rows as plain inline text.
9. Your entire reply is parsed as JSON. Every backslash inside a LaTeX command MUST be written as TWO backslashes so it survives JSON parsing as one: write "\\\\frac{{1}}{{2}}" (which parses to \\frac{{1}}{{2}}) not "\\frac{{1}}{{2}}". This applies to every command: \\\\begin, \\\\end, \\\\frac, \\\\rho, \\\\tan, \\\\theta, \\\\underline, etc. A single backslash before b, f, n, r, t, or u will corrupt your output because those are reserved JSON escape characters.
10. Return ONLY a raw JSON object -- no markdown fences, no preamble, no commentary, no trailing text.

Respond with exactly this JSON schema:
{{"questions": [{{"question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"...","chapter":"<one of the exact chapter strings listed above>","topic":"short 3-8 word label for the specific concept tested, e.g. 'projectile motion range formula'"}}]}}

Rules for the schema: options must NOT include letter prefixes like "A)". correctIndex is a 0-based index into options."""


@csrf_exempt
@require_POST
def generate_questions(request):
    try:
        body = json.loads(request.body)
        subject = body["subject"]
        chapters = body["chapters"]
        difficulty = body.get("difficulty", "Mixed")
        count = int(body.get("count", 4))
        chapter_counts = body.get("chapterCounts", {}) or {}
        target_count = int(body.get("targetCount", count))
        generated_count = int(body.get("generatedCount", 0))
        recent_topics = body.get("recentTopics", []) or []
    except (KeyError, json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid request body"}, status=400)

    prompt = build_prompt(
        subject, chapters, difficulty, count,
        chapter_counts, target_count, generated_count, recent_topics,
    )

    wait_for_rate_limit()

    try:
        response = client.chat.completions.create(
            model=MODEL,
            max_tokens=1800,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        text = response.choices[0].message.content
        cleaned = re.sub(r"```json|```", "", text).strip()
        cleaned = repair_latex_json_escapes(cleaned)
        parsed = json.loads(cleaned)
        questions = parsed["questions"] if isinstance(parsed, dict) else parsed

        for q in questions:
            q["subject"] = subject
            normalize_question_latex(q)

        return JsonResponse({"questions": questions})
    except json.JSONDecodeError:
        return JsonResponse({"error": "Model returned malformed JSON, try again"}, status=502)
    except KeyError:
        return JsonResponse({"error": "Response missing 'questions' key, try again"}, status=502)
    except Exception as e:
        # NaraRouter surfaces rate-limit errors as 429s from the underlying request
        msg = str(e)
        if "429" in msg or "rate" in msg.lower():
            return JsonResponse({"error": "Rate limited by NaraRouter — wait a moment and retry."}, status=429)
        return JsonResponse({"error": msg}, status=500)