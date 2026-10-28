"""The real-Claude client, tested against a pretend Anthropic server (no key, no network)."""
import json

import pytest

try:  # anthropic >= 1.0 ships its own HTTP client library
    import httpx2 as httpx
except ImportError:  # older SDKs use plain httpx
    import httpx

from app.core.config import Settings
from app.core.errors import AppError
from app.llm.claude import ClaudeLLM
from app.llm.schemas import Excerpt, Turn

QUIZ = {
    "title": "Joins quiz",
    "questions": [{"question_text": "Which join keeps unmatched rows?", "question_type": "mcq", "points": 1,
                   "options": [{"option_text": "LEFT JOIN", "is_correct": True}, {"option_text": "INNER JOIN", "is_correct": False}]}],
}


def message(*blocks, stop="end_turn"):
    return {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-haiku-5-5", "content": list(blocks),
            "stop_reason": stop, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 5}}


def text(t):
    return {"type": "text", "text": t}


def make(responses):
    """A ClaudeLLM wired to a fake server that replies with `responses` in order, recording every request."""
    s = Settings(database_url="postgresql://x/x", jwt_access_secret="s" * 32, llm_provider="anthropic", anthropic_api_key="k")
    requests: list[dict] = []
    queue = list(responses)

    def handler(req: httpx.Request) -> httpx.Response:
        requests.append(json.loads(req.content))
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        status, body = item if isinstance(item, tuple) else (200, item)
        return httpx.Response(status, json=body)

    llm = ClaudeLLM(s).with_http_client(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return llm, requests


EXCERPTS = [Excerpt(ref=1, lecture_title="LEFT JOIN", start_seconds=75, text="A LEFT JOIN keeps every row from the left table.")]


async def test_chat_request_shape_and_thinking_blocks_are_ignored():
    llm, requests = make([message({"type": "thinking", "thinking": "let me think", "signature": "sig"}, text("It keeps all left rows [1]."))])
    reply = await llm.answer(course_title="SQL", question="What does LEFT JOIN do?", excerpts=EXCERPTS,
                             history=[Turn(role="user", content="hi"), Turn(role="assistant", content="hello")], level="beginner")
    assert reply == "It keeps all left rows [1]."
    body = requests[0]
    assert body["model"] == "claude-haiku-5-5" and body["max_tokens"] == 3000
    for banned in ("temperature", "top_p", "top_k"):
        assert banned not in body  # Haiku 5.5 rejects sampling parameters
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user"]
    assert body["messages"][-1]["role"] == "user"  # no assistant "prefill": also rejected by newer models
    assert "ONLY the course excerpts" in body["system"] and "beginner" in body["system"]
    last = body["messages"][-1]["content"]
    assert "<excerpts>" in last and '[1] (Lecture: "LEFT JOIN", at 1:15)' in last and "What does LEFT JOIN do?" in last


async def test_generation_uses_the_stronger_model_and_parses_json_in_fences():
    llm, requests = make([message(text("Here you go:\n```json\n" + json.dumps(QUIZ) + "\n```"))])
    quiz = await llm.make_quiz(lecture_title="LEFT JOIN", transcript="WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nA LEFT JOIN keeps rows.", count=1, difficulty="easy")
    assert quiz.questions[0].options[0].option_text == "LEFT JOIN"
    assert requests[0]["model"] == "claude-sonnet-5-5" and "exactly 1 questions" in requests[0]["system"]
    assert "<transcript" in requests[0]["messages"][0]["content"] and "00:00:00" not in requests[0]["messages"][0]["content"]  # timestamps stripped


async def test_invalid_json_is_retried_once_with_the_error_explained():
    bad = {**QUIZ, "questions": [{**QUIZ["questions"][0], "options": [{"option_text": "a", "is_correct": True}, {"option_text": "b", "is_correct": True}]}]}
    llm, requests = make([message(text(json.dumps(bad))), message(text(json.dumps(QUIZ)))])
    quiz = await llm.make_quiz(lecture_title="t", transcript="Some transcript text here.", count=1, difficulty="easy")
    assert quiz.title == "Joins quiz" and len(requests) == 2
    retry = requests[1]["messages"]
    assert [m["role"] for m in retry] == ["user", "assistant", "user"]
    assert "exactly 1 correct option" in retry[2]["content"]


async def test_giving_up_after_two_bad_answers():
    llm, requests = make([message(text("not json at all")), message(text("still not json"))])
    with pytest.raises(AppError) as err:
        await llm.summarize(title="t", transcript="Some transcript text.", level="intermediate")
    assert err.value.code == "AI_BAD_OUTPUT" and len(requests) == 2


@pytest.mark.parametrize("status,code", [(401, "AI_AUTH"), (403, "AI_AUTH"), (404, "AI_MODEL"), (429, "AI_BUSY"), (529, "AI_BUSY"), (500, "AI_ERROR")])
async def test_api_errors_become_friendly_errors(status, code):
    body = {"type": "error", "error": {"type": "api_error", "message": "boom sk-ant-secret"}}
    llm, _ = make([(status, body)])
    with pytest.raises(AppError) as err:
        await llm.answer(course_title="c", question="q", excerpts=EXCERPTS, history=[], level="intermediate")
    assert err.value.code == code and "sk-ant" not in err.value.message


async def test_network_failure():
    llm, _ = make([httpx.ConnectError("offline")])
    with pytest.raises(AppError) as err:
        await llm.answer(course_title="c", question="q", excerpts=EXCERPTS, history=[], level="intermediate")
    assert err.value.code == "AI_UNAVAILABLE"


async def test_reply_with_only_thinking_and_max_tokens_is_explained():
    llm, _ = make([message({"type": "thinking", "thinking": "...", "signature": "s"}, stop="max_tokens")])
    with pytest.raises(AppError) as err:
        await llm.answer(course_title="c", question="q", excerpts=EXCERPTS, history=[], level="intermediate")
    assert err.value.code == "AI_EMPTY" and "thinking" in err.value.message
