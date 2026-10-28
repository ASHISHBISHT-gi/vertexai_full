from app.rag.chunking import Segment, _to_seconds, chunk_segments, chunk_transcript, parse_transcript

VTT = """WEBVTT

NOTE a comment block

1
00:00:00.000 --> 00:00:10.000
<v Teacher>Hello and welcome. Today is about sorting.</v>

00:01:20.500 --> 00:01:30.000
Quicksort picks a pivot.
It then partitions the array.
"""

SRT = """1
00:00:05,000 --> 00:00:09,000
First line of the lecture.

2
00:00:09,000 --> 00:00:12,000
Second line.
"""


def test_timestamps_in_all_formats():
    assert _to_seconds("00:01:20.000") == 80
    assert _to_seconds("01:20.000") == 80
    assert _to_seconds("00:01:20,500") == 80
    assert _to_seconds("1:02:03.000") == 3723
    assert _to_seconds("nonsense") is None


def test_webvtt_is_parsed_with_start_times_and_tags_removed():
    segs = parse_transcript(VTT)
    assert [s.start for s in segs] == [0, 80]
    assert segs[0].text == "Hello and welcome. Today is about sorting."
    assert segs[1].text == "Quicksort picks a pivot. It then partitions the array."


def test_srt_is_parsed():
    segs = parse_transcript(SRT)
    assert [(s.start, s.text) for s in segs] == [(5, "First line of the lecture."), (9, "Second line.")]


def test_plain_text_has_no_timestamps():
    segs = parse_transcript("Paragraph one.\nstill one.\n\nParagraph two.")
    assert [s.start for s in segs] == [None, None]
    assert segs[0].text == "Paragraph one. still one."


def test_empty_transcript():
    assert parse_transcript("   \n ") == []
    assert chunk_transcript("") == []


def test_short_transcript_is_one_chunk_that_remembers_where_it_starts():
    chunks = chunk_transcript(VTT)
    assert len(chunks) == 1 and chunks[0].start_seconds == 0


def test_long_transcript_is_split_with_overlap_and_start_times():
    sentences = [f"This is sentence number {i} about databases and queries." for i in range(60)]
    segs = [Segment(i * 10, " ".join(sentences[i * 6 : i * 6 + 6])) for i in range(10)]
    chunks = chunk_segments(segs, target=500, overlap=120)
    assert len(chunks) > 3
    assert all(len(c.text) <= 500 + 80 for c in chunks)
    assert [c.index for c in chunks] == list(range(len(chunks)))
    starts = [c.start_seconds for c in chunks]
    assert starts == sorted(starts) and starts[0] == 0
    # overlap: the end of one chunk is repeated at the start of the next
    tail = chunks[0].text.split(". ")[-1][:25]
    assert tail in chunks[1].text
    # nothing is lost: every sentence appears in at least one chunk
    joined = " ".join(c.text for c in chunks)
    assert all(s in joined for s in sentences)


def test_a_wall_of_text_without_punctuation_is_still_cut():
    wall = "word " * 1000
    chunks = chunk_segments([Segment(None, wall)], target=300, overlap=50)
    assert len(chunks) > 5 and all(len(c.text) <= 340 for c in chunks)
