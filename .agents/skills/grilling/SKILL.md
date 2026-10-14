---
name: grilling
description: Stress-test a plan, decision, or idea with focused questions. Use when the user asks for a design interview, challenges to assumptions, or help resolving material design tradeoffs.
---

# Grilling

Build shared understanding by mapping the unresolved decisions and their dependencies as a design tree. First inspect the conversation and relevant repository material; keep established choices settled unless new evidence contradicts them.

Work in rounds. A round contains only material questions whose prerequisites are already settled. Give a recommendation and explain its tradeoff. Group independent questions, use the environment's question tool when available, and otherwise ask concise questions directly. Do not ask downstream questions whose answers depend on choices still open in the current round.

Discoverable facts are the agent's work: inspect files, sources, or tools rather than asking the user to look them up. Delegate only when the user or applicable instructions authorize delegation. Continue independent investigation while waiting for answers.

After each round, update the tree with the user's answers and identify the remaining material decisions. Carry forward existing authorization and preferences; do not repeat permission requests. Stop the interview when the requested decision is clear, no material questions remain, or the user asks to conclude. Summarize any deliberately deferred matters without inventing answers.

An interview is appropriate for substantive design work, not as an automatic prerequisite to saving research, installing tools, or applying a decision the user already made.
