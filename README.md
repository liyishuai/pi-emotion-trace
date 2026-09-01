# pi-emotion-trace

A Pi package that extracts chronological user-prompt history, classifies expressed emotional tone and interaction signals, and generates a self-contained visual timeline.

The report plots emotional valence from **−100 to +100** while independently surfacing prompts that steer, reject, correct, doubt, challenge evidence, reassert scope, approve, stop, or replace the agent's direction.

## Install

Pi packages run with your user permissions. Review the source before installing.

```bash
pi install git:github.com/liyishuai/pi-emotion-trace
```

To install for one trusted project only:

```bash
pi install -l git:github.com/liyishuai/pi-emotion-trace
```

To try it without changing settings:

```bash
pi -e git:github.com/liyishuai/pi-emotion-trace
```

Reload Pi after installation.

## Commands

### Generate the trace

```text
/emotion-trace
```

The command runs immediately with saved settings, reads bounded persisted `role: "user"` messages from existing Pi session history, and writes the latest report under Pi's agent directory (normally):

```text
~/.pi/agent/emotion-trace/report.html
```

It then opens the report in the default browser when the platform provides `open`, `xdg-open`, or `start`.

### Configure

```text
/emotion-trace-config
```

The configuration panel controls:

- **History window** — 7, 30, 90, 180, or 365 days, or all history;
- **Prompt limit** — 100, 250, 500, or 1,000 recent prompts;
- **Model catalog** — Pi's scoped models or all authenticated models; and
- **Classifier model** — defaults to `openai-codex/gpt-5.3-codex-spark`; transport or quota failures can fall back to `openai-codex/gpt-5.6-luna`.

Defaults are **90 days** and **500 prompts**. Changes save immediately; press Escape to close the panel. Settings are stored under Pi's agent directory (normally):

```text
~/.pi/agent/emotion-trace/config.json
```

## What is classified

Each selected user-role prompt receives two independent classifications.

### Emotional tone

- valence score from −100 to +100;
- one observable emotion label;
- high, medium, or low confidence;
- one to three exact emotional keywords; and
- an emotionally relevant prompt excerpt capped at 160 characters.

Neutral technical requests remain near zero unless their wording expresses emotion. The classifier describes wording in the prompt; it does not infer mental-health conditions, personality, private motives, or enduring emotional state.

### Interaction with the agent

Each prompt is classified as a request, steering, response, or other content. It can also carry multiple signals:

- steering;
- rejection;
- doubt;
- correction;
- scope reassertion;
- approval;
- evidence challenge;
- stop request; or
- replacement request.

Interaction signals are not treated as emotions. A rejection, doubt, or correction can have neutral emotional valence.

## Visualization

The responsive local HTML report contains:

- a chronological valence line colored from negative through neutral to positive;
- diamonds for steering prompts;
- crosses for rejections;
- question marks for doubts;
- keyword callouts for emotionally or behaviorally salient points;
- hover and keyboard-focus details for every point;
- filters for all prompts, steering, rejection, and doubt; and
- a complete timeline table with score, emotion, interaction tags, keywords, and bounded excerpts.

The chart uses inline SVG, CSS, and JavaScript and loads no external assets.

## Packaged skill

`skills/emotion-trace-classifier/SKILL.md` is the sole authority for emotional and interaction semantics. The TypeScript host only extracts bounded history, accepts well-formed skill results, and renders the report; it does not calculate or invent classifications. Malformed skill results are retried once and then omitted without failing the run. If the configured model cannot return skill output because of a transport or quota error, the host may run the same skill with `openai-codex/gpt-5.6-luna`.

Pi discovers the portable skill as `/skill:emotion-trace-classifier`. Another Agent Skills-compatible host can reuse it by providing chronological prompt batches and accepting the structured JSON contract.

## Privacy and bounds

- Persisted user-role prompt text is read locally and submitted transiently to the selected classifier model.
- Pi session records do not distinguish typed prompts from extension-injected user messages, so those messages can appear in the analyzed history.
- Full prompts are not stored as separate report fields. The report intentionally contains exact keywords and excerpts capped at 160 characters; a short prompt can therefore appear in full as its excerpt.
- The report also contains prompt timestamps, scores, labels, and interaction signals.
- The host accepts only well-formed bounded labels, signals, keywords, and exact excerpts. It never supplies semantic fallback values.
- The latest report replaces the previous report and is written with user-only file permissions.
- A run inspects at most 1,000 recently modified session files.
- Model batches contain at most 80 prompts and 45,000 prompt characters.
- A run submits at most 180,000 prompt characters, keeps the newest prompts that fit, and marks bounded coverage in the report.
- Historical JSONL files are read directly without opening or migrating them through `SessionManager`; a read failure aborts the run instead of silently dropping a session.
- Session paths, repository paths, assistant messages, tools, errors, token counts, and model prose are excluded from behavioral evidence and from the report.

## Development

Requires Node.js 22.19 or newer.

```bash
npm ci
npm run check
npm pack --dry-run
```

Load the extension directly:

```bash
pi --no-extensions --extension ./extensions/emotion-trace.ts
```

Then run `/emotion-trace-config` or `/emotion-trace`.

## License

[MPL-2.0](LICENSE)
