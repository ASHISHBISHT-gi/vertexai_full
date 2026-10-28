"""
Step 1 of RAG: cut a transcript into passages.

Why not embed the whole transcript? An embedding is ONE vector describing the *overall* meaning of a text.
A 20-minute lecture covers many topics, so its single vector is a blur that matches nothing well.
Small passages (a few sentences) each have a clear meaning, so a question can find exactly the right one.
We also remember when each passage starts, so the tutor can point to a moment in the video.
"""
import re
from dataclasses import dataclass

TARGET_CHARS = 900   # about 150-200 words per passage
OVERLAP_CHARS = 150  # the end of one passage is repeated at the start of the next, so ideas aren't cut in half

_TIMESTAMP = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")


@dataclass
class Segment:
    start: int | None  # seconds into the video, if the transcript had timestamps
    text: str


@dataclass
class Chunk:
    index: int
    text: str
    start_seconds: int | None


def _to_seconds(stamp: str) -> int | None:
    """'00:01:20.000' and '01:20.000' and SRT's '00:01:20,000' all mean 80 seconds."""
    m = _TIMESTAMP.fullmatch(stamp.strip())
    if not m:
        return None
    hours, minutes, seconds = int(m.group(1) or 0), int(m.group(2)), int(m.group(3))
    return hours * 3600 + minutes * 60 + seconds


def parse_transcript(raw: str) -> list[Segment]:
    """Understands WebVTT and SRT subtitle files (with timestamps) as well as plain pasted text."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return []

    if "-->" not in text:  # plain text: one segment per paragraph, no timestamps
        return [Segment(None, re.sub(r"\s+", " ", p).strip()) for p in re.split(r"\n\s*\n", text) if p.strip()]

    segments: list[Segment] = []
    for block in re.split(r"\n\s*\n", text):
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        arrow = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if arrow is None:  # the WEBVTT header, NOTE blocks...
            continue
        start = _to_seconds(lines[arrow].split("-->")[0])
        body = " ".join(lines[arrow + 1 :])
        body = re.sub(r"<[^>]+>", "", body)  # remove tags like <v Speaker> or <i>
        body = re.sub(r"\s+", " ", body).strip()
        if body:
            segments.append(Segment(start, body))
    return segments


def _split_long(sentence: str, limit: int) -> list[str]:
    """A "sentence" with no punctuation at all (auto-captions!) still has to be cut somewhere."""
    if len(sentence) <= limit:
        return [sentence]
    words, parts, current = sentence.split(), [], ""
    for w in words:
        if current and len(current) + 1 + len(w) > limit:
            parts.append(current)
            current = w
        else:
            current = f"{current} {w}".strip()
    if current:
        parts.append(current)
    return parts


def chunk_segments(segments: list[Segment], target: int = TARGET_CHARS, overlap: int = OVERLAP_CHARS) -> list[Chunk]:
    units: list[tuple[str, int | None]] = []  # (sentence, start second)
    for seg in segments:
        for sentence in _SENTENCE_END.split(seg.text):
            for piece in _split_long(sentence.strip(), target):
                if piece:
                    units.append((piece, seg.start))

    chunks: list[Chunk] = []
    current: list[tuple[str, int | None]] = []
    size = 0
    for unit in units:
        if current and size + len(unit[0]) + 1 > target:
            chunks.append(Chunk(len(chunks), " ".join(s for s, _ in current), current[0][1]))
            # start the next passage with the last sentence(s) of this one
            carry: list[tuple[str, int | None]] = []
            carried = 0
            for u in reversed(current):
                if carried + len(u[0]) > overlap and carry:
                    break
                if len(u[0]) > 2 * overlap:  # too long to repeat; just start fresh
                    break
                carry.insert(0, u)
                carried += len(u[0]) + 1
            current, size = carry, carried
        current.append(unit)
        size += len(unit[0]) + 1
    if current:
        text = " ".join(s for s, _ in current)
        if not chunks or text != chunks[-1].text:
            chunks.append(Chunk(len(chunks), text, current[0][1]))
    return chunks


def chunk_transcript(raw: str) -> list[Chunk]:
    return chunk_segments(parse_transcript(raw))
