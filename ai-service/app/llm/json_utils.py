import json
import re
from typing import Any


def extract_json(text: str) -> Any:
    """Models sometimes wrap JSON in ```json fences or add a sentence around it. Take the outermost {...}."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object found in the reply")
    return json.loads(cleaned[start : end + 1])
