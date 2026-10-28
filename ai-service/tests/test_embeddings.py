import httpx
import pytest

from app.core.config import EMBEDDING_DIMENSIONS, Settings
from app.core.errors import AppError
from app.rag import embeddings
from app.rag.embeddings import FakeEmbedder, OpenAIEmbedder, VoyageEmbedder, to_pgvector


def cosine(a, b):
    return sum(x * y for x, y in zip(a, b, strict=True))


async def test_fake_embedder_similar_text_is_closer():
    e = FakeEmbedder()
    q = await e.embed_query("How does a LEFT JOIN work?")
    docs = await e.embed_documents(["A LEFT JOIN keeps every row from the left table.", "Merge sort splits the array in half and merges."])
    assert len(q) == EMBEDDING_DIMENSIONS
    assert cosine(q, docs[0]) > cosine(q, docs[1]) + 0.1
    assert abs(cosine(docs[0], docs[0]) - 1) < 1e-6  # unit length


async def test_fake_embedder_handles_empty_text():
    vec = await FakeEmbedder().embed_query("the of and")
    assert len(vec) == EMBEDDING_DIMENSIONS and any(vec)


def test_pgvector_literal_format():
    assert to_pgvector([0.5, -1, 0]) == "[0.500000,-1.000000,0.000000]"


def settings(**kw) -> Settings:
    base = dict(database_url="postgresql://x/x", jwt_access_secret="s" * 32, embedding_api_key="key")
    return Settings(**{**base, **kw})


@pytest.fixture
def mock_http(monkeypatch):
    """Replace the real internet with a function we control, and record what was sent."""
    sent: list[httpx.Request] = []
    state = {"handler": None}
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return state["handler"](request)

    monkeypatch.setattr(embeddings.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    return sent, state


def vectors(n: int, dim: int = EMBEDDING_DIMENSIONS):
    # returned out of order on purpose: the client must sort by "index"
    return {"data": [{"index": i, "embedding": [float(i)] * dim} for i in reversed(range(n))]}


async def test_voyage_request_shape_and_response_ordering(mock_http):
    sent, state = mock_http
    state["handler"] = lambda req: httpx.Response(200, json=vectors(len(__import__("json").loads(req.content)["input"])))
    emb = VoyageEmbedder(settings(embedding_provider="voyage"))
    out = await emb.embed_documents(["a", "b", "c"])
    assert [v[0] for v in out] == [0.0, 1.0, 2.0]
    body = __import__("json").loads(sent[0].content)
    assert str(sent[0].url) == "https://api.voyageai.com/v1/embeddings"
    assert sent[0].headers["authorization"] == "Bearer key"
    assert body == {"input": ["a", "b", "c"], "model": "voyage-4", "input_type": "document", "output_dimension": 1024}
    await emb.embed_query("q")
    assert __import__("json").loads(sent[1].content)["input_type"] == "query"


async def test_large_inputs_are_sent_in_batches(mock_http):
    sent, state = mock_http
    state["handler"] = lambda req: httpx.Response(200, json=vectors(len(__import__("json").loads(req.content)["input"])))
    out = await VoyageEmbedder(settings(embedding_provider="voyage")).embed_documents([f"t{i}" for i in range(150)])
    assert len(out) == 150 and len(sent) == 3  # 64 + 64 + 22


async def test_wrong_vector_size_is_a_clear_error(mock_http):
    _, state = mock_http
    state["handler"] = lambda req: httpx.Response(200, json=vectors(1, dim=384))
    with pytest.raises(AppError) as err:
        await VoyageEmbedder(settings(embedding_provider="voyage")).embed_query("x")
    assert err.value.code == "EMBEDDING_DIMENSION_MISMATCH" and "1024" in err.value.message


async def test_wrong_number_of_vectors_is_reported_as_such(mock_http):
    _, state = mock_http
    state["handler"] = lambda req: httpx.Response(200, json=vectors(1))
    with pytest.raises(AppError) as err:
        await VoyageEmbedder(settings(embedding_provider="voyage")).embed_documents(["a", "b"])
    assert err.value.code == "EMBEDDING_ERROR" and "1 vectors for 2 texts" in err.value.message


@pytest.mark.parametrize("status,code", [(401, "EMBEDDING_AUTH"), (403, "EMBEDDING_AUTH"), (429, "EMBEDDING_BUSY"), (500, "EMBEDDING_ERROR")])
async def test_provider_errors_become_friendly_errors(mock_http, status, code):
    _, state = mock_http
    state["handler"] = lambda req: httpx.Response(status, json={"detail": "nope"})
    with pytest.raises(AppError) as err:
        await VoyageEmbedder(settings(embedding_provider="voyage")).embed_query("x")
    assert err.value.code == code
    assert "key" not in err.value.message.lower() or code == "EMBEDDING_AUTH"  # never echo secrets


async def test_network_failure_is_a_friendly_error(mock_http):
    _, state = mock_http

    def boom(req):
        raise httpx.ConnectError("no route")

    state["handler"] = boom
    with pytest.raises(AppError) as err:
        await VoyageEmbedder(settings(embedding_provider="voyage")).embed_query("x")
    assert err.value.code == "EMBEDDING_UNAVAILABLE"


async def test_openai_sends_dimensions_but_custom_servers_do_not(mock_http):
    sent, state = mock_http
    state["handler"] = lambda req: httpx.Response(200, json=vectors(1))
    await OpenAIEmbedder(settings(embedding_provider="openai")).embed_query("x")
    body = __import__("json").loads(sent[0].content)
    assert str(sent[0].url) == "https://api.openai.com/v1/embeddings"
    assert body == {"input": ["x"], "model": "text-embedding-3-small", "dimensions": 1024}

    await OpenAIEmbedder(settings(embedding_provider="openai", embedding_base_url="http://localhost:11434/v1", embedding_model="mxbai-embed-large")).embed_query("x")
    body = __import__("json").loads(sent[1].content)
    assert str(sent[1].url) == "http://localhost:11434/v1/embeddings" and "dimensions" not in body


def test_real_providers_require_a_key():
    with pytest.raises(ValueError, match="EMBEDDING_API_KEY"):
        Settings(database_url="postgresql://x/x", jwt_access_secret="s" * 32, embedding_provider="voyage")
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        Settings(database_url="postgresql://x/x", jwt_access_secret="s" * 32, llm_provider="anthropic")
