# LinkedIn post — Replay launch

Final draft 2026-04-29. Two links: GitHub repo + zoral.ai. Demo video gets attached natively to the LinkedIn upload, not embedded in the body text.

---

## Post body

Showing a bug to your AI coding agent shouldn't be harder than showing it to a colleague. Yet pasting a screenshot loses the path that caused it, and pasting a video burns 100K+ tokens on something an LLM can barely reason about.

So I spent last week on Replay. A Mac app: hit record, reproduce the bug, hit stop. Five seconds later you have a structured markdown timeline plus key frames, ready to paste into Claude Code, Cursor, anything.

The bug-report use case isn't really why I built it.

I'm working on perception at zoral.ai, an autonomous AI worker that observes you for a week and replaces you on day eight. Perception is one of the three pillars of any autonomous system: an agent has to see what's happening before it can decide or act. Replay started as a side experiment within that work, and the result turned out to be more interesting than the product it ships as.

LLMs are fundamentally static. They take a fixed-shape input and return a fixed-shape output. Video is dynamic, with temporal extent and ordering and causality. To pass a screen recording to a model at all, you have to encode that dynamic stream into a static representation that preserves the temporal information.

This is the same problem the Transformer architecture solved for text. A sentence is a sequence; each word has a temporal position; you cannot evaluate words in random order. Positional encoding kept the temporal information while letting the model see all words at once.

Video has had the same problem, mostly unsolved. Current video models downsample to N frames and treat each as an independent image, which throws away the structure that made language models work in the first place. A timestamped markdown timeline with key frames is the video equivalent of token plus positional index.

Once a video is addressable, the implications stretch well past bug reports. Imagine an AI quietly watching your screen all day, telling you at 6pm: "you spent 47 minutes on Slack, 12 of which were re-reading the same thread; your PR for X stalled at 2pm when you got pulled into a meeting." Or AI video editing where you tweak frame 47 instead of regenerating end to end. Or product demos that survive being shared, with fine-grained context any engineer can grep through weeks later.

Replay is the bug-report use case. The format is the bigger bet.

→ github.com/AryaaSk/replay
→ zoral.ai

---

## Notes for upload

- Attach the demo video natively (don't link out — LinkedIn de-prioritises external video).
- First two lines are above the "see more" fold: opener + "burns 100K+ tokens" punch line should land before the cut.
- The Zoral paragraph reframes Replay from "weekend hack" to "fragment of real autonomous-systems work." Don't trim it.
- Closing line is the thesis. Don't soften it with a CTA question.
