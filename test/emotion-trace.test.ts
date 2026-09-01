// SPDX-License-Identifier: MPL-2.0

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	buildClassificationPlan,
	classifyPromptHistory,
	parseClassificationBatch,
} from "../src/classifier.ts";
import {
	loadPromptHistory,
	readSessionEntriesReadOnly,
} from "../src/history.ts";
import { renderEmotionTraceHtml } from "../src/report.ts";
import type {
	EmotionTraceResult,
	EmotionTraceSettings,
	HistoricalPrompt,
	SessionSource,
} from "../src/types.ts";

const settings: EmotionTraceSettings = {
	historyWindow: "90d",
	maxPrompts: 2,
	modelCatalog: "scoped",
	classifierModel: "example/model",
};

test("loads only chronological human prompts and keeps the newest limit", async () => {
	const now = Date.now();
	const source: SessionSource = {
		id: "session-one",
		path: "/private/session-one.jsonl",
		created: new Date(now - 10_000),
		modified: new Date(now),
	};
	const entries = [
		{
			type: "message",
			id: "u1",
			timestamp: new Date(now - 3_000).toISOString(),
			message: { role: "user", content: "first prompt" },
		},
		{
			type: "message",
			id: "a1",
			timestamp: new Date(now - 2_500).toISOString(),
			message: { role: "assistant", content: "assistant prose" },
		},
		{
			type: "message",
			id: "u2",
			timestamp: new Date(now - 2_000).toISOString(),
			message: {
				role: "user",
				content: [{ type: "text", text: "second prompt" }],
			},
		},
		{
			type: "message",
			id: "u3",
			timestamp: new Date(now - 1_000).toISOString(),
			message: { role: "user", content: "third prompt" },
		},
	];
	const history = await loadPromptHistory(
		[source],
		async () => entries,
		settings,
	);
	assert.deepEqual(
		history.prompts.map(({ text }) => text),
		["second prompt", "third prompt"],
	);
	assert.equal(history.sessionsRead, 1);
	assert.equal(history.promptsFound, 3);
	assert.equal(history.truncated, true);
});

test("selects recent prompts globally instead of stopping at prompt-heavy sessions", async () => {
	const now = Date.now();
	const sources: SessionSource[] = Array.from({ length: 9 }, (_, index) => ({
		id: `session-${index}`,
		path: `/private/session-${index}.jsonl`,
		created: new Date(now - 200_000),
		modified: new Date(now - index * 1_000),
	}));
	const history = await loadPromptHistory(
		sources,
		async (source) => {
			const index = Number(source.id.slice("session-".length));
			const newest = index === 8;
			return [
				{
					type: "message",
					id: `prompt-${index}`,
					timestamp: new Date(now - (newest ? 10_000 : 100_000 + index)).toISOString(),
					message: {
						role: "user",
						content: newest ? "globally newest" : `older ${index}`,
					},
				},
			];
		},
		{ ...settings, maxPrompts: 1 },
	);
	assert.equal(history.sessionsRead, 9);
	assert.deepEqual(history.prompts.map(({ text }) => text), ["globally newest"]);
});

