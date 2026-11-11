# What earlier attempts learned

Earlier attempts built this system from an empty starter. What they learned while building it is
below, so you don't spend a round finding it again. The starter you get already holds some of it:
extraction by section, the critic switch, the row cap and the split of a looping reply. Each line is
a lesson, not a rule: when your train measurement disagrees, trust the measurement and say so in
your notes.

## Worked

- Graph building by name key, alias key and acronym, with no model, was enough; no model improved on
  it. The starter has the first two. Rule nominations on held-out surfaces made no wrong merges on
  dev; each is taken only with a unique candidate (drop a generic head word like pattern or
  framework; acronym to initials). The misses left were rulings that no rule reaches.
- An entity critic after extraction, as a chat call that keeps, drops or retypes each row against
  the Engagement and Not-a-tool rules, was the one mention change that kept helping
  (`extraction.critic`). Spelling out the engagement test in its prompt held on dev. Exempting rows
  the extractor counted five or more times from its drops shipped in a kept round, confounded with
  the claim fold.
- One type per name key across a document's sections, and dropping names that are a single
  code-style identifier (an agent class, a function), raised mention precision. Without such a rule,
  a prompt edit that resampled every extraction call let in many more code class and function names
  typed tool or system, and dev mention precision fell well past the noise.
- Extracting by section raised mention recall. What it cost in precision came from looping replies,
  code symbols, agent roles and generic words, which dropping looping replies, the critic and the
  identifier rule remove. Without them, section windows lost more precision than they gained recall,
  and a decision-model engagement filter recovered none of it at any threshold.
- Retrieval: for single_hop, rerank anchor edges written as text (ends, label, end types,
  descriptions) over a BM25 shortlist of about 100; fixed scores were much worse. List non-anchor
  ends of top edges before anchors for MRR; putting common neighbours first, or reranking answer
  nodes separately, lowered it. Rerank two-hop paths and bridge edges by score, not fixed slots, to
  raise multi-hop without hurting single-hop. A decision-model check handled unanswerable queries.
- The chat model sometimes returned a document's entities with no relations at all, on every run. A
  follow-up call asking for that document's relations, sent only when the first reply has none,
  fixed it.
- Fold one referent's rows before resolving claims: strip a parenthetical from a name into aliases,
  fold an acronym row into the unique same-type row it is the initials of, and resolve a claim end
  by full key, then outer text, then inner spellings. Shipped with prompts unchanged, it raised dev
  relation recall though train barely showed it. Joining rows where one's name key equals another's
  alias key folded broad classes into narrower rows on train.
- Ship one change per round when anything else resamples or may lose: the claim fold, shipped inside
  a prompt resample, read as nothing until a round with every prompt byte-identical. Even then dev
  may not replay: a claims-only change left most dev calls fresh, entities and critic included, so
  mentions moved by noise. The fix that stops headings inside code fences cutting sections is still
  unmeasured on dev.

## Failed, more than once

- Relation filters of every kind: an evidence sentence or span per claim, both ends in one sentence
  or within a few sentences, a minimum mention count per end, a cap per source, a decision-model
  verifier, gate or direction check. Each cost more recall than it bought in precision, or did
  nothing; the decision model cannot tell a stated claim from co-occurrence.
- Extra passes asking for more (what did you miss, relation gleaning, a relation pass over the final
  entity list or unioned per section, decision-model checks on co-occurring pairs) write claims far
  below the first call's precision. Giving section claims calls outside ends failed three times (the
  whole document's entities, its most-named, the other mentions the section names as whole tokens):
  fan-out onto hub classes and the subject, a train gain, a dev loss.
- Prompts framed around the article's main subject ("what is this article about", "hub first",
  "attach claims to the central entity"). They link the subject to everything near it.
- Claims-prompt wording. Direction rules and inverse-label maps raised reversed claims or lost a
  train gain on dev, and direction is no longer scored. Removing the direction list and adding lines
  (a claim may span sentences, list items and tables; mere co-occurrence is no claim; instance, part
  and comparison claims) gained on train and was flat on dev: claims wording alone did not move dev
  relations.
- The decision model as an entity filter. It ranks core methods below junk, drops named tools,
  models and organizations an article compares or uses briefly, and passes code symbols. Exempting
  person, organization, model and tool rows and filtering only method and system rows raised dev
  mention recall, but let in organizations and CLI programs named in passing.
