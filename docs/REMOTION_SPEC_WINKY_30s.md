# Remotion Spec: Winky Starkzap — 30s Announcement

**Use this document as the single source of truth for building the video in Remotion.** Every timing, line, sound effect, and visual cue is specified so the composition can be implemented without guesswork.

---

## 1. Composition & Project Settings

| Setting | Value | Notes |
|--------|--------|--------|
| **Duration** | 30 seconds | 900 frames at 30fps |
| **FPS** | 30 | Use for all `frame` calculations below |
| **Width** | 1920 | Full HD |
| **Height** | 1080 | 16:9 landscape |
| **Aspect ratio** | 16:9 | Safe for YouTube, social, and presentations |
| **Audio sample rate** | 48000 Hz | For voice and SFX |

**Remotion:** One root `<Composition>` duration `900`, width `1920`, height `1080`, fps `30`. All scene timings below are in **seconds** and **frames** (e.g. `0:02.15` = 2.15s = frame 64).

---

## 2. Scene-by-Scene Breakdown (Timeline)

All times are in `seconds:frames` (30fps). Frame = seconds × 30.

| Scene | Start (s) | End (s) | Start Frame | End Frame | Description |
|-------|-----------|---------|-------------|-----------|-------------|
| 1 | 0:00 | 0:02.5 | 0 | 75 | Black → evolutionary / eyes in darkness |
| 2 | 0:02.5 | 0:05.5 | 75 | 165 | Extreme close-up eye, slow-mo blink |
| 3 | 0:05.5 | 0:06.5 | 165 | 195 | Beat — full black, “Until today” |
| 4 | 0:06.5 | 0:09.5 | 195 | 285 | Product reveal — Wink / logo, music in |
| 5 | 0:09.5 | 0:13 | 285 | 390 | Rapid cuts — webcam, counter, chain |
| 6 | 0:13 | 0:17 | 390 | 510 | Montage — users, counter, gasless text |
| 7 | 0:17 | 0:18.5 | 510 | 555 | Single dramatic blink, pause |
| 8 | 0:18.5 | 0:23 | 555 | 690 | Logo lock + “Winky Starkzap” + tagline |
| 9 | 0:23 | 0:30 | 690 | 900 | End card — CTA, hold |

---

## 3. Deep Voice Narrative (Full Script & Direction)

**Voice direction:** Male or androgynous **deep voice**. Documentary / trailer narrator. Low register, clear articulation. Slight reverb for gravitas. No shouting; intensity comes from weight and pacing, not volume.

**Pacing:** Slow and deliberate in scenes 1–3; faster and more energetic from scene 4 onward; punchy and triumphant at the end.

### Line-by-line with timestamps and direction

| Timecode (start) | Line | Direction |
|------------------|------|-----------|
| **0:00.00** | “For millions of years… humans blinked.” | Very slow. “Millions of years” — stretch slightly. Pause after “years” (0.4s). “Humans blinked” — lower, final. |
| **0:02.50** | “Each blink… slowly lubricated… cleaned… and protected their eyes.” | Measured. Pause after each comma (0.25–0.35s). Slightly softer on “lubricated,” “cleaned,” “protected.” Last phrase: “their eyes” — gentle, conclusive. |
| **0:05.50** | “Until today.” | Grave, low. Slight rise on “today.” Pause after: 0.5s before next scene. |
| **0:06.50** | “Introducing Wink. Allowing humans to earn while blinking.” | Shift to announcer tone. “Introducing Wink” — emphatic, clean. “Allowing humans to earn while blinking” — one flowing phrase, slightly faster, hopeful. |
| **0:09.50** | “No wallet. No gas. No seed phrases. Every blink — a real transaction on Starknet. Zero cost. You blink, we put it on-chain.” | Full energy. Staccato on “No wallet. No gas. No seed phrases.” “Every blink” — beat, then “a real transaction on Starknet” — one phrase. “Zero cost” — punch. “You blink, we put it on-chain” — confident, tagline feel. |
| **0:13.00** | “The future isn’t in your wallet. It’s in the one thing you do twenty thousand times a day.” | Over-dramatic, triumphant. Slight rise on “wallet.” “Twenty thousand times a day” — slower, awe. |
| **0:17.00** | “One blink. One transaction. Forever.” | Quiet start. “One blink” — whisper almost. “One transaction” — build. “Forever” — peak, sustained, then fall. |
| **0:18.50** | “Winky Starkzap. Blink. On-chain.” | Big finish. “Winky Starkzap” — full, brand. “Blink. On-chain.” — two beats, definitive. |
| **0:23.00** | (No VO) | End card only. Optional very low bed or silence. |

