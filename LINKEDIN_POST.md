# LinkedIn post — Replay launch

Final draft 2026-04-29. One link (Pages site); zoral.ai is mentioned inline. Demo video uploaded natively.

---

## Post body

In 2026, you still can't paste a 30-second video into your AI coding agent.

Which is bizarre, because that's how you'd show a bug to anyone else.

I spent yesterday closing the gap.

Replay is a Mac app. Hit record, reproduce the bug, hit stop. Five seconds later you have a structured markdown timeline plus key frames, ready to paste into Claude Code, Cursor, or anywhere else. The demo below shows the loop end to end.

But the bug-report use case isn't really why I built it.

Perception is one of the three pillars of any autonomous system: an agent has to see what's happening before it can decide or act. I'm working on perception at zoral.ai, an autonomous AI worker that observes you for 6 days and replaces you on the 7th. Replay started as a side experiment in that work, with me thinking 'this can be used to provide videos to claude', and the results turned out to be more interesting than the original use case.

LLMs are fundamentally static. They take a fixed-shape input and return a fixed-shape output. Video is dynamic, with temporal extent and ordering and causality. To pass a screen recording to a model at all, you have to encode that dynamic stream into a static representation that preserves the temporal information.

This is the same problem the Transformer solved with positional token encoding.

A sentence is a sequence; each word has a temporal position; attention by itself is order-blind. Positional encoding tags each token with its place in the sequence, letting the model see all words at once while still knowing which came first.

Video has caught up partly. Sora uses spacetime patches; modern video transformers use 3D RoPE; Qwen2.5-VL and Gemini tag frames with their place in the timeline. Positional encoding for video isn't unsolved. What's less settled is tokenization: discrete video tokenizers do exist, but their codes are opaque latents. Nothing in video plays the role `the` or `function` plays in text, a unit that already means something before any model touches it.

A timestamped markdown timeline with key frames goes the other direction. It's discrete and semantic from the start, each event its own token with its own timestamp. An abstract video equivalent of word plus positional encoding, not pixel-cube plus positional encoding.

Once a video is addressable, the implications stretch well past bug reports:

- True diffable video editing, where you tweak frame 47 instead of regenerating end to end.
- Product demo videos that survive being shared, with fine-grained context any engineer can grep through weeks later.
- An AI quietly watching your screen all day, telling you at 6pm what you actually did with it, albeit this is has a few privacy concerns.

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
