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
	if (score <= 20) return "#c63d4f";
	if (score < 45) return "#e76f51";
	if (score <= 55) return "#7a8794";
	if (score < 80) return "#49a078";
	return "#168a76";
}

function scoreLabel(score: number): string {
	return String(score);
}

function isNeutral(point: PromptTracePoint): boolean {
	return point.score === 50 || point.emotion === "neutral";
}

function markerShape(point: PromptTracePoint, x: number, y: number): string {
	const color = scoreColor(point.score);
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
			const previous = points[index - 1]?.score ?? point.score;
			let weight =
				Math.abs(point.score - 50) / 9 + Math.abs(point.score - previous) / 11;
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
	if (points.length === 0) {
		return '<div class="empty-chart">No non-neutral prompts to plot in this window.</div>';
	}
	const width = Math.max(900, CHART_LEFT + CHART_RIGHT + points.length * 18);
	const plotWidth = width - CHART_LEFT - CHART_RIGHT;
	const plotHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
	const timestamps = points.map((point) => Date.parse(point.timestamp));
	const minimumTime = Math.min(...timestamps);
	const maximumTime = Math.max(...timestamps);
	const timeSpan = Math.max(1, maximumTime - minimumTime);
	const xAt = (index: number) =>
		points.length === 1
			? CHART_LEFT + plotWidth / 2
			: CHART_LEFT + (index / (points.length - 1)) * plotWidth;
	const yAt = (score: number) => CHART_TOP + ((100 - score) / 100) * plotHeight;
	const rounded = (value: number) => Number(value.toFixed(2));
	const coordinates = points.map((point, index) => ({
		x: xAt(index),
		y: yAt(point.score),
	}));
	const grid = [100, 75, 50, 25, 0]
		.map((score) => {
			const y = yAt(score);
			return `<line x1="${CHART_LEFT}" y1="${y}" x2="${width - CHART_RIGHT}" y2="${y}" class="grid-line${score === 50 ? " neutral" : ""}"/><text x="${CHART_LEFT - 14}" y="${y + 5}" class="axis-label" text-anchor="end">${scoreLabel(score)}</text>`;
		})
		.join("");
	const tickCount = Math.min(6, points.length);
	const tickIndexes =
		tickCount === 1
			? [0]
			: Array.from({ length: tickCount }, (_, index) =>
					Math.round((index / (tickCount - 1)) * (points.length - 1)),
				);
	const promptTicks = tickIndexes
		.map((pointIndex, tickIndex) => {
			const x = xAt(pointIndex);
			const label = formatAxisTimestamp(timestamps[pointIndex]!, timeSpan);
			const anchor =
				tickIndex === 0 ? "start" : tickIndex === tickIndexes.length - 1 ? "end" : "middle";
			return `<line x1="${x}" y1="${CHART_HEIGHT - CHART_BOTTOM}" x2="${x}" y2="${CHART_HEIGHT - CHART_BOTTOM + 7}" class="axis-tick"/><text x="${x}" y="${CHART_HEIGHT - CHART_BOTTOM + 28}" class="axis-label" text-anchor="${anchor}">${label}</text>`;
		})
		.join("");
	const segments = points
		.slice(0, -1)
		.map((point, index) => {
			const p0 = coordinates[Math.max(0, index - 1)]!;
			const p1 = coordinates[index]!;
			const p2 = coordinates[index + 1]!;
			const p3 = coordinates[Math.min(coordinates.length - 1, index + 2)]!;
			const controlOne = {
				x: p1.x + (p2.x - p0.x) / 6,
				y: p1.y + (p2.y - p0.y) / 6,
			};
			const controlTwo = {
				x: p2.x - (p3.x - p1.x) / 6,
				y: p2.y - (p3.y - p1.y) / 6,
			};
			const average = Math.round((point.score + points[index + 1]!.score) / 2);
			return `<path d="M ${rounded(p1.x)} ${rounded(p1.y)} C ${rounded(controlOne.x)} ${rounded(controlOne.y)}, ${rounded(controlTwo.x)} ${rounded(controlTwo.y)}, ${rounded(p2.x)} ${rounded(p2.y)}" stroke="${scoreColor(average)}" class="trace-segment"/>`;
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
			const title = `${formatTimestamp(point.timestamp)} | score ${scoreLabel(point.score)} ${point.emotion} | ${point.interactionKind}${point.signals.length ? `: ${point.signals.join(", ")}` : ""}${keywords ? ` | ${keywords}` : ""}`;
			return `<g class="trace-point" tabindex="0" role="img" data-kind="${point.interactionKind}" data-signals="${point.signals.join(" ")}" data-date="${escapeHtml(formatTimestamp(point.timestamp))}" data-score="${scoreLabel(point.score)}" data-emotion="${point.emotion}" data-interaction="${point.interactionKind}" data-keywords="${escapeHtml(keywords)}" data-excerpt="${escapeHtml(point.excerpt)}"><title>${escapeHtml(title)}</title><circle cx="${coordinate.x}" cy="${coordinate.y}" r="11" class="hit-area"/>${markerShape(point, coordinate.x, coordinate.y)}</g>`;
		})
		.join("");
	return `<svg class="trace-chart" viewBox="0 0 ${width} ${CHART_HEIGHT}" width="${width}" height="${CHART_HEIGHT}" aria-label="Emotional score by prompt order" role="img"><rect width="${width}" height="${CHART_HEIGHT}" class="chart-background"/>${grid}${promptTicks}<text x="18" y="${CHART_TOP + plotHeight / 2}" class="axis-title" text-anchor="middle" transform="rotate(-90 18 ${CHART_TOP + plotHeight / 2})">emotional score</text><text x="${CHART_LEFT + plotWidth / 2}" y="${CHART_HEIGHT - 12}" class="axis-title" text-anchor="middle">prompt order · equal spacing</text>${segments}${annotations}${markers}</svg>`;
}