**Remotion:** Use a single audio asset for VO. Trim each line to the timecodes above, or use `<Sequence from={frame}>` and place one continuous VO track, then align sequences to these start times.

---

## 4. Sound Effects (SFX) — Detailed Cue Sheet

Use deep, cinematic SFX. Layer subtly so voice stays forward.

| Timecode | SFX | Description | Duration | Volume (approx) | Notes |
|----------|-----|-------------|----------|------------------|--------|
| **0:00.00** | Low rumble / earth | Very low frequency swell, barely audible | 2.5s | 8–12% | Feels like “ancient,” not scary |
| **0:00.00** | Single heartbeat (optional) | One deep thud, slow | 0.5s | 5–8% | If used, place exactly at 0:00 |
| **0:02.50** | Soft whoosh / membrane | Organic, like eyelid or water | 0.8s | 10% | Synced to start of eye close-up |
| **0:03.50** | Subtle “drop” (liquid) | One soft droplet or blink moment | 0.2s | 5% | On the “cleaned” or blink |
| **0:05.50** | Silence / breath hold | No SFX — dead silence for 0.3s | 0.3s | — | Before “Until today” |
| **0:05.80** | Deep impact / sub hit | One heavy “boom,” not harsh | 0.4s | 25–35% | On “Until” or first syllable of “today” |
| **0:06.50** | Rise / reverse cymbal or riser | Short build into product reveal | 0.8s | 15% → 40% | Leads into scene 4 |
| **0:07.30** | Logo hit / impact | Single punch when logo appears | 0.2s | 30% | Synced to “Introducing Wink” or logo frame |
| **0:09.50** | Quick whooshes (×3–4) | One per cut in rapid-cut sequence | 0.15s each | 12–18% | Each cut in scene 5 |
| **0:13.00** | Swoosh / transition | One smooth transition into montage | 0.5s | 15% | Start of scene 6 |
| **0:17.00** | Silence then single hit | 0.2s silence, then one deep hit on “Forever” | 0.4s | 20–28% | “Forever” lands with hit |
| **0:18.50** | Double hit | First hit on “Winky Starkzap,” second on “On-chain.” | 0.2s each | 25–30% | Brand punctuation |
| **0:23.00** | Resolve / pad | Long, sustained chord or pad (if any) | 7s | 15% | Fade in slowly, no peak |
| **0:28.00** | Optional end ping | Very soft “done” tone | 0.3s | 5% | Optional; end card only |

**Remotion:** Place each SFX on its own audio track or layer. Use `volume` keyframes to duck under VO (e.g. VO at 100%, SFX at specified % so voice is always clear).

---

## 5. Music

| Timecode | Role | Description | Volume |
|----------|------|-------------|--------|
| **0:00 – 0:05.5** | Bed / drone | Single deep note or very slow drone. No rhythm. Documentary / nature doc feel. | 5–8% (under VO) |
| **0:05.5 – 0:06.5** | Drop to silence | Music fades to nothing before “Until today.” | Fade out |
| **0:06.5 – 0:07.5** | Build / riser | Short riser (2–4 seconds) into the drop. Tension, then release. | 0% → 40% |
| **0:07.5 – 0:22** | Main track | Modern “tech launch” / “product reveal”: driving, rhythmic, not chaotic. Builds gradually. | 25–35% (duck under VO) |
| **0:22 – 0:30** | Resolve | One chord or sustained note; no beat. Fade out slowly. | 35% → 10% |

**Ducking:** When VO is present, reduce music by ~6–10 dB so the deep voice stays dominant.

**Remotion:** One music track. Use `volume` keyframes (or Remotion’s audio volume prop) at: 0, 165, 195, 285, 690, 900 frames to match the table above.

---

## 6. Visuals — Per Scene (Detailed)

### Scene 1 — 0:00 – 0:02.5 (Frames 0–75)

