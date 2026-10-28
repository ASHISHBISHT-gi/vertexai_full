"""
DEMO MODE "AI": no model, no network, no cost. It builds answers out of sentences from the transcript, so the whole
product (retrieval, citations, quizzes, UI) can be built and tested before you have API keys.
It is NOT intelligent, and every output says so.
"""
import re

from app.core.errors import AppError
from app.llm.schemas import (CardOut, Excerpt, OptionOut, PlanOut, PlanStepOut, QuestionOut, QuizOut, SummaryOut, Turn)
from app.rag.chunking import parse_transcript
from app.rag.embeddings import tokens

_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")
DEMO = "(Demo mode) "


def sentences(text: str, min_len: int = 0) -> list[str]:
    out = []
    for seg in parse_transcript(text) if "-->" in text or "\n\n" in text else []:
        out.extend(s.strip() for s in _SENTENCE.split(seg.text))
    if not out:
        out = [s.strip() for s in _SENTENCE.split(re.sub(r"\s+", " ", text))]
    return [s for s in out if len(s) >= min_len]


def key_word(sentence: str, exclude: str = "") -> str | None:
    """The longest plain word: the one we blank out in a fill-in-the-blank question."""
    words = [w for w in re.findall(r"[A-Za-z]{5,}", sentence) if w.lower() != exclude.lower()]
    return max(words, key=len) if words else None


def _spread(items: list, n: int) -> list:
    if len(items) <= n:
        return items
    step = len(items) / n
    return [items[int(i * step)] for i in range(n)]


class FakeLLM:
    name = "fake"
    is_demo = True

    async def answer(self, *, course_title: str, question: str, excerpts: list[Excerpt], history: list[Turn], level: str) -> str:
        q = set(tokens(question))
        scored = []
        for ex in excerpts:
            for sent in sentences(ex.text):
                overlap = len(q & set(tokens(sent)))
                if overlap:
                    scored.append((overlap, ex.ref, sent))
        if not scored:
            return DEMO + "I couldn't find that in this course's material. Try rephrasing the question, or look through the lecture list for the right topic."
        scored.sort(key=lambda t: (-t[0], t[1]))
        picked, seen = [], set()
        for _, ref, sent in scored:
            if sent not in seen:
                seen.add(sent)
                picked.append(f"{sent} [{ref}]")
            if len(picked) == 2:
                break
        lead = {"beginner": "In simple terms: ", "advanced": "Precisely: "}.get(level, "")
        return DEMO + lead + " ".join(picked)

    async def summarize(self, *, title: str, transcript: str, level: str) -> SummaryOut:
        sents = sentences(transcript, 25)
        if not sents:
            raise AppError(422, "TRANSCRIPT_TOO_SHORT", "This lecture's transcript is too short to summarise.")
        points = _spread(sents, 5)
        return SummaryOut(summary=DEMO + "Extracted from the transcript, not written by an AI: " + " ".join(sents[:2]), key_points=points)

    async def make_quiz(self, *, lecture_title: str, transcript: str, count: int, difficulty: str) -> QuizOut:
        picks = [s for s in sentences(transcript, 45) if key_word(s)]
        if len(picks) < 2:
            raise AppError(422, "TRANSCRIPT_TOO_SHORT", "This lecture's transcript is too short to build a quiz from.")
        chosen = _spread(picks, count)
        words = [key_word(s) for s in chosen]
        questions = []
        for i, (sent, word) in enumerate(zip(chosen, words, strict=True)):
            blank = sent.replace(word, "_____", 1)
            if i % 3 == 0:  # every third question is multiple choice, the rest are fill-in-the-blank
                others = [w for w in dict.fromkeys(w for w in words if w != word)][:3]
                options = [OptionOut(option_text=w, is_correct=False) for w in others]
                options.insert(i % (len(options) + 1), OptionOut(option_text=word, is_correct=True))
                questions.append(QuestionOut(question_text=f"Which word completes this sentence from the lecture? {blank}", question_type="mcq", options=options))
            else:
                questions.append(QuestionOut(question_text=f"Fill in the blank: {blank}", question_type="short_answer", accepted_answers=[word.lower()]))
        return QuizOut(title=f"Draft quiz: {lecture_title} (demo)", questions=questions)

    async def make_flashcards(self, *, module_title: str, material: list[tuple[str, str]], count: int) -> list[CardOut]:
        picks = [s for _, text in material for s in sentences(text, 45) if key_word(s)]
        cards = []
        for sent in _spread(picks, count):
            word = key_word(sent)
            cards.append(CardOut(question="Fill in the blank: " + sent.replace(word, "_____", 1), answer=word))
        if not cards:
            raise AppError(422, "TRANSCRIPT_TOO_SHORT", "There isn't enough transcript text in this module to make flashcards.")
        return cards

    async def make_study_plan(self, *, facts: dict) -> PlanOut:
        modules = facts["modules"]

        def priority(m: dict) -> float:
            if m["mastery"] is not None:
                return m["mastery"]
            return 60.0 if m["lectures_completed"] < m["lectures_total"] else 100.0

        steps = []
        for m in sorted(modules, key=priority):
            unfinished = m["lectures_total"] - m["lectures_completed"]
            if m["mastery"] is not None and m["mastery"] < 70:
                why, action, minutes = f"Your quiz mastery here is {round(m['mastery'])}%, your weakest area.", "Rewatch the lectures, then retake the quiz.", 40
            elif unfinished:
                why, action, minutes = f"You still have {unfinished} unfinished lecture(s) here.", "Finish the remaining lectures.", 25 * unfinished
            else:
                continue
            steps.append(PlanStepOut(title=f"Work on {m['title']}"[:80], why=why, action=action, estimated_minutes=min(minutes, 240), module_id=m["module_id"]))
            if len(steps) == 4:
                break
        for a in facts.get("upcoming_assignments", [])[:2]:
            steps.append(PlanStepOut(title=f"Submit {a['title']}"[:80], why=f"It's due {a['due_date']}.", action="Finish your work and upload it.", estimated_minutes=60, module_id=None))
        if not steps:
            steps.append(PlanStepOut(title="Check what you know", why="Everything is finished and no quiz shows a weak spot.", action="Retake a quiz to confirm your mastery.", estimated_minutes=20, module_id=None))
        summary = f"{DEMO}You're {round(facts['progress_percent'])}% through {facts['course']}. This plan comes from simple rules, not an AI."
        return PlanOut(summary=summary, steps=steps[:6])
