# What earlier attempts learned

Earlier attempts built this system from an empty starter. What they learned while building it is
below, so you don't spend a round finding it again. The starter you get already holds some of it:
extraction by section, the critic switch, the row cap and the split of a looping reply. Each line is
a lesson, not a rule: when your train measurement disagrees, trust the measurement and say so in
your notes.

## Worked

- Graph building by name key, alias key and acronym, with no model, was enough; no model improved on
  it. The starter has the first two. Rule nominations on held-out surfaces made no wrong merges on
  dev, each taken only with a unique candidate: drop a generic head word like pattern or framework;
  acronym to initials; keys equal once separators are removed, no digits (one right merge on dev,
  three times). The misses left were rulings no rule reaches.
- An entity critic after extraction (keep, drop or retype each row against the Engagement and
  Not-a-tool rules) kept helping, with the engagement test spelled out and a line calling tools,
  organizations and people only listed as examples of a kind passing (precision up, some listed
  backends lost). Exempt from its drops rows ending three or more pre-critic claims, but not
  organization, person or tool rows nor role drops; on dev it saves gold generic classes the critic
  calls not_entity.
- Extracting by section raised mention recall. Its precision cost (looping replies, code symbols,
  agent roles, generic words) is removed by dropping looping replies, the critic, one type per key
  per document, and dropping single code-style identifiers. Without the identifier rule, a prompt
  edit resampling every call let in many code names typed tool or system and dev mention precision
  fell. A decision-model engagement filter recovered none.
- Retrieval: for single_hop, rerank anchor edges over a BM25 shortlist of about 100, each edge
  written answer-first: the non-anchor end's name, type and description, then the claim; this beat
  fixed scores and plain edge text on dev MRR. List non-anchor ends before anchors; common
  neighbours first or a separate answer rerank lowered MRR. Rerank two-hop paths and bridges by
  score. A decision-model check handled unanswerable queries.
- The chat model sometimes returned a document's entities with no relations at all, on every run; a
  follow-up call asking for that document's relations, sent only when the first reply has none,
  fixed it. A per-section re-ask never fires: sections whose claims come back empty hold fewer than
  two entities.
- Before the critic, move a trailing parenthetical into aliases: the entities call copies canon
  lines 'name (aliases)' whole, and the critic dropped the duplicate with gold rows; this raised dev
  mention P and R twice. After the critic, fold an acronym row into the unique same-type row of its
  initials, and same-type variants (connector word, bare qualifier into its agent/system form) with
  a partner unique both ways; resolve claim ends by full, outer, inner key.
- Ship one change per round when anything else resamples: the claim fold read as nothing until every
  prompt was byte-identical. Deterministic changes after the critic replay on dev and read exactly.
  The replay key includes the seed, so a reseeded copy is fresh, and identical requests sent within
  seconds by parallel runs resample: run paired variants one after another.
- An entities-prompt paragraph asking for the section's own components, layers and stages, the
  failure modes it names, contrasted variants, background methods, and tools set side by side as
  alternatives raised dev mention recall sharply and lowered precision about twice as much as train
  showed; with the critic on it was a net gain and kept. A sentence excluding activity nouns, roles
  and commands removed none of them and gave back recall.
- Deterministic form rules after the critic keep paying, since every request replays: retype method
  or tool rows ending in a software-kind head (judge, evaluator, database, server, client, app,
  interface) to system unless another word is a proper name; retype bare interface or shell acronyms
  to system; type capitalised schema-format names tool; alias an organization-prefixed product to
  its short name. Leave layer and loop heads alone: gold types them both ways.
- Two more post-critic rules gained on dev: drop unknown lowercase job-title '<qualifier> agent'
  system rows and their claims when a document has three or more (roles of the author's setup), and
  when a system row 'X server/client/pipeline/platform' carries a known tool or method X as alias,
  restore X as its own row with one claim to the system row (that claim was gold once, false once).
  Setup agents not shaped like job titles still survive.
- Split the entity critic into a named-rows call (tool, model, organization, person) and a
  class-rows call (method, system), each with the full article, only when a document's pre-critic
  list is longer than any train document's: it raised dev mention and relation precision, at some
  recall. A single call on a long list drops little; lowering the threshold to mid-length documents
  gave nothing.
- The canon (known names a section contains, under 'write these names') is the main
  mention-precision lever once the known list is large: rows then use gold spellings. With no canon,
  train precision collapsed. Showing only names a section repeats lowered precision on every
  large-canon input. Rewording it to write every named known entity was mixed on train. Snapping
  rows to near-miss known spellings, and folding a known alias into its named row, never fired.

## Failed, more than once

- Relation filters and critics of every kind: evidence spans, sentence distance, count floors,
  per-source caps, a per-end rule on language ends, decision-model verifiers, and a chat claim
  critic rating each claim's support (it judged dev's dense fan-out as stated, dropped few, some
  gold). Each cost more recall than it bought or did nothing; the decision model cannot tell a
  stated claim from co-occurrence.
- Changing what the claims call is asked lost in every form: gleaning and extra passes, outside ends
  (the document's entities, its most-named, other names in the section), short sections joined into
  windows, long sections re-asked per half and unioned, a second-seed sample unioned. Added claims
  ran well below the first call's precision, mostly subject and hub fan-out. Re-asking claims over
  only the critic-kept rows lowered P and R on two train seeds.
- Prompts framed around the article's main subject ("what is this article about", "hub first",
  "attach claims to the central entity"). They link the subject to everything near it.