function summaryCards(result: EmotionTraceResult): string {
	const { points } = result;
	const plotted = points.filter((point) => !isNeutral(point));
	const average =
		plotted.length === 0
			? undefined
			: plotted.reduce((total, point) => total + point.score, 0) / plotted.length;
	const cards = [
		["Plotted prompts", String(plotted.length)],
		["Average score", average === undefined ? "—" : average.toFixed(1)],
		["Steering", String(plotted.filter((point) => point.interactionKind === "steering").length)],
		["Rejections", String(signalCount(plotted, "rejection"))],
		["Doubts", String(signalCount(plotted, "doubt"))],
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
			return `<tr data-kind="${point.interactionKind}" data-signals="${point.signals.join(" ")}"><td><time>${escapeHtml(formatTimestamp(point.timestamp))}</time></td><td><span class="score" style="--score-color:${scoreColor(point.score)}">${scoreLabel(point.score)}</span></td><td>${escapeHtml(point.emotion)}<small>${escapeHtml(point.confidence)} confidence</small></td><td>${tags}</td><td>${keywords || "<span class=\"muted\">none</span>"}</td><td class="excerpt">${escapeHtml(point.excerpt)}</td></tr>`;
		})
		.join("");
}

export function renderEmotionTraceHtml(result: EmotionTraceResult): string {
	const points = result.points;
	const plottedPoints = points.filter((point) => !isNeutral(point));
	const neutralExcluded = points.length - plottedPoints.length;
	const first = points[0]?.timestamp;
	const last = points.at(-1)?.timestamp;
	const coverageNote = result.coverage.truncated
		? "Coverage was bounded by configured limits or unavailable skill classifications."
		: "All prompts found in the selected history window were included.";
	const omittedNote =
		result.coverage.classificationsOmitted > 0
			? ` ${result.coverage.classificationsOmitted} malformed skill classifications were omitted after retry.`
			: "";
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
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1600px;margin:auto;padding:32px}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;margin-bottom:22px}h1{font-size:34px;line-height:1.1;margin:0 0 8px}h2{font-size:20px;margin:0 0 16px}.subtitle,.muted,small{color:var(--muted)}.summary{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:12px;margin:20px 0}.summary-card,.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}.summary-card{padding:15px 17px}.summary-card span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}.summary-card strong{display:block;font-size:25px;margin-top:3px}.panel{padding:20px;margin:18px 0}.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}.filter{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:999px;padding:7px 12px;cursor:pointer}.filter[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}.legend{display:flex;gap:16px;flex-wrap:wrap;margin-left:auto;color:var(--muted)}.legend b{color:var(--text)}.chart-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.trace-chart{display:block}.chart-background{fill:var(--panel)}.grid-line{stroke:var(--line);stroke-width:1}.grid-line.neutral{stroke:var(--muted);stroke-width:1.4}.axis-tick{stroke:var(--muted)}.axis-label,.axis-title{fill:var(--muted);font-size:12px}.axis-title{font-weight:600;letter-spacing:.06em}.trace-segment{fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}.empty-chart{min-height:320px;display:grid;place-items:center;color:var(--muted);font-size:16px}.trace-point{cursor:pointer;outline:none}.trace-point:focus{filter:drop-shadow(0 0 4px var(--accent))}.hit-area{fill:transparent}.doubt-mark{fill:#b7791f;font-size:15px;font-weight:800}.annotation line{stroke:var(--line);stroke-dasharray:3 3}.annotation text{fill:var(--text);font-size:11px;font-weight:600}.dimmed{opacity:.12}.hover-card{min-height:58px;margin-top:12px;padding:12px 14px;border-radius:10px;background:color-mix(in srgb,var(--accent) 8%,var(--panel));border:1px solid color-mix(in srgb,var(--accent) 25%,var(--line))}.hover-card strong{margin-right:8px}.table-scroll{overflow:auto;max-height:720px}table{border-collapse:collapse;width:100%;min-width:1150px}th{position:sticky;top:0;background:var(--panel);z-index:1;text-align:left;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}th,td{padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:top}td small{display:block}.score{color:var(--score-color);font-size:16px;font-weight:750}.tag{display:inline-block;border-radius:999px;padding:2px 7px;margin:0 2px 3px 0;font-size:11px}.tag.kind{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}.tag.signal{background:color-mix(in srgb,#e9a23b 18%,transparent);color:#a15c00}mark{background:color-mix(in srgb,#f4c95d 42%,transparent);color:var(--text);border-radius:3px;padding:1px 3px;margin-right:3px}.excerpt{max-width:430px}.note{font-size:12px;color:var(--muted);margin-top:14px}@media(max-width:900px){main{padding:18px}header{display:block}.summary{grid-template-columns:repeat(2,1fr)}.legend{width:100%;margin:6px 0 0}}
</style>
</head>
<body>
<main>
<header><div><h1>Pi Emotion Trace</h1><div class="subtitle">0–100 emotional score and interaction signals across chronological prompts</div></div><div class="muted">${first ? `${escapeHtml(formatTimestamp(first))} — ${escapeHtml(formatTimestamp(last!))}` : "No prompts"}</div></header>
<section class="summary">${summaryCards(result)}</section>
<section class="panel"><div class="toolbar"><button class="filter" data-filter="all" aria-pressed="true">All prompts</button><button class="filter" data-filter="steering" aria-pressed="false">Steering</button><button class="filter" data-filter="rejection" aria-pressed="false">Rejections</button><button class="filter" data-filter="doubt" aria-pressed="false">Doubts</button><div class="legend"><span><b>◆</b> steering</span><span><b>×</b> rejection</span><span><b>?</b> doubt</span></div></div><div class="chart-scroll">${chartSvg(plottedPoints)}</div><div id="hover-card" class="hover-card" aria-live="polite">Hover or focus a point to inspect its score, signals, keywords, and excerpt.</div><p class="note">Scores run from 0 (most negative) through 50 (neutral) to 100 (most positive). Prompts are equally spaced by chronological order, and the curve is smoothed between points. ${neutralExcluded} neutral prompt${neutralExcluded === 1 ? " was" : "s were"} excluded from the curve but retained in the table.</p></section>
<section class="panel"><h2>Prompt timeline</h2><div class="table-scroll"><table><thead><tr><th>Time</th><th>Score</th><th>Emotion</th><th>Interaction</th><th>Keywords</th><th>Prompt excerpt</th></tr></thead><tbody>${tableRows(points)}</tbody></table></div></section>
<section class="panel note"><strong>Coverage:</strong> ${escapeHtml(coverageNote)} ${result.coverage.sessionsRead} of ${result.coverage.sessionsDiscovered} selected sessions were read; ${result.coverage.promptsFound} prompts were discovered; ${result.coverage.promptsAnalyzed} of ${result.coverage.promptsSubmitted} submitted prompts produced well-formed skill classifications.${escapeHtml(omittedNote)} ${result.coverage.charactersSubmitted.toLocaleString("en-US")} prompt characters were submitted. Generated ${escapeHtml(formatTimestamp(result.generatedAt))} with ${escapeHtml(result.model)}.<br><strong>Interpretation:</strong> Scores and semantic labels come only from the classifier model applying the packaged skill; the host does not derive or synthesize them. Scores describe wording expressed in prompts, not a clinical assessment or an inference about enduring emotional state.</section>
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