- A count or frequency floor, a count target or cap per document, or dropping tools, models and
  organizations named once in a list or link line. Each fits train's sparse gold: on dev the list
  rule dropped about as many gold rows as false ones, and their claims with them. A document
  character cap failed too: what it cuts is never extracted.
- One type per name across the corpus. Within one document, one type per key is right.
- A second or swapped few-shot document, gold relations shown as text, voting over seeds, sampling
  above temperature 0. Reasoning on also failed: on the whole call it gave a small mention gain and
  a larger relation loss. On the entities call alone it cut train mention recall sharply and ran
  several times slower.
- Rescuing known entities the article names but the entities call skipped failed in every form
  tried. These forms were: proposing every known key in the body through an engagement filter; one
  chat engagement check per document, with evidence sentences; and listing the skipped names in the
  claims call as not yet extracted. Each added few rows, mostly not gold, and none moved dev mention
  recall or relation F1.
- Limiting what the critic may drop lost precision both ways it was tried. Never dropping method or
  system rows (dropping only list-only tools, organizations, people and models) let in many false
  positives. Never dropping known-entity rows did the same and also lowered relation F1. Narrowing
  the critic instead (retype to system only for lowercase names, drop agent roles in the article's
  own pipeline) moved nothing beyond noise.

## The lever for relations

- Most missed relations lack an end, most often a method or system; on dev many were known entities
  the section names but the entities call skipped. Neither direction nor labels are scored. Raise
  relation F1 through mention recall for those types and by cutting fan-out, not by filtering
  claims. Fan-out is the subject joined to entities named near it but never related to it. Claims
  the article states about its subject are gold.
- Dev shows qualified variants (a multi-agent form of the agent class, an agentic form of a method,
  a family member of a base model) written as aliases of the broad known entity, so the core class
  goes missing and its claims land on the broad one. A canon reworded as candidates, with a rule
  that a narrower variant is its own entity, did not stop it on dev. A deterministic split of
  qualifier-prefixed aliases hit only non-gold train rows; untested on dev.

## Traps train doesn't show

- A reply cut at the token limit is a loop, not a long answer. Salvaging its rows wrote hundreds of
  junk rows for one document and decided whole rounds (`runtime.md`, Typed replies).
- Held-out documents get every earlier document's entities as `known_entities`, and they can be
  longer than any train article. Matching known names by substring flooded the prompt with short
  names that occur everywhere; the starter matches whole key tokens. The stress run in `train.md`
  (Scoring your work on train) catches both.
- A drop in train mention precision carried over every time; a rise did not protect dev, where
  precision fell anyway. A train gain in relation F1 rarely carried over. Train relation F1 swings
  several points between seeds of the same code, so one run's gain there is noise.
- A retrieval metric scored on few queries can pass on one split and fail on the next. Keep a change
  that raises it on train even when the feedback says it already passes.
- Background jobs died without a word and cost whole rounds of waiting (`runtime.md`, Running it).
  Another round was lost because the commit carried none of the changes measured on train, so dev
  tested nothing. Check that `git diff` against the kept commit holds every change, switched on.
- The critic call lists all of a document's rows, so any change to its mention list resamples the
  critic and its noise hides small effects. On long stress inputs it is unstable: resampled calls,
  and a critic line applying the engagement test to recurring names, dropped more than half the
  rows. A drop cap, and a guard that discards a reply dropping most rows, never fired on dev.

## Failed once, not yet confirmed

- Entities-prompt edits lowered mention precision more than they raised recall: asking for more (be
  exhaustive, keep names met in comparisons), type-contrast pairs, the full heading path, code
  masking with imports kept (lowered both). A line typing named formats and specifications as tool
  also typed protocol servers and clients tool on dev, losing their claims. A canon with bracketed
  aliases and pipes gained on train but lowered dev precision sharply.
- Changing the entities call's window or examples did not raise recall. One train section with its
  gold rows as a few-shot example in the entities prompt was flat on train. Entities calls on
  smaller windows inside each section lowered train recall, and a union with the whole-section call
  gained nothing. Train mention recall stayed level whatever the window.
- Letting the claims call name ends outside the section's entity list, with types, so they become
  new mentions: the model wrote no such end on train. Free-form out-of-list ends don't fire.
- An entities-prompt paragraph asking for each section's own core method or system and for qualified
  variants of known methods and systems raised dev mention recall sharply but lowered precision:
  activity nouns typed method, own-pipeline roles typed system, app commands typed tool, passing
  people and organizations. A sentence excluding exactly those kinds removed none of them and gave
  back recall. Measured only bundled with other changes.
