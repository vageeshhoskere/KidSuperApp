# Kid 3D Builder — Design Spec

Date: 2026-11-10
Status: Draft for review

## 1. Purpose

A web app that lets a 7-year-old describe something ("a purple castle with a dragon") and get a 3D model of it, built from simple blocks they can then edit. Guard rails are the top priority: every request and every AI reply is checked, and every exchange is audited with an intent and a summary. A parent configures the AI providers and every control from a PIN-locked area.

### Decisions made during brainstorming

| Topic | Decision |
|---|---|
| How models are made | AI returns a block scene (primitives + colours + positions). Realistic meshes (text-to-3D) are out of v1 but the design keeps room for them (§10). |
| Child input | Voice and typing, with picture buttons. Parent can turn each off. |
| Flagged request handling | Parent chooses: redirect, redirect + notify, or hold for approval. Default: redirect + log. |
| Where it runs | Small server on a home computer; children use a browser on the home network. |
| Safety checks | All three layers: word list, moderation API, checker LLM. Checker may be a different provider from the builder (optional; default same). |
| Picture check of built scenes | On by default; parent can turn off. |
| Children | One child in v1; data model keyed by child so profiles can be added later. |
| Audit retention | Parent chooses the number of days; default 90. |
| Tech stack | TypeScript end to end: Node + Fastify server, SQLite, React + three.js client. |
| "Add wings!" follow-up requests | In v1, through the same pipeline. |

## 2. Architecture

```
Child's device (browser)                      Home computer (Node server + SQLite file)
┌──────────────────────────┐                 ┌──────────────────────────────────────┐
│ Child screen             │   home Wi-Fi    │ Safety pipeline                      │
│  mic / typing / pictures │ ──────────────▶ │ Provider adapters (OpenAI, Anthropic,│
│  3D viewer (three.js)    │ ◀────────────── │   Google; optional speech providers) │
├──────────────────────────┤                 │ Audit log (append-only)              │
│ Parent area (PIN-locked) │                 │ Settings, child, saved creations     │
└──────────────────────────┘                 └──────────────────────────────────────┘
                                                           │ only the server calls AI providers
                                                           ▼
                                                OpenAI / Anthropic / Google
```

Units:

- **shared/scene** — the scene schema (one definition, used by server and client).
- **server/providers** — one adapter per provider. Each adapter exposes only the functions that provider supports: `generateJson(system, data, schema)`, `checkImage(system, image, schema)`, `moderate(text)`, `transcribe(audio)`, `speak(text)`.
- **server/safety** — word list + normaliser, PII detector, moderation call, checker-LLM call, decision logic.
- **server/pipeline** — runs one build request end to end (§3).
- **server/audit** — append-only writes, queries, CSV export, retention purge.
- **server/parent** — PIN auth, settings, held-request decisions.
- **server/db** — SQLite schema and access.
- **web/child** — the child's screen.
- **web/parent** — the parent area.

## 3. Request flow

1. **Input.** Voice (STT), typing or picture buttons all become plain text on the client before they reach the server. Picture buttons insert words into the text box.
2. **Gate checks.** These run first: allowed hours, the daily build limit, and that the input mode is enabled for this child. If any fails, the child sees the "shop is closed" screen and the attempt is audited.
3. **Input check.** Layer 1 → Layer 2 → Layer 3 (§4), stopping at the first layer that fails. Layer 3 also produces `intent` and `summary`. Note that the audit row for a request stopped by Layer 1 or 2 has no LLM intent or summary (§6).
4. **On fail:** apply the parent's flag-handling choice (§5) and audit the request.
5. **Build.** The builder LLM gets a fixed system prompt and the child's text, marked as data. For a follow-up it also gets the current scene as data. It must return a scene matching the schema (§7).
6. **Schema check.** Anything that does not match is rejected, never repaired.
7. **Output text check.** The title and a description of the scene, generated in code from the blocks, go through all three layers.
8. **Picture check** (if enabled). The server returns the scene to the client, which renders it hidden, takes a PNG snapshot and posts it back. The checker LLM judges the image. The viewer displays the scene only after the server confirms this check passed. This trusts the app code running in the child's browser, which a 7-year-old is not expected to modify. Rendering the snapshot on the server instead would remove that trust, at the cost of a headless renderer. For held requests that are approved, the parent's browser does the hidden render.
9. **Audit.** One row is written (§6). If the write fails, the child sees nothing from the AI.
10. **Show.** The viewer renders the scene. If TTS is on, the app speaks "Here's your {title}!" using only the checked title.

