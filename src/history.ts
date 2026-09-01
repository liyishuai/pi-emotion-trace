// SPDX-License-Identifier: MPL-2.0

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { historyWindowDays } from "./settings.ts";
import type {
	AnalysisProgress,
	EmotionTraceSettings,
	HistoricalPrompt,
	SessionSource,
} from "./types.ts";

const MAX_SESSION_FILES = 1_000;
const LOAD_CONCURRENCY = 8;

export type SessionLoader = (source: SessionSource) => Promise<unknown[]>;

type HistoryLoadResult = {
	prompts: HistoricalPrompt[];
	sessionsDiscovered: number;
	sessionsRead: number;
	promptsFound: number;
	truncated: boolean;
};

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) => {
			const block = record(part);
			return block?.type === "text" && typeof block.text === "string"
				? [block.text]
				: [];
		})
		.join("\n")
		.trim();
}

function timestampFromEntry(
	entry: Record<string, unknown>,
	message: Record<string, unknown>,
): string | undefined {
	const entryTimestamp = entry.timestamp;
	if (typeof entryTimestamp === "string" && Number.isFinite(Date.parse(entryTimestamp))) {
		return new Date(entryTimestamp).toISOString();
	}
	const messageTimestamp = message.timestamp;
	if (typeof messageTimestamp === "number" && Number.isFinite(messageTimestamp)) {
		return new Date(messageTimestamp).toISOString();
	}
	return undefined;
}

function parseSessionLine(line: string): unknown {
	try {
		return JSON.parse(line) as unknown;
	} catch (error) {
		throw new Error("A historical session contains malformed JSON", { cause: error });
	}
}

function keepRelevantLine(entries: unknown[], line: string): void {
	if (!line.includes('"role"') || !line.includes('"user"')) return;
	const value = parseSessionLine(line);
	const entry = record(value);
	const message = record(entry?.message);
	if (entry?.type === "message" && message?.role === "user") entries.push(value);
}

export async function readSessionEntriesReadOnly(
	source: SessionSource,
): Promise<unknown[]> {
	const entries: unknown[] = [];
	const input = createReadStream(source.path, { encoding: "utf8" });
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	let previousLine: string | undefined;
	try {
		for await (const line of lines) {
			if (previousLine?.trim()) keepRelevantLine(entries, previousLine);
			previousLine = line;
		}
		if (previousLine?.trim()) {
			try {
				keepRelevantLine(entries, previousLine);
			} catch (error) {
				const recentlyModified = Date.now() - source.modified.getTime() < 30_000;
				if (!recentlyModified) throw error;
				// A concurrently active session can end with one incomplete JSONL record.
			}
		}
		return entries;
	} catch (error) {
		throw new Error(`Could not read historical session ${source.id}`, {
			cause: error,
		});
	} finally {
		lines.close();
		input.destroy();
	}
}

function promptsFromEntries(
	source: SessionSource,
	entries: unknown[],
	cutoff: number,
): HistoricalPrompt[] {
	const prompts: HistoricalPrompt[] = [];
	for (const [index, rawEntry] of entries.entries()) {
		const entry = record(rawEntry);
		if (!entry || entry.type !== "message") continue;
		const message = record(entry.message);
		if (!message || message.role !== "user") continue;
		const text = contentText(message.content);
		if (!text) continue;
		const timestamp = timestampFromEntry(entry, message);
		if (!timestamp || Date.parse(timestamp) < cutoff) continue;
		const entryId = typeof entry.id === "string" ? entry.id : String(index);
		prompts.push({
			id: `${source.id}:${entryId}`,
			sessionId: source.id,
			timestamp,
			text,
		});
	}
	return prompts;
}

function deduplicate(prompts: HistoricalPrompt[]): HistoricalPrompt[] {
	const seen = new Set<string>();
	return prompts.filter((prompt) => {
		const key = `${prompt.timestamp}\u0000${prompt.text}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export async function loadPromptHistory(
	sources: SessionSource[],
	loadEntries: SessionLoader,
	settings: EmotionTraceSettings,
	onProgress?: (progress: AnalysisProgress) => void,
): Promise<HistoryLoadResult> {
	const days = historyWindowDays(settings.historyWindow);
	const cutoff =
		days === 0
			? Number.NEGATIVE_INFINITY
			: Date.now() - days * 24 * 60 * 60 * 1_000;
	const matchingSources = sources
		.filter((source) => source.modified.getTime() >= cutoff)
		.sort(
			(a, b) =>
				b.modified.getTime() - a.modified.getTime() || a.id.localeCompare(b.id),
		);
	const eligible = matchingSources.slice(0, MAX_SESSION_FILES);
	onProgress?.({ phase: "sessions", completed: 0, total: eligible.length });
	let sessionsRead = 0;
	const found: HistoricalPrompt[] = [];
	for (let index = 0; index < eligible.length; index += LOAD_CONCURRENCY) {
		const batch = eligible.slice(index, index + LOAD_CONCURRENCY);
		const batchPrompts = await Promise.all(
			batch.map(async (source) => {
				try {
					return promptsFromEntries(source, await loadEntries(source), cutoff);
				} finally {
					sessionsRead++;
					onProgress?.({
						phase: "sessions",
						completed: sessionsRead,
						total: eligible.length,
					});
				}
			}),
		);
		found.push(...batchPrompts.flat());
	}
	const chronological = deduplicate(found).sort(
		(a, b) =>
			a.timestamp.localeCompare(b.timestamp) ||
			a.sessionId.localeCompare(b.sessionId) ||
			a.id.localeCompare(b.id),
	);
	const prompts = chronological.slice(-settings.maxPrompts);
	return {
		prompts,
		sessionsDiscovered: matchingSources.length,
		sessionsRead,
		promptsFound: chronological.length,
		truncated:
			matchingSources.length > MAX_SESSION_FILES ||
			chronological.length > settings.maxPrompts,
	};
}
