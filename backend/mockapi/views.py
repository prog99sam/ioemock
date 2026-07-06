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
    api_key = os.getenv("NARAROUTER_API_KEY"),
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


def build_prompt(subject, chapters, difficulty, count):
    chapter_list = "\n".join(f"- {c}" for c in chapters)
    return f"""You are generating official-style practice questions for Nepal's IOE (Institute of Engineering, Tribhuvan University) B.E./B.Arch entrance examination.

Generate exactly {count} multiple-choice questions for the subject: {subject}.
Difficulty level: {difficulty}.

Draw ONLY from these syllabus chapters for {subject} (spread questions across different chapters, don't repeat the same narrow sub-topic):
{chapter_list}

Match the real IOE exam style: single-mark objective questions, moderate length, testing conceptual understanding and calculation, similar to past IOE entrance papers. Every question must be fully self-contained and solvable from text alone (no images or diagrams required).

Respond with ONLY a raw JSON object and nothing else — no markdown fences, no preamble, no commentary. Exact schema:
{{"questions": [{{"question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"one or two sentence explanation of the correct answer","chapter":"which chapter above this question is from"}}]}}

Rules: options must NOT include letter prefixes like "A)". correctIndex is a 0-based index into options. Keep explanations concise."""


@csrf_exempt
@require_POST
def generate_questions(request):
    try:
        body = json.loads(request.body)
        subject = body["subject"]
        chapters = body["chapters"]
        difficulty = body.get("difficulty", "Mixed")
        count = int(body.get("count", 4))
    except (KeyError, json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid request body"}, status=400)

    prompt = build_prompt(subject, chapters, difficulty, count)

    wait_for_rate_limit()

    try:
        response = client.chat.completions.create(
            model=MODEL,
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        text = response.choices[0].message.content
        cleaned = re.sub(r"```json|```", "", text).strip()
        parsed = json.loads(cleaned)
        questions = parsed["questions"] if isinstance(parsed, dict) else parsed

        for q in questions:
            q["subject"] = subject

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