**Fail-closed rule:** any timeout, provider error, malformed reply or audit-write failure gives the child "Oops, let's try again!" and is logged. Timeout per provider call: 20 s.

**Only AI-written text ever shown to the child:** the checked title (≤ 5 words).

## 4. Safety layers

### Layer 1 — Word list and PII (on the server, no network)

- Normalisation before matching:
  - lower-case and remove accents;
  - map look-alike characters (`0→o 1→i/l 3→e 4→a 5→s 7→t @→a $→s`);
  - collapse runs of the same letter (3 or more) down to one;
  - also match with all spaces and punctuation removed, so `g u n` and `g.u.n` match `gun`.
- Default list ships in categories: weapons, violence, adult, drugs, self-harm, insults.
- The parent can add words and add allowed phrases. An allowed phrase like "shooting star" is removed from the text before matching.
- PII patterns: phone numbers (7 or more digits, allowing separators), email addresses, and street addresses (a number followed by a street word such as street, st, road, rd, avenue, ave, lane, drive). A match blocks the request with "Let's keep things like addresses secret!" and is audited. PII is never sent to any provider.
- In the audit log, matched PII is masked (`[phone]`, `[email]`, `[address]`).

### Layer 2 — Moderation API

- Providers: the OpenAI moderation endpoint, or Google Cloud Natural Language `moderateText`.
- Fails if any category score is ≥ 0.2. The parent can change this threshold, between 0.05 and 0.5.
- If no moderation provider is configured, setup requires the parent to acknowledge that Layer 2 is off, and audit rows record `layer2: skipped`.

### Layer 3 — Checker LLM

- A fixed system prompt states the task: decide whether this is suitable as a toy-building request (or reply) for a child of age {age}. It approves based on what is allowed, not only on what is banned.
- The child's text is sent inside clearly marked data delimiters, and the prompt says that instructions inside the data must be judged, not followed.
- Temperature 0.
- Required output: `{intent: string, summary: string, verdict: "safe"|"unsure"|"unsafe", categories: string[], reason: string}`.
- Only `safe` passes. `unsure`, `unsafe`, a malformed reply or an error all fail.
- The provider and model are chosen by the parent. It may be a different provider from the builder; the default is the same provider.

### Picture check

- Uses the checker LLM's image input. The prompt asks whether the image shows anything unsuitable for a child of age {age}, including offensive symbols or rude shapes. The output schema is the same as Layer 3.
- On by default.
- Hand-made edits by the child are not checked.

### Redirect suggestions

Chosen at random from a fixed list of safe ideas shipped with the app (for example rocket, treehouse, robot, ice-cream shop). Never generated by AI.

## 5. Parent controls

### Access

- 6-digit PIN, stored as a scrypt hash.
- After 5 wrong attempts, the parent area locks for 15 minutes. Every attempt is audited.
- The parent session ends after 10 minutes of inactivity.
- The parent area is served at `/parent`. The child's screen has no link to it.

### First-run wizard

1. Set the PIN.
2. Add the child: display name, avatar (chosen from built-in pictures), age.
3. Add API keys, each with a "Test" button.
4. Choose the builder provider and model, the checker provider and model, and the moderation provider (or acknowledge that Layer 2 is off).
5. Finish. The child's screen becomes available.

Until setup is finished, the child's screen shows "Ask a grown-up to set me up!"

### Settings (stored per child unless marked global)

| Setting | Default |
|---|---|
| Typing / picture buttons / voice input | on / on / off |
| STT provider | browser built-in |
| TTS (spoken replies) | off; provider: browser built-in |
| Flag handling: redirect / redirect + notify / hold | redirect |
| Picture check | on |
| Word list additions, allowed phrases | none |
| Moderation threshold (global) | 0.2 |
| Builds per day | 30 |
| Allowed hours | 08:00–19:00, in the home computer's time zone |
| Audit retention in days (global) | 90 |
| SMTP settings and parent email (global) | empty; required before "notify" can be chosen |

- Turning on any cloud speech provider shows a warning that the child's audio will be sent to that provider.
- **API keys** are global. They are stored in the data folder with file mode 0600, are never returned to the browser (the screen shows only the last 4 characters), and are never written to the audit log. There is no encryption at rest: the decryption key would have to sit on the same computer, so it would not add protection.
- Every settings change is audited: setting name, old value, new value, time. For API keys, the old and new values are shown masked.

### Held requests

With "hold", a flagged request waits in the parent's queue. The child sees "A grown-up will check this one!"

- **Approve** runs the rest of the pipeline. Approving does not skip any check: an approved request still goes through steps 5–9 of §3. The resulting model goes to the child's gallery, marked "New!".
- **Reject** discards it.

