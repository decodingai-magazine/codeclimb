# Ontology

The rules the gold extractions and the gold graph follow. Build to this spec. Anything it doesn't
cover (chunking, embeddings, storage, how you resolve) is yours to design.

## Document

One per file in `corpus/`. `title`, `published`, `author` and `type` come from the frontmatter
(`published` keeps only the date, `YYYY-MM-DD`), `uri` is its `source_url`; `origin_id`,
`origin_kind`, `length` and `domain` are derived.

| field | meaning |
|---|---|
| `uri` | the `source_url`, used as the document's identity |
| `title`, `published`, `author`, `type` | frontmatter |
| `origin_id`, `origin_kind` | the normalized host (`decodingai.com`) and the kind of source (`newsletter`) |
| `length` | character count of the original article, before sponsor, promo and trailer sections were removed (not the frontmatter's `length`) |
| `domain` | in the gold only (the prediction schema has no row for it): zero to two ordered labels for the field the document belongs to, in lowercase snake_case (`ai_engineering`, `career`) |

## Entity

| field | meaning |
|---|---|
| `name` | the canonical label: the surface the corpus uses, taken from the first document that names it. A later document may write it differently (an alias, an acronym, an inflection); when a document describes a method or system without naming it, a short descriptive label is used |
| `type` | one of the six types below |
| `aliases` | other surfaces of the same referent (see Identity) |
| `description` | one sentence on what the entity is, in the document's own words, or `null` when the document never says. An entity keeps its earliest non-null description. |
| `properties` | only the keys the entity's type declares (see Types); an entity keeps the earliest non-null value of each key |

### Types

| type | test | properties | examples | not this type |
|---|---|---|---|---|
| `person` | a named human | `country: string?` | Andrej Karpathy | the author's "I" or byline (not extracted) |
| `organization` | a company, lab, team or publication that ships models, tools, research or writing | `country: string?` | Anthropic, OpenAI, Google, Lumen Weekly (*invented*) | a product carrying the company's name (`Kestrel` (*invented*) the product is a `tool`; `Kestrel, Inc.` is the `organization`) |
| `model` | named weights you call: a specific LLM, VLM, embedding or speech model | `country: string?`, `released: date?` | Gemini, gemini-2.5-flash | a model class (large language models is a `method`) |
| `tool` | a piece of software with a proper name, from a service (Claude Code) to an IDE (Cursor) to a library (Pydantic): an application, service, library, framework, protocol or language, plus named hardware | `released: date?` | Claude Code, Cursor, Pydantic, MCP, Python, LangGraph | `google_search`, `create_agent`, Plan-and-Execute's `Planner`, Opik's `Agent Optimization`, `AI Agents Foundations series` (none extracted, see Not a tool) |
| `method` | a practice you apply, avoid, measure or suffer: a technique, architecture pattern, model class, benchmark, metric, dataset, attack, anti-pattern or failure mode | `released: date?` | ReAct, prompt engineering, LLM, tool confusion, hallucination, structured outputs | a kind of software you ship (coding agent is a `system`) |
| `system` | a kind of software you ship, never a proper name; you could write "build our X" in a job post | none | coding agent, deep research agent, LLM-as-judge, LLMOps platform | a company's named product (Nova is a `tool`) |

`?` means nullable. A type's properties are always present, as `null` when unknown, and no other
key appears.

- `country` is an ISO 3166-1 alpha-2 code, and the one value that may come from outside knowledge:
  - organization: where it is headquartered (`US` for Anthropic);
  - person: where they are based;
  - model: where its developer is headquartered (`US` for Gemini).
- `released` is a date string for the first public release: `YYYY-MM-DD`, or `YYYY-MM` / `YYYY` at the
  precision the document gives. It is filled only when the document states it, and on a `method`
  only for a benchmark or a dataset. It is `null` everywhere in this corpus.

Apply the tests in order: a human is a `person`; a body that makes things is an `organization`;
specific named weights are a `model`; a named piece of software is a `tool` (see Not a tool). Otherwise,
the thing you ship is a `system` and the practice that serves it is a `method`.

- A model class (large language models, reasoning LLMs) is a `method`; only named weights are a `model`.
- A company's named product is never a `system`. The product and the class it belongs to are two
  entities joined by a `related_to` relationship ("Opik instance_of LLMOps platform").
- A component you would not capitalise (`orchestrator`, `workflow router`) is never a `tool`.
- A limit or mechanism of a model (hallucination) is a `method`.
- When a product carries its company's name (`Kestrel`, *invented*), it is a `tool`, unless the document
  has the company itself act (raise money, hire, acquire, publish): then it is the company
  (`Kestrel, Inc.`, with `Kestrel` as an alias).

### Not a tool

A `tool` is a piece of software you could install, open or sign up for. Each row below names
something that looks like a tool and is not one: it is never extracted, under any type. Extract the
thing in the last column instead, when the document engages with it. The rows name instances: the
general class can still be an entity when the document engages with it (`tool` is a `system`
entity, `tool calling` is a `method`). Names marked *invented* are made up for this table; the
others come from the corpus.

| not a tool | never extracted | extract instead |
|---|---|---|
| a tool an agent calls: a function exposed to a model through tool calling | `google_search`, `grep`, `read`, `fetch_wikipedia_content`, `perplexity_search` | the software it wraps (`Wikipedia`, `Perplexity`); the practice is a `method` (`tool calling`) |
| a code symbol: function, class, constant, environment variable, error, API operator | `create_agent`, `StateGraph`, `ToolNode`, `TypedDict` | the library it belongs to (`LangGraph`, `Python`) |
| an agent role inside a system or pattern | `ReportWriter` and `FactChecker` (*invented*) | the named agent product (`Claude Code`, `Nova`), the class of agent, a `system` (`coding agent`, `research agent`), or the pattern, a `method` (`Plan-and-Execute`) |
| a file | `agent_config.yaml` (*invented*) | the software that reads it |
| a command of a CLI or app | `make deploy`, `/publish-report` (*invented*) | the software it belongs to |
| a script, hook or skill | `nightly-backup.sh` (*invented*) | the software that runs it; a plugin you install is a `tool` |
| a feature of a product | Opik's `Agent Optimization`, `Lumen Weekly chat` (*invented*) | the product (`Opik`, `Lumen Weekly`); a mechanism it runs is a `method` |
| an internal component of a system | `Billing Worker` (*invented*) | the product |
| a course, book or article series | `AI Agents Foundations series` | the publication, an `organization` (`Lumen Weekly`, *invented*) |

## Relationships

The graph has two kinds of node, documents and entities, connected by two kinds of relationship.
Each relationship belongs to the one document it was read from:

| relationship | from → to | meaning |
|---|---|---|
| `mentions` | document → entity | the document engages with the entity (see What is extracted); carries `count` |
| `related_to` | entity → entity | a directed claim the document makes about two of its entities |

### `related_to`

A claim the document itself makes, read as a sentence from source to target: "Anthropic
develops Claude Code". Background knowledge does not count, even when true.

| field | meaning |
|---|---|
| `source`, `target` | two entities mentioned in the same document, in the direction the claim reads |
| `semantic_type` | what the claim says, free-form lowercase snake_case: `uses`, `used_for`, `part_of`, `develops`, `compared_with`. The types at either end carry most of the meaning |
| `doc_uri` | the document that makes the claim |

- **One spelling per claim.** A label already in use is reused rather than reworded:
  `applied_to`, never `applies_to` beside it. A different claim keeps its own label: `applies`
  (an actor applies a practice) is not `applied_to` (a practice applied to a target).
- **Never across documents.** Two documents making the same claim give two relationships, so every claim
  keeps its source.
- **Two different entities.** A claim whose two ends are one entity (`RAG uses Retrieval-Augmented
  Generation`, one entity under two names) is not a relationship.

## What is extracted

- **Body only.** The text after the frontmatter in each `corpus/` file. Sponsor, promo and
  trailer sections are already removed.
- **Engagement.** An entity is extracted only when the document explains it, uses it, builds
  with it, compares it or takes a position on it. A name that appears only in a list, a link, a
  citation, an aside, adoption copy ("used by Acme and Globex"), a course, book or series plug, an
  image credit, or sample data inside an example (an invented "Alice ordered 3 pizzas" in a parsing
  demo) is not extracted.
  A byline or the author's "I" is not a mention of the author.
- **The corpus's own subject is extracted too.** AI agents and LLMs are never skipped.
- **No frequency floor.** An entity named once is still extracted. Each mention carries `count`,
  the number of times the body names it (by name or any alias).

## Identity

One entity per referent. Two surfaces are the same entity only when they denote the same thing.

**An alias** is another surface of the same referent:
- an acronym and its expansion of the whole name (`LLM` and `Large Language Model`);
- a spelling or inflection variant (`workflow` and `workflows`, `JSON Schema` and `JSON schema`);
- a package, repo, file or model id for the same thing (`google-genai` and `google.genai` on `Gemini SDK`);
- a shorthand the corpus uses for one referent (`orchestrator agent` for `orchestrator`, `agent` for
  `AI agents`): in this corpus a bare "agent" always means an AI agent.

**Not an alias.** These become a second entity, joined by a `related_to` relationship:
- a version or family member: `gemini-1.5-flash` vs `gemini-2.5-flash`;
- a parent, child, broader or narrower term: `LLM` on `reasoning LLMs`, `research agent` on
  `Wikipedia research agent`;
- a general word on a qualified name, even when one document uses it as shorthand, when the word
  also names the broader thing elsewhere: `workflow` on `AI workflow` (the corpus also writes about
  workflows that aren't AI workflows, a `workflow` entity of its own);
- the artifact or act a practice produces: `tool calls` (the request a model emits) vs `tool
  calling` (the practice);
- a surface the document also uses for something else.

**Type is part of identity.** The same string under two types is two entities: `Kestrel` the `tool`
and `Kestrel` the `organization` (`Kestrel, Inc.`), both *invented*. The same referent never carries two types.

**Similar spelling is not identity.** `Gemini` (the model), `Gemini API`, `Gemini CLI` and `Gemini
SDK` share a word and are four entities; two names that differ only in punctuation can be two
entities too.