- Claims-call input changes: direction rules and inverse-label maps raised reversed claims; extra
  lines (claims span sentences and tables, co-occurrence is no claim) gained on train and were flat
  on dev; the entity list with aliases, descriptions or both lost on train three times; the heading
  path, bracketed alias or head-noun annotations in the text (recall fell on two seeds) and dropping
  seed labels were flat or worse on train. Wording alone did not move dev relations.
- The decision model as an entity filter. It ranks core methods below junk, drops named tools,
  models and organizations an article compares or uses briefly, and passes code symbols. Exempting
  person, organization, model and tool rows and filtering only method and system rows raised dev
  mention recall, but let in organizations and CLI programs named in passing.
- A count or frequency floor, a claim-degree floor (on train low-degree rows split about evenly gold
  and false), a count target or cap per document, or dropping tools, models and organizations named
  once in a list or link line. Each fits train's sparse gold: on dev the list rule dropped about as
  many gold rows as false ones, and their claims with them. A document character cap failed too:
  what it cuts is never extracted.
- Joins across types or by alias key failed: one type per name across the corpus; joining rows where
  one's name key equals another's alias key folded broad classes into narrower rows on train; inside
  a document, folding a row into another-type row holding its name as an alias folded a named
  product into its generic class. An embedding plus decision-model fold of same-type rows folded
  nothing on dev. Within one document, one type per key is right.
- A second or swapped few-shot document, gold relations shown as text, voting over seeds, sampling
  above temperature 0. Reasoning on also failed: on the whole call it gave a small mention gain and
  a larger relation loss. On the entities call alone it cut train mention recall sharply and ran
  several times slower.
- Rescuing known entities the article names but the entities call skipped failed in every form
  tried. These forms were: proposing every known key in the body through an engagement filter; one
  chat engagement check per document, with evidence sentences; and listing the skipped names in the
  claims call as not yet extracted. Each added few rows, mostly not gold, and none moved dev mention
  recall or relation F1.
- Other critic changes lost or did nothing: never dropping method, system or known rows; narrower
  retypes; exemptions at claim degree two, for tools, or for known tools at degree two (lost on dev
  twice, its saved tools bring list fan-out claims); counts, sentences or known-marks in its
  listing; extra seeded opinions voted or unioned; a type split on every document; prompt lines
  beyond the list-only one. Exemptions bring rows back with their fan-out claims.

## The lever for relations

- Most missed relations lack an end, most often a method or system; on dev many were known entities
  the section names but the entities call skipped. Neither direction nor labels are scored. Raise
  relation F1 through mention recall for those types and by cutting fan-out, not by filtering
  claims. Fan-out is the subject joined to entities named near it but never related to it. Claims
  the article states about its subject are gold.
- Dev shows qualified variants (a multi-agent form of the agent class, an agentic form of a method,
  a family member of a base model) written as aliases of the broad known entity, so the core class
  goes missing and its claims land on the broad one. Rewording the canon as candidates did not stop
  it on dev; splitting qualifier-prefixed aliases hit only non-gold train rows. Adding
  variant-to-base claims by suffix nesting hit no gold on train or stress; cutting nested-name
  claims removed gold.

## Traps train doesn't show

- A drop in train mention precision carried over every time; a rise did not protect dev. Train
  relation F1 gains rarely carried over, and both swing widely between seeds of the same code: read
  changes that resample on two or three seeds, paired. Large-canon stress inputs (each train
  document with the other documents' gold as known) read dev better than train singles: a pre-critic
  fold flat on train gained on stress and on dev.
- Train single_hop saturates, so measure rerank changes by a proxy: the rank of the first expected
  edge over all train queries. Corpus evidence sentences in the edge text, a plain-sentence or
  decision-model ranking fused by RRF, label glosses and a query instruction prefix all lowered it;
  evidence sentences also lowered dev MRR. Dev retrieval metrics rest on few queries and swing
  between splits and rounds.
- Background jobs died without a word and cost whole rounds of waiting. Another round was lost
  because the commit carried none of the changes measured on train. A list of concrete product or
  language names in code got a round blocked by the leak check, though it came from general
  knowledge: describe shapes in code, never names. Check that `git diff` against the kept commit
  holds every change, switched on.
- The critic call lists all of a document's rows, so any change to its mention list resamples the
  critic and its noise hides small effects. On long stress inputs it is unstable: resampled calls,
  and a critic line applying the engagement test to recurring names, dropped more than half the
  rows. A drop cap, and a guard that discards a reply dropping most rows, never fired on dev.

## Failed once, not yet confirmed

- Entities-call changes beyond the kept paragraph lost: be exhaustive, keep comparison names,
  type-contrast pairs, the full heading path, code masking, a line for limits and safeguards
  (precision fell sharply on two seeds), a line typing formats as tool (on dev it also typed
  protocol servers tool), a canon with bracketed aliases. Window changes did not raise recall: a
  few-shot gold section, smaller windows or their union, fence-aware sectioning (lost train recall
  on two seeds).
- Adding entity rows before the claims call failed in three forms on train: a gleaning call asking
  for the section's missing method and system rows, a second-seed entities sample unioned, and
  deterministic '<words> <kind head>' phrase proposals. Each brought mostly generic nouns, passing
  tools or title fragments far below current precision (phrases under a tenth gold), and the critic
  kept most model-added ones.