The decision is audited as a new row linked to the request.

## 6. Audit log

### Tables (append-only)

- `audit_requests`: id, created_at, child_id, input_mode, input_text (PII masked), layer1/layer2/layer3 input results (each `pass|fail|skipped` plus detail JSON), intent, summary, builder provider and model, checker provider and model, output text results, picture check result, outcome (`shown|redirected|held|closed|error`), error detail, raw provider replies (text), scene JSON, parent_request_id (for follow-ups). `intent` and `summary` are null when Layer 1 or 2 stopped the request, because the checker LLM never ran.
- `audit_events`: id, created_at, type (`settings_change|pin_success|pin_fail|hold_decision|purge`), related_request_id, detail JSON.

### Rules

- Application code has no update or delete path for audit rows. The only exception is the nightly retention purge, which deletes rows older than the retention days and writes one `purge` event with the count deleted.
- Saved creations live in their own table and are not touched by the purge.

### Parent view

- Held queue at the top.
- Request list, newest first. Rows that were redirected, held or errored are highlighted in red. Filters: child, date range, outcome.
- Detail view: every field above, plus a 3D preview of the scene.
- Export to CSV for any date range.

## 7. Scene schema

```ts
type Shape = "cube" | "sphere" | "cylinder" | "cone" | "pyramid" | "torus";
type Color = /* one of 16 named palette colours */;
interface Block {
  shape: Shape;
  color: Color;
  position: [number, number, number]; // each in [-20, 20]
  size: [number, number, number];     // each in [0.1, 10]
  rotation: [number, number, number]; // degrees, each in [-360, 360]
}
interface Scene {
  title: string;          // 1–5 words, letters/digits/spaces only, ≤ 40 chars
  blocks: Block[];        // 1–200 blocks
}
```

- Defined once with Zod in `shared/scene`. The server validates every builder reply against it, and the client validates again before rendering.
- No other fields are allowed: extra keys are rejected.

## 8. Child's screen

- **Start:** the child taps their avatar.
- **Build screen:**
  - a giant hold-to-talk 🎤 button, where the transcript appears as they speak;
  - a text box;
  - a strip of picture buttons (things, animals, colours, sizes), each spoken aloud when tapped;
  - a big **Build!** button.
- **While building:** an animation. The expected total time is 5–8 s.
- **Viewer:** drag to rotate, pinch or scroll to zoom. In edit mode the child taps a block to recolour (from the palette) or delete it, drags shapes in from a tray, and has undo. **Save** puts the model in the gallery.
- **Follow-up:** "Change it!" uses the same inputs and the full pipeline, with the current scene sent as context.
- **Gallery:** big thumbnails. Tapping one opens it in the viewer.
- **Closed / limit reached:** "The building shop is closed — come back tomorrow!"
- **Never shown:** links, chat, ads, or any AI text other than the checked title.
- **Accessibility:** touch targets ≥ 64 px, high contrast, fully usable by keyboard.

## 9. Testing

1. **Unit tests** (they run on every change; fake providers, so free):
   - word-list normaliser evasion cases;
   - allowed phrases;
   - PII patterns and masking;
   - scene schema rejects (bad shape, out-of-range numbers, extra keys, too many blocks, bad title);
   - pipeline decision logic for every failure path: each layer failing, `unsure`, provider error, timeout, malformed JSON, picture check failing, audit write failing. In every case the assertion is that no AI content reaches the child.
   - gate checks (hours, daily limit, mode disabled);
   - PIN lockout;
   - retention purge;
   - hold → approve still runs the remaining checks.
2. **Adapter tests:** each provider adapter is tested against recorded real replies.
3. **One end-to-end browser test** (Playwright, fake provider): set up → child builds a castle → the parent sees the matching audit row.
4. **`npm run redteam`** (run by hand; uses real providers and costs money): about 100 adversarial prompts (instruction-override attempts, disguised spellings, PII, borderline topics), with a pass/fail report. Rerun after any change of provider or model.

## 10. Extension point: realistic meshes (option B, not built in v1)

- Add a block kind `{ kind: "mesh", url: string }` that loads glTF in the viewer.
- Add a "3D generation" provider type to the settings.
- Every mesh requires the picture check (it cannot be turned off for meshes). Optionally, require parent approval for every mesh.
- The audit log, parent controls and child screen are otherwise unchanged.

## 11. Out of scope for v1

Realistic meshes, multiple child profiles in the UI, hosted or multi-family use, 3D-print export, notification channels other than email, audit tamper-proofing such as hash chains, encryption of API keys at rest.
