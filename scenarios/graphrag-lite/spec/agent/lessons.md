# What earlier attempts learned

Earlier attempts built this system from an empty starter. What they learned while building it is
below, so you don't spend a round finding it again. The starter you get already holds some of it:
extraction by section, the critic switch, the row cap and the split of a looping reply. Each line is
a lesson, not a rule: when your train measurement disagrees, trust the measurement and say so in
your notes.

## Worked

- Graph building by name key, alias key and acronym, with no model, was enough; no attempt improved
  on it with a model. The starter has the first two; an acronym step goes behind its nominations
  hook.
- An entity critic after extraction, as a chat call that keeps, drops or retypes each row against
  the Engagement and Not-a-tool rules, was the one mention change that kept helping
  (`extraction.critic`).
- One type per name key across a document's sections, and dropping names that are a single
  code-style identifier (an agent class, a function), raised mention precision. Without such a rule,
  a prompt edit that resampled every extraction call let in many more code class and function names
  typed tool or system, and dev mention precision fell well past the noise.
- Extracting by section raised mention recall. What it cost in precision came from looping replies,
  code symbols, agent roles and generic words, which dropping looping replies, the critic and the
  identifier rule remove. Without them, section windows lost more precision than they gained recall,
  and a decision-model engagement filter recovered none of it at any threshold.
- Retrieval: reranking two-hop path candidates, and expanding through a bridge node (far end of the
  best anchor edges, its own edges reranked) raised multi-hop. Splicing bridge edges into fixed
  slots pushed single-hop answer edges past the top 5; keeping the top anchor edges fixed and
  merging bridge edges in by rerank score kept single-hop intact. A decision-model check handled
  unanswerable queries.
- The chat model sometimes returned a document's entities with no relations at all, on every run. A
  follow-up call asking for that document's relations, sent only when the first reply has none,
  fixed it.

## Failed, more than once

- Relation filters of every kind: an evidence sentence or span per claim, both ends in one sentence
  or within a few sentences, a minimum mention count per end, a cap per source, a decision-model
  verifier, gate or direction check. Each cost more recall than it bought in precision, or did
  nothing; the decision model cannot tell a stated claim from co-occurrence.
- Extra passes that ask for more: "what did you miss", relation gleaning, a separate relation pass
  over the final entity list, a relation pass per section unioned with the first, co-occurring
  entity pairs checked by the decision model. The claims they add run far below the first call's
  precision, so relation F1 stays flat or falls.
- Prompts framed around the article's main subject ("what is this article about", "hub first",
  "attach claims to the central entity"). They link the subject to everything near it.
- Direction rules and inverse-label maps in the prompt. Reversed claims went up, not down, or a
  train gain vanished on dev. An inverse-label map in code never fires when the prompt fixes the
  label vocabulary. Reversed claims are a small error group either way.
- The decision model as an entity filter. It ranks core methods below junk, drops named tools,
  models and organizations an article compares or uses briefly, and passes code symbols. Exempting
  person, organization, model and tool rows and filtering only method and system rows raised dev
  mention recall, but let in organizations and CLI programs named in passing.
- A count or frequency floor, or a count target or cap per document ("20-30 entities"). It fits
  train's sparse gold and under-extracts everywhere else.
- A document character cap. What it cuts is never extracted.
- One type per name across the corpus. Within one document, one type per key is right.
- A second or swapped few-shot document, gold relations shown as text, reasoning on (a small mention
  gain, a larger relation loss), voting over seeds, sampling above temperature 0.

## The lever for relations

- Most missed relations lack an end: extraction never produced one of the two entities, most often a
  method or a system. Fixing direction or labels is small next to that. Raise relation F1 through
  mention recall for those types and by cutting fan-out, not by filtering claims. Fan-out is claims
  that join the subject to entities the article names near it but never relates to it. The claims
  the article does state about its subject are gold, however many (`task.md`, 1. Extraction).

## Traps train doesn't show

- A reply cut at the token limit is a loop, not a long answer. Salvaging its rows wrote hundreds of
  junk rows for one document and decided whole rounds (`runtime.md`, Typed replies).
- Held-out documents get every earlier document's entities as `known_entities`, and they can be
  longer than any train article. Matching known names by substring flooded the prompt with short
  names that occur everywhere; the starter matches whole key tokens. The stress run in `train.md`
  (Scoring your work on train) catches both.
- A drop in train mention precision carried over every time; a train gain in relation F1 rarely did.
  Train relation F1 swings several points between seeds of the same code, so one run's gain there is
  noise (`train.md`, Scoring your work on train).
- A retrieval metric scored on few queries can pass on one split and fail on the next. Keep a change
  that raises it on train even when the feedback says it already passes.
- Background jobs died without a word and cost whole rounds of waiting (`runtime.md`, Running it).

## Failed once, not yet confirmed

- Proposing every known entity whose name or alias key occurs in the article body, through the
  engagement filter: it recovered real misses about as often as it added generic class words and
  organizations named in passing, a wash on dev.
- Prompt lines asking the single extraction call for more (be exhaustive about principles, failure
  modes and model versions; keep named things met in comparisons) lowered precision more than they
  raised recall on train.