test("reads legacy session JSONL without modifying it", async () => {
	const directory = await mkdtemp(join(tmpdir(), "emotion-trace-history-"));
	const path = join(directory, "session.jsonl");
	const content = [
		JSON.stringify({
			type: "session",
			version: 1,
			id: "legacy-session",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: "/private/project",
		}),
		JSON.stringify({
			type: "message",
			id: "user-one",
			parentId: null,
			timestamp: "2026-01-01T00:00:01.000Z",
			message: {
				role: "user",
				content: "human prompt",
				timestamp: 1_767_225_601_000,
			},
		}),
	].join("\n");
	try {
		await writeFile(path, content, "utf8");
		const entries = await readSessionEntriesReadOnly({
			id: "legacy-session",
			path,
			created: new Date("2026-01-01T00:00:00.000Z"),
			modified: new Date("2026-01-01T00:00:01.000Z"),
		});
		assert.equal(entries.length, 1);
		assert.equal(await readFile(path, "utf8"), content);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("accepts only well-formed skill classifications", () => {
	const timestamp = new Date().toISOString();
	const prompts: HistoricalPrompt[] = [
		{
			id: "one",
			sessionId: "private-session-id",
			timestamp,
			text: "Continue.",
		},
		{
			id: "two",
			sessionId: "private-session-id",
			timestamp,
			text: "No, that is not what I asked. Stop and use a line chart.",
		},
	];
	const plan = buildClassificationPlan(prompts, "classifier instructions");
	assert.equal(plan.promptCount, 2);
	assert.match(plan.batches[0]!.prompt, /"session_ref":"S0001"/);
	assert.match(plan.batches[0]!.prompt, /"previous_user_text":"Continue\."/);
	assert.doesNotMatch(plan.batches[0]!.prompt, /private-session-id/);
	const validClassifications = [
		{
			prompt_ref: "P0001",
			score: 50,
			emotion: "neutral",
			confidence: "high",
			emotion_keywords: [],
			excerpt: "Continue.",
			interaction_kind: "request",
			signals: [],
			signal_keywords: [],
		},
		{
			prompt_ref: "P0002",
			score: 24,
			emotion: "frustrated",
			confidence: "high",
			emotion_keywords: ["not what I asked"],
			excerpt: "No, that is not what I asked. Stop and use a line chart.",
			interaction_kind: "steering",
			signals: ["steering", "rejection", "correction"],
			signal_keywords: ["Stop"],
		},
	];
	const points = parseClassificationBatch(
		JSON.stringify({ classifications: validClassifications }),
		plan.batches[0]!,
	);
	assert.deepEqual(points[0]!.signals, []);
	assert.deepEqual(points[0]!.emotionKeywords, []);
	assert.deepEqual(points[1]!.signals, ["steering", "rejection", "correction"]);
	assert.deepEqual(points[1]!.signalKeywords, ["Stop"]);
	assert.equal(points[1]!.annotationKeyword, "Stop");
	const fullPromptKeyword = structuredClone(validClassifications);
	fullPromptKeyword[0]!.emotion_keywords = ["Continue."];
	const guardedAnnotations = parseClassificationBatch(
		JSON.stringify({ classifications: fullPromptKeyword }),
		plan.batches[0]!,
	);
	assert.equal(guardedAnnotations[0]!.annotationKeyword, undefined);
	assert.equal(
		points[1]!.excerpt,
		"No, that is not what I asked. Stop and use a line chart.",
	);
	const partial = parseClassificationBatch(
		JSON.stringify({ classifications: validClassifications.slice(0, 1) }),
		plan.batches[0]!,
	);
	assert.deepEqual(partial.map(({ id }) => id), ["one"]);
	const malformed = structuredClone(validClassifications);
	malformed[1]!.signals = ["rejection", "correction"];
	const withoutInvalidSignals = parseClassificationBatch(
		JSON.stringify({ classifications: malformed }),
		plan.batches[0]!,
	);
	assert.deepEqual(withoutInvalidSignals.map(({ id }) => id), ["one"]);
	const invalidScore = structuredClone(validClassifications);
	invalidScore[0]!.score = "50" as unknown as number;
	const withoutInvalidScore = parseClassificationBatch(
		JSON.stringify({ classifications: invalidScore }),
		plan.batches[0]!,
	);
	assert.deepEqual(withoutInvalidScore.map(({ id }) => id), ["two"]);
});

test("retries malformed skill output without scripting a replacement", async () => {
	const timestamp = new Date().toISOString();
	const plan = buildClassificationPlan(
		[
			{
				id: "one",
				sessionId: "session",
				timestamp,
				text: "I doubt this conclusion.",
			},
		],
		"classifier instructions",
	);
	let attempts = 0;
	const points = await classifyPromptHistory(plan, async () => {
		attempts++;
		return JSON.stringify({
			classifications: [
				{
					prompt_ref: "P0001",
					score: attempts === 1 ? "35" : 35,
					emotion: "uncertain",
					confidence: "high",
					emotion_keywords: ["I doubt"],
					excerpt: "I doubt this conclusion.",
					interaction_kind: "request",
					signals: ["doubt"],
					signal_keywords: ["I doubt"],
				},
			],
		});
	});
	assert.equal(attempts, 2);
	assert.equal(points.length, 1);
	assert.equal(points[0]!.score, 35);
});

test("the classifier character cap keeps the newest prompts", () => {
	const prompts: HistoricalPrompt[] = Array.from({ length: 100 }, (_, index) => ({
		id: `prompt-${index}`,
		sessionId: "one-session",
		timestamp: new Date(1_700_000_000_000 + index).toISOString(),
		text: `${index}: ${"x".repeat(2_200)}`,
	}));
	const plan = buildClassificationPlan(prompts, "classifier instructions");
	const selected = plan.batches.flatMap((batch) => batch.items);
	assert.equal(plan.truncated, true);
	assert.ok(plan.promptCount < prompts.length);
	assert.notEqual(selected[0]!.prompt.id, "prompt-0");
	assert.equal(selected.at(-1)!.prompt.id, "prompt-99");
	assert.ok(plan.promptCharacters <= 180_000);
});

test("omits full prompt text and the timeline table from the report", () => {
	const timestamp = new Date().toISOString();
	const result: EmotionTraceResult = {
		generatedAt: timestamp,
		historyWindow: "90d",
		model: "example/model</script><script>alert(1)</script>",
		coverage: {
			sessionsDiscovered: 1,
			sessionsRead: 1,
			promptsFound: 1,
			promptsSubmitted: 1,
			promptsAnalyzed: 1,
			classificationsOmitted: 0,
			charactersSubmitted: 20,
			truncated: false,
		},
		points: [
			{
				id: "one",
				timestamp,
				score: 35,
				emotion: "uncertain",
				confidence: "high",
				emotionKeywords: ["PRIVATE_EMOTION_SOURCE_SPAN"],
				excerpt: "PRIVATE_FULL_PROMPT_TEXT</script><script>promptLeak()</script>",
				interactionKind: "steering",
				signals: ["steering", "doubt"],
				signalKeywords: ["PRIVATE_SIGNAL_SOURCE_SPAN"],
				annotationKeyword: "PRIVATE_SIGNAL_SOURCE_SPAN",
			},
		],
	};
	const html = renderEmotionTraceHtml(result);
	assert.match(html, /Content-Security-Policy/);
	assert.match(html, /data-filter="steering"/);
	assert.match(html, /data-filter="rejection"/);
	assert.match(html, /data-filter="doubt"/);
	assert.match(html, /example\/model&lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	assert.doesNotMatch(html, /PRIVATE_FULL_PROMPT_TEXT/);
	assert.doesNotMatch(html, /PRIVATE_EMOTION_SOURCE_SPAN/);
	assert.match(html, /PRIVATE_SIGNAL_SOURCE_SPAN/);
	assert.equal(html.match(/class="pie-chart"/g)?.length, 2);
	assert.match(html, /Emotion distribution/);
	assert.match(html, /Interaction distribution/);
	assert.doesNotMatch(html, /<table|Prompt timeline|data-excerpt|data-keywords|Prompt excerpt/);
	assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
	assert.doesNotMatch(html, /<script src=/);
});