- **Background:** Black (0,0,0) or very dark blue (e.g. #0a0a12). Optional: slow particle or dust motes, barely visible.
- **Foreground:** No text at first. Optional: one ancient / evolutionary silhouette or abstract “eye” shape emerging from dark (opacity 0 → 0.3 over 1.5s).
- **Animation:** If using particles, move very slowly (e.g. 2–5 px over 2.5s). No sharp cuts.
- **Transition out:** Fade to next scene or cut at 0:02.5.

### Scene 2 — 0:02.5 – 0:05.5 (Frames 75–165)

- **Background:** Same dark or gradient (dark center, slightly lighter at edges).
- **Main visual:** Extreme close-up of a single human eye. Realistic, soft lighting. One full blink in **slow motion** (stretch the blink over ~2.5s: lid down 1s, hold 0.5s, lid up 1s).
- **Overlay:** Optional very subtle vignette. No text.
- **Animation:** Eye blink keyframed or use slow-mo clip. Slight reflection or “lubrication” highlight on the eye if desired.
- **Transition out:** Cut to black at 0:05.5.

### Scene 3 — 0:05.5 – 0:06.5 (Frames 165–195)

- **Background:** Full black.
- **Text (optional):** “Until today.” — Center screen. Font: bold, serif or modern sans (e.g. Bebas Neue, or a clean geometric). White or off-white (#f5f5f5). Size: large (e.g. 72–96px). Letter-spacing: wide. Fade in at 0:05.7, hold, fade out at 0:06.3.
- **Animation:** Text scale from 0.95 → 1 in 0.2s for subtle pop. No other motion.
- **Transition out:** Hard cut to scene 4.

### Scene 4 — 0:06.5 – 0:09.5 (Frames 195–285)

- **Background:** Dark gradient or solid (#0d0d1a to #1a1a2e). Optional subtle grid or “tech” lines, very low opacity.
- **Main visual:** Product logo or app name “Wink” / “Winky Starkzap.” Centered. Logo appears with a **scale-in** (0.7 → 1 in 0.4s) and optional subtle glow.
- **Text:** “Introducing Wink” can appear above or below logo at 0:07.0. “Allowing humans to earn while blinking” — smaller, below, at 0:07.8. Fade in, no bounce.
- **Animation:** Logo: ease-out scale. Optional: very subtle pulse or shimmer (opacity 0.9 → 1) every 1.5s.
- **Transition out:** Quick cut or short wipe to scene 5 at 0:09.5.

### Scene 5 — 0:09.5 – 0:13 (Frames 285–390)

- **Style:** Rapid cuts. 4–6 shots, each ~0.5–0.8s.
- **Shot list:**
  1. Webcam-style frame (browser or app UI with face/camera view).
  2. Blink counter (number ticking up: e.g. 1, 2, 3… or 10, 11, 12…).
  3. Abstract “chain” or network visual (nodes, links, Starknet-style).
  4. Repeat or vary: another counter, another blink.
  5. Optional: “Starknet” or “On-chain” text, bold, 0.5s.
- **Text overlays:** “No wallet” / “No gas” / “No seed phrases” can flash per cut (one phrase per cut) in a corner or center, 0.3s each.
- **Animation:** Each cut is a hard cut. No crossfade. Slight zoom or scale (1 → 1.02) on each clip for energy.
- **Transition out:** Cut to scene 6.

### Scene 6 — 0:13 – 0:17 (Frames 390–510)

- **Background:** Dark, consistent with scene 4.
- **Visuals:** Montage of 2–3 “users” (diverse faces) blinking at camera, or same person from different angles. Overlay: large counter (e.g. “1,247” or “20,000”) ticking up. Text: “GASLESS” and “ON-CHAIN” — bold, short on-screen (e.g. 0.8s each), position: lower third or top.
- **Animation:** Counter: increment animation (number goes up every 0.2–0.3s). Clips: short 1–2s each, cut between them.
- **Transition out:** Cut to scene 7.

### Scene 7 — 0:17 – 0:18.5 (Frames 510–555)

- **Background:** Black or same dark.
- **Main visual:** Single extreme close-up blink again. One slow, deliberate blink. Eyes open → close → open over 1.5s. This is the “one blink” moment.
- **Text:** Optional: “One blink. One transaction. Forever.” — can appear as captions below or after the blink (e.g. from 0:17.5).
- **Animation:** Blink in slow motion. Text fade in sequentially (one phrase per 0.3s).
- **Transition out:** Cut to scene 8.

### Scene 8 — 0:18.5 – 0:23 (Frames 555–690)

- **Background:** Dark gradient or brand background.
- **Main visual:** Full “Winky Starkzap” logo lockup. Centered. Large.
- **Text:** Tagline below: “Blink. On-chain.” (or chosen tagline). Font: same as scene 3 or slightly smaller. White or brand color.
- **Animation:** Logo and tagline fade in together (0.2s). Hold. Optional: very subtle scale (1 → 1.02) over 1s for “hero” feel. No other motion.
- **Transition out:** Ease into scene 9 (can be same frame with CTA added).

### Scene 9 — 0:23 – 0:30 (Frames 690–900)

- **Background:** Same as scene 8 or solid dark.
- **Content:** Logo + “Blink. On-chain.” + CTA line: e.g. “Try it now” or “winkystarkzap.io” or “Starknet”.
- **Layout:** Logo top or center. Tagline under. CTA at bottom (smaller, e.g. 24–32px). Optional: subtle “Starknet” or “Powered by Starknet” badge.
- **Animation:** Static. No motion except optional very slow fade-in of CTA at 0:24. Hold until 0:30.
- **End:** Freeze on last frame. No fade to black unless desired.

---

## 7. Typography & Colors

- **Primary font (headlines / logo):** Bold sans or condensed (e.g. Bebas Neue, Oswald, or a custom brand font). Use for “Until today,” “Winky Starkzap,” “Blink. On-chain.”
- **Secondary font (body / CTA):** Clean sans (e.g. Inter, SF Pro). Use for “Allowing humans to earn while blinking,” “Try it now,” URL.
- **Colors:**
  - Background dark: `#0a0a12`, `#0d0d1a`, `#1a1a2e`.
  - Text primary: `#ffffff` or `#f5f5f5`.
  - Accent (optional): One brand color for logo or “On-chain” (e.g. green `#00ff88` or blue `#3b82f6`). Use sparingly.
- **Safe area:** Keep important text and logo within 90% of width/height (safe margins ~5% each side).

---

## 8. Remotion-Specific Structure Suggestion

- **Root composition:** 1920×1080, 30fps, duration 900 frames.
- **Sequences:** One `<Sequence>` per scene, with `from={startFrame}` and `durationInFrames={endFrame - startFrame}`. This keeps timeline readable and allows per-scene tweaks.
- **Audio:**
  - Track 1: Voice-over (one file, or multiple segments).
  - Track 2: Music (one file, volume keyframed).
  - Track 3: SFX (multiple clips at specified timecodes).
- **State:** Pass `frame` (or `useCurrentFrame()`) into each scene component so animations (blink, counter, fades) are driven by frame.
- **Assets:** Prepare and reference:
  - VO: single mixed file or per-scene files.
  - Music: one track.
  - SFX: individual files (rumble, impact, whoosh, etc.).
  - Logo: SVG or PNG with transparency.
  - Optional: eye close-up video (or loop), webcam UI mock, counter component.

---

## 9. One-Paragraph “Perfect Prompt” for Remotion

Use this as the high-level prompt when building or briefing the Remotion project:

**“Build a 30-second, 1920×1080, 30fps announcement video for Winky Starkzap. Open with a deep-voice narrative over black and evolutionary imagery: ‘For millions of years… humans blinked,’ then a slow-mo extreme close-up of an eye with the line ‘Each blink… slowly lubricated… cleaned… and protected their eyes.’ Hit a full black beat and the line ‘Until today,’ then reveal the product with ‘Introducing Wink. Allowing humans to earn while blinking’ as music and logo hit. Use rapid cuts (webcam, blink counter, chain visuals) with VO: ‘No wallet. No gas. No seed phrases. Every blink — a real transaction on Starknet. Zero cost. You blink, we put it on-chain.’ Montage of users and counter with ‘The future isn’t in your wallet. It’s in the one thing you do twenty thousand times a day,’ then one dramatic slow blink and the line ‘One blink. One transaction. Forever.’ Logo lock with ‘Winky Starkzap. Blink. On-chain.’ and end card with CTA from 0:23 to 0:30. Voice: deep, documentary-style, gravitas. Sound design: low rumble at open, deep impact on ‘Until today,’ whooshes on cuts, hit on ‘Forever’ and on ‘Winky Starkzap’ / ‘On-chain.’ Music: minimal drone 0–5.5s, riser then tech-launch track from 6.5s, resolve chord from 22s. Duck music under VO. Scenes: 9 segments with exact timecodes; use Remotion sequences and frame-based animation. Typography: bold sans for headlines, clean sans for CTA; dark background (#0a0a12–#1a1a2e), white/off-white text, optional single accent color for brand.”**

---

## 10. Quick Reference — Timecode to Frame (30fps)

| Timecode | Frame |
|----------|--------|
| 0:00 | 0 |
| 0:02.5 | 75 |
| 0:05.5 | 165 |
| 0:06.5 | 195 |
| 0:07.5 | 225 |
| 0:09.5 | 285 |
| 0:13 | 390 |
| 0:17 | 510 |
| 0:18.5 | 555 |
| 0:22 | 660 |
| 0:23 | 690 |
| 0:30 | 900 |

Use this spec in a separate Remotion project; no deployment is required from this repo.
