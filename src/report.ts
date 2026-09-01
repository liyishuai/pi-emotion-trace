// SPDX-License-Identifier: MPL-2.0

import type { EmotionTraceResult, PromptTracePoint, SignalTag } from "./types.ts";

const CHART_HEIGHT = 620;
const CHART_TOP = 150;
const CHART_BOTTOM = 70;
const CHART_LEFT = 72;
const CHART_RIGHT = 40;

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function formatTimestamp(timestamp: string): string {
	return timestamp.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function formatAxisTimestamp(timestamp: number, span: number): string {
	const iso = new Date(timestamp).toISOString();
	if (span < 60 * 60 * 1_000) return iso.slice(11, 19);
	if (span < 48 * 60 * 60 * 1_000) return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
	return iso.slice(0, 10);
}

function scoreColor(score: number): string {
	if (score <= -60) return "#c63d4f";
	if (score <= -20) return "#e76f51";
	if (score < 20) return "#7a8794";
	if (score < 60) return "#49a078";
	return "#168a76";
}

function scoreLabel(score: number): string {
	return score > 0 ? `+${score}` : String(score);
}

function markerShape(point: PromptTracePoint, x: number, y: number): string {
	const color = scoreColor(point.valence);
	const base =
		point.interactionKind === "steering"
			? `<path d="M ${x} ${y - 7} L ${x + 7} ${y} L ${x} ${y + 7} L ${x - 7} ${y} Z" fill="${color}" stroke="#ffffff" stroke-width="2"/>`
			: `<circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`;
	const rejection = point.signals.includes("rejection")
		? `<path d="M ${x - 5} ${y - 5} L ${x + 5} ${y + 5} M ${x + 5} ${y - 5} L ${x - 5} ${y + 5}" stroke="#7f1d1d" stroke-width="2.2" stroke-linecap="round"/>`
		: "";
	const doubt = point.signals.includes("doubt")
		? `<text x="${x + 8}" y="${y - 7}" class="doubt-mark">?</text>`
		: "";
	return `${base}${rejection}${doubt}`;
}

function signalCount(points: PromptTracePoint[], signal: SignalTag): number {
	return points.filter((point) => point.signals.includes(signal)).length;
}

function combinedKeywords(point: PromptTracePoint): string[] {
	return [...new Set([...point.signalKeywords, ...point.emotionKeywords])];
}

function annotationText(point: PromptTracePoint): string {
	const keyword = point.signalKeywords[0] ?? point.emotionKeywords[0];
	const text = keyword || point.emotion.replaceAll("_", " ");
	return text.length > 34 ? `${text.slice(0, 31)}…` : text;
}

function annotationIndexes(points: PromptTracePoint[], maxAnnotations: number): Set<number> {
	const ranked = points
		.map((point, index) => {
			const previous = points[index - 1]?.valence ?? point.valence;
			let weight = Math.abs(point.valence) / 18 + Math.abs(point.valence - previous) / 22;
			if (point.interactionKind === "steering") weight += 4;
			if (point.signals.includes("rejection")) weight += 6;
			if (point.signals.includes("doubt")) weight += 5;
			if (point.signals.includes("evidence_challenge")) weight += 3;
			return { index, weight };
		})
		.sort((a, b) => b.weight - a.weight || a.index - b.index);
	return new Set(ranked.slice(0, maxAnnotations).map(({ index }) => index));
}

function chartSvg(points: PromptTracePoint[]): string {
	if (points.length === 0) return "";
	const width = Math.max(900, CHART_LEFT + CHART_RIGHT + points.length * 18);
	const plotWidth = width - CHART_LEFT - CHART_RIGHT;
	const plotHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
	const timestamps = points.map((point) => Date.parse(point.timestamp));
	const minimumTime = Math.min(...timestamps);
	const maximumTime = Math.max(...timestamps);
	const timeSpan = Math.max(1, maximumTime - minimumTime);
	const xAt = (timestamp: number, index: number) =>
		points.length === 1
			? CHART_LEFT + plotWidth / 2
			: CHART_LEFT +
				((timeSpan === 1 ? index / (points.length - 1) : (timestamp - minimumTime) / timeSpan) *
					plotWidth);
	const yAt = (score: number) => CHART_TOP + ((100 - score) / 200) * plotHeight;
	const coordinates = points.map((point, index) => ({
		x: xAt(timestamps[index] ?? minimumTime, index),
		y: yAt(point.valence),
	}));
	const grid = [100, 50, 0, -50, -100]
		.map((score) => {
			const y = yAt(score);
			return `<line x1="${CHART_LEFT}" y1="${y}" x2="${width - CHART_RIGHT}" y2="${y}" class="grid-line${score === 0 ? " zero" : ""}"/><text x="${CHART_LEFT - 14}" y="${y + 5}" class="axis-label" text-anchor="end">${scoreLabel(score)}</text>`;
		})
		.join("");
	const timeTicks = Array.from({ length: 6 }, (_, index) => {
		const ratio = index / 5;
		const timestamp = minimumTime + timeSpan * ratio;
		const x = CHART_LEFT + plotWidth * ratio;
		const label = formatAxisTimestamp(timestamp, timeSpan);
		const anchor = index === 0 ? "start" : index === 5 ? "end" : "middle";
		return `<line x1="${x}" y1="${CHART_HEIGHT - CHART_BOTTOM}" x2="${x}" y2="${CHART_HEIGHT - CHART_BOTTOM + 7}" class="axis-tick"/><text x="${x}" y="${CHART_HEIGHT - CHART_BOTTOM + 28}" class="axis-label" text-anchor="${anchor}">${label}</text>`;
	}).join("");
	const segments = points
		.slice(1)
		.map((point, index) => {
			const from = coordinates[index];
			const to = coordinates[index + 1];
			if (!from || !to) return "";
			const average = Math.round((points[index]!.valence + point.valence) / 2);
			return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${scoreColor(average)}" class="trace-segment"/>`;
		})
		.join("");
	const maximumAnnotations = Math.min(30, Math.max(10, Math.floor(width / 220)));
	const annotated = annotationIndexes(points, maximumAnnotations);
	const annotations = [...annotated]
		.sort((a, b) => a - b)
		.map((index, annotationIndex) => {
			const point = points[index];
			const coordinate = coordinates[index];
			if (!point || !coordinate) return "";
			const lane = annotationIndex % 4;
			const labelY = 24 + lane * 27;
			const anchor =
				coordinate.x < CHART_LEFT + 100
					? "start"
					: coordinate.x > width - CHART_RIGHT - 100
						? "end"
						: "middle";
			return `<g class="annotation" data-kind="${point.interactionKind}" data-signals="${point.signals.join(" ")}"><line x1="${coordinate.x}" y1="${labelY + 7}" x2="${coordinate.x}" y2="${coordinate.y - 10}"/><text x="${coordinate.x}" y="${labelY}" text-anchor="${anchor}">${escapeHtml(annotationText(point))}</text></g>`;
		})
		.join("");
	const markers = points
		.map((point, index) => {
			const coordinate = coordinates[index]!;
			const keywords = combinedKeywords(point).join(", ");
			const title = `${formatTimestamp(point.timestamp)} | ${scoreLabel(point.valence)} ${point.emotion} | ${point.interactionKind}${point.signals.length ? `: ${point.signals.join(", ")}` : ""}${keywords ? ` | ${keywords}` : ""}`;
			return `<g class="trace-point" tabindex="0" role="img" data-kind="${point.interactionKind}" data-signals="${point.signals.join(" ")}" data-date="${escapeHtml(formatTimestamp(point.timestamp))}" data-score="${scoreLabel(point.valence)}" data-emotion="${point.emotion}" data-interaction="${point.interactionKind}" data-keywords="${escapeHtml(keywords)}" data-excerpt="${escapeHtml(point.excerpt)}"><title>${escapeHtml(title)}</title><circle cx="${coordinate.x}" cy="${coordinate.y}" r="11" class="hit-area"/>${markerShape(point, coordinate.x, coordinate.y)}</g>`;
		})
		.join("");
	return `<svg class="trace-chart" viewBox="0 0 ${width} ${CHART_HEIGHT}" width="${width}" height="${CHART_HEIGHT}" aria-label="Prompt emotion valence over time" role="img"><rect width="${width}" height="${CHART_HEIGHT}" class="chart-background"/>${grid}${timeTicks}<text x="18" y="${CHART_TOP + plotHeight / 2}" class="axis-title" text-anchor="middle" transform="rotate(-90 18 ${CHART_TOP + plotHeight / 2})">emotional valence</text>${segments}${annotations}${markers}</svg>`;
}

function summaryCards(result: EmotionTraceResult): string {
	const { points } = result;
	const average =
		points.length === 0
			? 0
			: points.reduce((total, point) => total + point.valence, 0) / points.length;
	const cards = [
		["Prompts", String(points.length)],
		["Average valence", average > 0 ? `+${average.toFixed(1)}` : average.toFixed(1)],
		["Steering", String(points.filter((point) => point.interactionKind === "steering").length)],
		["Rejections", String(signalCount(points, "rejection"))],
		["Doubts", String(signalCount(points, "doubt"))],
	];
	return cards
		.map(
			([label, value]) =>
				`<div class="summary-card"><span>${escapeHtml(label!)}</span><strong>${escapeHtml(value!)}</strong></div>`,
		)
		.join("");
}

function tableRows(points: PromptTracePoint[]): string {
	return points
		.map((point) => {
			const tags = [
				`<span class="tag kind">${escapeHtml(point.interactionKind)}</span>`,
				...point.signals.map(
					(signal) => `<span class="tag signal">${escapeHtml(signal.replaceAll("_", " "))}</span>`,
				),
			].join(" ");
			const keywords = combinedKeywords(point)
				.map((keyword) => `<mark>${escapeHtml(keyword)}</mark>`)
				.join(" ");
			return `<tr data-kind="${point.interactionKind}" data-signals="${point.signals.join(" ")}"><td><time>${escapeHtml(formatTimestamp(point.timestamp))}</time></td><td><span class="score" style="--score-color:${scoreColor(point.valence)}">${scoreLabel(point.valence)}</span></td><td>${escapeHtml(point.emotion)}<small>${escapeHtml(point.confidence)} confidence</small></td><td>${tags}</td><td>${keywords || "<span class=\"muted\">none</span>"}</td><td class="excerpt">${escapeHtml(point.excerpt)}</td></tr>`;
		})
		.join("");
}

export function renderEmotionTraceHtml(result: EmotionTraceResult): string {
	const points = result.points;
	const first = points[0]?.timestamp;
	const last = points.at(-1)?.timestamp;
	const coverageNote = result.coverage.truncated
		? "Coverage was bounded by the configured prompt limit or classifier input cap."
		: "All prompts found in the selected history window were included.";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Pi Emotion Trace</title>
<style>
:root{color-scheme:light dark;--bg:#f5f7fb;--panel:#fff;--text:#182230;--muted:#667085;--line:#d9dee8;--accent:#6658d3;--shadow:0 12px 36px rgba(24,34,48,.08)}
@media(prefers-color-scheme:dark){:root{--bg:#11151c;--panel:#1b222c;--text:#ecf0f5;--muted:#9ba7b5;--line:#364150;--accent:#a89cf5;--shadow:0 12px 36px rgba(0,0,0,.28)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1600px;margin:auto;padding:32px}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;margin-bottom:22px}h1{font-size:34px;line-height:1.1;margin:0 0 8px}h2{font-size:20px;margin:0 0 16px}.subtitle,.muted,small{color:var(--muted)}.summary{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:12px;margin:20px 0}.summary-card,.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}.summary-card{padding:15px 17px}.summary-card span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}.summary-card strong{display:block;font-size:25px;margin-top:3px}.panel{padding:20px;margin:18px 0}.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}.filter{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:999px;padding:7px 12px;cursor:pointer}.filter[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}.legend{display:flex;gap:16px;flex-wrap:wrap;margin-left:auto;color:var(--muted)}.legend b{color:var(--text)}.chart-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.trace-chart{display:block}.chart-background{fill:var(--panel)}.grid-line{stroke:var(--line);stroke-width:1}.grid-line.zero{stroke:var(--muted);stroke-width:1.4}.axis-tick{stroke:var(--muted)}.axis-label,.axis-title{fill:var(--muted);font-size:12px}.axis-title{font-weight:600;letter-spacing:.06em}.trace-segment{stroke-width:2.4;stroke-linecap:round}.trace-point{cursor:pointer;outline:none}.trace-point:focus{filter:drop-shadow(0 0 4px var(--accent))}.hit-area{fill:transparent}.doubt-mark{fill:#b7791f;font-size:15px;font-weight:800}.annotation line{stroke:var(--line);stroke-dasharray:3 3}.annotation text{fill:var(--text);font-size:11px;font-weight:600}.dimmed{opacity:.12}.hover-card{min-height:58px;margin-top:12px;padding:12px 14px;border-radius:10px;background:color-mix(in srgb,var(--accent) 8%,var(--panel));border:1px solid color-mix(in srgb,var(--accent) 25%,var(--line))}.hover-card strong{margin-right:8px}.table-scroll{overflow:auto;max-height:720px}table{border-collapse:collapse;width:100%;min-width:1150px}th{position:sticky;top:0;background:var(--panel);z-index:1;text-align:left;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}th,td{padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:top}td small{display:block}.score{color:var(--score-color);font-size:16px;font-weight:750}.tag{display:inline-block;border-radius:999px;padding:2px 7px;margin:0 2px 3px 0;font-size:11px}.tag.kind{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}.tag.signal{background:color-mix(in srgb,#e9a23b 18%,transparent);color:#a15c00}mark{background:color-mix(in srgb,#f4c95d 42%,transparent);color:var(--text);border-radius:3px;padding:1px 3px;margin-right:3px}.excerpt{max-width:430px}.note{font-size:12px;color:var(--muted);margin-top:14px}@media(max-width:900px){main{padding:18px}header{display:block}.summary{grid-template-columns:repeat(2,1fr)}.legend{width:100%;margin:6px 0 0}}
</style>
</head>
<body>
<main>
<header><div><h1>Pi Emotion Trace</h1><div class="subtitle">Emotional valence and interaction signals across verified interactive prompts</div></div><div class="muted">${first ? `${escapeHtml(formatTimestamp(first))} — ${escapeHtml(formatTimestamp(last!))}` : "No prompts"}</div></header>
<section class="summary">${summaryCards(result)}</section>
<section class="panel"><div class="toolbar"><button class="filter" data-filter="all" aria-pressed="true">All prompts</button><button class="filter" data-filter="steering" aria-pressed="false">Steering</button><button class="filter" data-filter="rejection" aria-pressed="false">Rejections</button><button class="filter" data-filter="doubt" aria-pressed="false">Doubts</button><div class="legend"><span><b>◆</b> steering</span><span><b>×</b> rejection</span><span><b>?</b> doubt</span></div></div><div class="chart-scroll">${chartSvg(points)}</div><div id="hover-card" class="hover-card" aria-live="polite">Hover or focus a point to inspect its score, signals, keywords, and excerpt.</div><p class="note">Color represents valence from negative (red) through neutral (gray) to positive (green). Marker symbols represent interaction signals independently of emotion.</p></section>
<section class="panel"><h2>Prompt timeline</h2><div class="table-scroll"><table><thead><tr><th>Time</th><th>Valence</th><th>Emotion</th><th>Interaction</th><th>Keywords</th><th>Prompt excerpt</th></tr></thead><tbody>${tableRows(points)}</tbody></table></div></section>
<section class="panel note"><strong>Coverage:</strong> ${escapeHtml(coverageNote)} ${result.coverage.sessionsRead} of ${result.coverage.sessionsDiscovered} selected sessions were read; ${result.coverage.promptsAnalyzed} of ${result.coverage.promptsFound} verified prompts were analyzed; ${result.coverage.charactersSubmitted.toLocaleString("en-US")} prompt characters were submitted. Generated ${escapeHtml(formatTimestamp(result.generatedAt))} with ${escapeHtml(result.model)}.<br><strong>Interpretation:</strong> Scores describe wording expressed in prompts. They are not a clinical assessment or an inference about the user's enduring emotional state.</section>
</main>
<script>
const hoverCard=document.getElementById('hover-card');
for(const point of document.querySelectorAll('.trace-point')){
 const show=()=>{const d=point.dataset;hoverCard.textContent=(d.date||'')+' · '+(d.score||'')+' '+(d.emotion||'')+' · '+(d.interaction||'')+(d.signals?' ['+d.signals.replaceAll(' ', ', ')+']':'')+(d.keywords?' · '+d.keywords:'')+' — '+(d.excerpt||'')};
 point.addEventListener('mouseenter',show);point.addEventListener('focus',show);
}
for(const button of document.querySelectorAll('.filter')){
 button.addEventListener('click',()=>{const filter=button.dataset.filter;for(const other of document.querySelectorAll('.filter'))other.setAttribute('aria-pressed',String(other===button));
  for(const item of document.querySelectorAll('.trace-point,.annotation')){const matches=filter==='all'||item.dataset.kind===filter||(item.dataset.signals||'').split(' ').includes(filter);item.classList.toggle('dimmed',!matches)}
  for(const row of document.querySelectorAll('tbody tr')){const matches=filter==='all'||row.dataset.kind===filter||(row.dataset.signals||'').split(' ').includes(filter);row.hidden=!matches}
 });
}
</script>
</body>
</html>`;
}
