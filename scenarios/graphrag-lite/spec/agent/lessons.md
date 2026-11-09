# What earlier attempts learned

Earlier attempts built this system from an empty starter. What they learned while building it is
below, so you don't spend a round finding it again. The starter you get already holds some of it:
extraction by section, the critic switch, the row cap and the split of a looping reply. Each line is
a lesson, not a rule: when your train measurement disagrees, trust the measurement and say so in
your notes.

## Worked

- Graph building by name key, alias key and acronym, with no model, was enough; no attempt improved
  on it with a model.
- An entity critic after extraction, as a chat call that keeps, drops or retypes each row against
  the Engagement and Not-a-tool rules, was the one mention change that kept helping
  (`extraction.critic`).
- One type per name key across a document's sections, and dropping names that are a single
  code-style identifier (an agent class, a function), raised mention precision.
- Extracting by section raised mention recall. What it cost in precision came from looping replies
  and code symbols, which the critic, the identifier rule and the length rule below remove.
- Retrieval: reranking two-hop path candidates, and expanding through a bridge node while keeping
  the anchor's best edges, raised multi-hop. A decision-model check handled unanswerable queries.
- Comparing two versions paired: rerun under replay so only the calls a change reached are fresh,
  or save the raw replies once and rescore every filter variant offline.

## Failed, more than once

- Relation filters of every kind: an evidence sentence or span per claim, both ends in one
  sentence, a minimum mention count per end, a cap per source, a decision-model verifier or gate.
  Each cost more recall than it bought in precision.
- Extra passes that ask for more: "what did you miss", relation gleaning, a separate relation pass
  over the final entity list, a relation pass per section. Most of what they added was wrong.
- Prompts that centre claims on the article's main subject ("hub first", "attach claims to the
  central entity"). They link the subject to everything near it.
- Direction rules and inverse-label maps in the prompt. Reversed claims went up, not down.
- The decision model as an entity filter. It ranks core methods and systems below junk.
- A count target or cap in the prompt ("20-30 entities"). It fits train's sparse gold and
  under-extracts everywhere else.
- A second few-shot document, reasoning on, voting over seeds, sampling above temperature 0.

## The lever for relations

Most missed relations lack an end: extraction never produced one of the two entities, most often a
method or a system. Fixing direction or labels is small next to that. Raise relation F1 through
mention recall for those types and by cutting fan-out, not by filtering claims.

## Traps train doesn't show

- A reply cut at the token limit is a loop, not a long answer. Salvaging its rows wrote hundreds of
  junk rows for one document and decided whole rounds. Drop it and split the input, as the starter
  does; never raise `max_tokens` to make room for it.
- Held-out documents get every earlier document's entities as `known_entities`, and they can be
  longer than any train article. Matching known names by substring floods the prompt with short
  names that occur everywhere; the starter matches whole key tokens. Before you stop, run
  extraction on two train articles joined into one input, with every train gold entity as its
  `known_entities`, and compare its rows per 1000 characters with the single articles'.
- A drop in train mention precision carried over every time; a train gain in relation F1 rarely
  did. Read precision, recall and row counts, never F1 alone.
- A retrieval metric scored on few queries can pass on one split and fail on the next. Keep a
  change that raises it on train even when the feedback says it already passes.
- Background jobs died without a word and cost whole rounds of waiting. Run the program in the
  foreground under `timeout`, with its output in a file, and check the time with `date`.
