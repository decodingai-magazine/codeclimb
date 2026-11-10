"""Model calls through the OpenAI-compatible endpoint (runtime.md, Models; models.md has a card per model).

`OPENAI_BASE_URL` and `OPENAI_API_KEY` configure the client; without them every call returns nothing
and says so once, so a stage still writes what it has. A 429, 500, 502 or 503 is retried with backoff, a 402
stops every later call (the money is spent), a 400 or 403 is not retried. Calls run concurrently
through `map`, which keeps the input order.
"""

import logging
import os
import random
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI

from .config import Config

log = logging.getLogger("graphrag.llm")

RETRIED = {429, 500, 502, 503}
TIMEOUT_S = 180


@dataclass
class Reply:
    text: str
    cut: bool
    """The reply stopped at max_tokens (`finish_reason: "length"`): usually a loop, never a long answer."""


class Client:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.spent = False
        configured = bool(os.environ.get("OPENAI_BASE_URL") and os.environ.get("OPENAI_API_KEY"))
        self._client = OpenAI(timeout=TIMEOUT_S, max_retries=0) if configured else None
        if not configured:
            log.warning("OPENAI_BASE_URL or OPENAI_API_KEY is not set: no model is called")

    @property
    def available(self) -> bool:
        return self._client is not None and not self.spent

    def _call(self, what: str, fn: Callable[[], Any]) -> Any:
        """One call with the retry policy; None when it failed for good."""
        if not self.available:
            return None
        for attempt in range(self.cfg.llm.max_retries + 1):
            try:
                return fn()
            except APIStatusError as e:
                if e.status_code == 402:
                    self.spent = True
                    log.error("%s: 402, the budget is spent; no more calls", what)
                    return None
                if e.status_code not in RETRIED or attempt == self.cfg.llm.max_retries:
                    log.error("%s: %s %s", what, e.status_code, str(e)[:200])
                    return None
            except (APIConnectionError, APITimeoutError) as e:
                if attempt == self.cfg.llm.max_retries:
                    log.error("%s: %s", what, str(e)[:200])
                    return None
            time.sleep(min(2**attempt + random.random(), 30))
        return None

    def chat_json(self, system: str, user: str) -> Reply | None:
        """The chat model's reply to a request for a JSON object; None when the call failed or came back empty."""

        def go() -> Reply | None:
            r = self._client.chat.completions.create(
                model=self.cfg.models.chat,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format={"type": "json_object"},
                temperature=0,
                seed=self.cfg.llm.seed,
                max_tokens=self.cfg.llm.max_tokens,
                extra_body={"reasoning": {"enabled": False}},
            )
            choice = r.choices[0]
            return Reply(choice.message.content, choice.finish_reason == "length") if choice.message.content else None

        return self._call("chat", go)

    def embed(self, texts: list[str], instruction: str = "") -> list[list[float]] | None:
        """One unit-length vector per text, in order, sent `cfg.llm.embed_batch` texts per call.

        `instruction` is the task line the model takes on the query side only (models.md, Embedding):
        pass it for queries, never for the documents they are compared with.
        """
        if instruction:
            texts = [f"Instruct: {instruction}\nQuery: {t}" for t in texts]
        size = max(1, self.cfg.llm.embed_batch)

        def go(batch: list[str]) -> list[list[float]]:
            r = self._client.embeddings.create(model=self.cfg.models.embedding, input=batch)
            return [d.embedding for d in sorted(r.data, key=lambda d: d.index)]

        out: list[list[float]] = []
        for i in range(0, len(texts), size):
            vectors = self._call("embeddings", lambda batch=texts[i : i + size]: go(batch))
            if vectors is None:
                return None
            out.extend(vectors)
        return out

    def rerank(self, query: str, documents: list[str], top_n: int | None = None) -> list[tuple[int, float]] | None:
        """(index into documents, relevance) best first. Scores are not probabilities: sort by them."""
        if not documents:
            return []
        body: dict[str, Any] = {"model": self.cfg.models.rerank, "query": query, "documents": documents}
        if top_n is not None:
            body["top_n"] = top_n

        def go() -> list[tuple[int, float]]:
            r = self._client.post("/rerank", body=body, cast_to=dict)
            return [(x["index"], x["relevance_score"]) for x in r["results"]]

        return self._call("rerank", go)

    def decide(self, state: str, questions: dict[str, str], false: str = "no", true: str = "yes") -> dict[str, float] | None:
        """One probability per question name, from the decisions model, in one call: `state` holds the facts.

        `false` and `true` say what each answer means ("two things", "one thing"). The probabilities
        sit close together: set every threshold on train (models.md, Decision).
        """
        if not questions:
            return {}
        body = {
            "model": self.cfg.models.decisions,
            "state": state,
            "questions": {name: {"type": "noul", "instructions": q, "criteria": {"false": false, "true": true}} for name, q in questions.items()},
        }

        def go() -> dict[str, float]:
            r = self._client.post("/decisions", body=body, cast_to=dict)
            return {name: a["noul"] for name, a in r["answers"].items()}

        return self._call("decisions", go)

    def map[T, R](self, fn: Callable[[T], R], items: Iterable[T]) -> list[R]:
        """fn over items, cfg.llm.concurrency at a time, results in input order."""
        items = list(items)
        with ThreadPoolExecutor(max_workers=max(1, self.cfg.llm.concurrency)) as pool:
            return list(pool.map(fn, items))
