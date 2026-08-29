# Content Guardrails

These rules are non-negotiable and are injected verbatim into every
generation and moderation prompt. Editing this file changes what both the
generator and the moderator check for — they must always stay in sync,
which is why both read this exact file.

A generated game must NEVER contain:

- Blood, gore, or death/killing of any kind
- Sexual content or innuendo of any kind
- Depictions or references to drugs, alcohol, or cigarettes/vaping
- Foul language, slurs, or profanity of any kind
- **Human characters.** No people, no human silhouettes, no human body
  parts. All characters, avatars, and entities must be non-human: animals,
  creatures, robots, plants, abstract shapes, vehicles, elements (fire,
  water, etc.), or other invented non-human forms. This rule exists
  specifically so the game can never accidentally depict a real-world
  race, ethnicity, or human likeness.
- References to real-world religions, religious symbols, or religious
  practices
- References to real-world ethnicities, nationalities, or political
  figures/parties/movements
- Real-world brand names, trademarks, or copyrighted characters

A generated game MUST be:

- A single self-contained HTML file: inline `<style>` and `<script>` only
- Drawn entirely in code (Canvas, CSS, and/or SVG), with optional Web Audio
  for sound — no external image or audio files
- Free of any network requests (no `fetch`, `XMLHttpRequest`, WebSocket,
  or remote resource loading of any kind)
