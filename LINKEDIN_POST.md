# LinkedIn post — Replay launch

Final draft 2026-04-29. One link (Pages site); zoral.ai is mentioned inline. Demo video uploaded natively.

---

## Post body

In 2026, you still can't paste a 30-second video into your AI coding agent.

Which is bizarre, because that's how you'd show a bug to anyone else.

I spent last week closing the gap.

Replay is a Mac app. Hit record, reproduce the bug, hit stop. Five seconds later you have a structured markdown timeline plus key frames, ready to paste into Claude Code, Cursor, or anywhere else. The demo below shows the loop end to end.

The bug-report use case isn't really why I built it.

I'm working on perception at zoral.ai, an autonomous AI worker that observes you for a week and replaces you on day eight. Perception is one of the three pillars of any autonomous system: an agent has to see what's happening before it can decide or act. Replay started as a side experiment in that work, and the result turned out to be more interesting than the product it ships as.

LLMs are fundamentally static. They take a fixed-shape input and return a fixed-shape output. Video is dynamic, with temporal extent and ordering and causality. To pass a screen recording to a model at all, you have to encode that dynamic stream into a static representation that preserves the temporal information.

This is the same problem the Transformer architecture solved for text.

A sentence is a sequence; each word has a temporal position; you cannot evaluate words in random order. Positional encoding kept the temporal information while letting the model see all words at once.

Video has had the same problem, mostly unsolved. Current video models downsample to N frames and treat each as an independent image, which throws away the structure that made language models work in the first place.

A timestamped markdown timeline with key frames is the video equivalent of token plus positional index.

Once a video is addressable, the implications stretch well past bug reports:

- An AI quietly watching your screen all day, telling you at 6pm what you actually did with it.
- Diffable video editing, where you tweak frame 47 instead of regenerating end to end.
- Product demos that survive being shared, with fine-grained context any engineer can grep through weeks later.

Replay is the bug-report use case.

The format is the bigger bet.

→ aryaask.github.io/replay

---

## Notes for upload

- Hook is engineered for the LinkedIn fold: line 1 is the absurd-sounding factual claim, line 2 makes the absurdity concrete. Both above the "see more" cut.
- "In 2026, you still can't…" formulation is a known viral pattern: dated-and-implies-this-should-be-solved-by-now. Gets shared.
- Demo gets uploaded natively to LinkedIn (don't link to YouTube; the algorithm penalises external video). Body says "the demo below shows the loop end to end."
- Single link at close (Pages, not raw repo: site is more polished for a feed click-through, code listing has lower marketing value). zoral.ai stays inline as a soft cross-promotion, not a footer link.
- Closing two-line cadence ("Replay is the bug-report use case." / "The format is the bigger bet.") is the thesis. Hard cut, no CTA question.
