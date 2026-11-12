"""Settings, read once from config.toml at the repository root (or the file GRAPHRAG_CONFIG names)."""

import os
import tomllib
from pathlib import Path

from pydantic import BaseModel, ConfigDict

ROOT = Path(__file__).resolve().parent.parent
"""The repository root, where config.toml and fewshot.json live."""


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Models(Strict):
    chat: str
    decisions: str
    embedding: str
    rerank: str


class Llm(Strict):
    concurrency: int = 8
    max_retries: int = 4
    max_tokens: int = 8000
    seed: int = 0
    embed_batch: int = 256


class Extraction(Strict):
    section_max_chars: int = 6000
    canon_per_type: int = 40
    max_rows_per_reply: int = 60
    critic: bool = False
    seed_labels: list[str] = []


class Retrieval(Strict):
    max_nodes: int = 10
    max_edges: int = 10
    max_docs: int = 5
    max_hops: int = 3


class Config(Strict):
    models: Models
    llm: Llm = Llm()
    extraction: Extraction = Extraction()
    retrieval: Retrieval = Retrieval()


def load() -> Config:
    path = Path(os.environ.get("GRAPHRAG_CONFIG") or ROOT / "config.toml")
    with path.open("rb") as f:
        return Config.model_validate(tomllib.load(f))
