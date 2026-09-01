// SPDX-License-Identifier: MPL-2.0

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	HISTORY_WINDOWS,
	MODEL_CATALOGS,
	PROMPT_LIMITS,
	type EmotionTraceSettings,
	type HistoryWindow,
	type ModelCatalog,
} from "./types.ts";

export const DEFAULT_CLASSIFIER_MODEL = "openai-codex/gpt-5.3-codex-spark";
export const EMOTION_TRACE_DIRECTORY = join(getAgentDir(), "emotion-trace");
export const EMOTION_TRACE_CONFIG_PATH = join(EMOTION_TRACE_DIRECTORY, "config.json");
export const EMOTION_TRACE_REPORT_PATH = join(EMOTION_TRACE_DIRECTORY, "report.html");

type StoredSettings = Partial<EmotionTraceSettings>;

function defaults(): EmotionTraceSettings {
	return {
		historyWindow: "90d",
		maxPrompts: 500,
		modelCatalog: "scoped",
		classifierModel: DEFAULT_CLASSIFIER_MODEL,
	};
}

function sanitize(value: StoredSettings | undefined): EmotionTraceSettings {
	const fallback = defaults();
	const windowValue = String(value?.historyWindow ?? "");
	const historyWindow = (HISTORY_WINDOWS as readonly string[]).includes(windowValue)
		? (windowValue as HistoryWindow)
		: fallback.historyWindow;
	const promptLimit = Number(value?.maxPrompts);
	const maxPrompts = (PROMPT_LIMITS as readonly number[]).includes(promptLimit)
		? promptLimit
		: fallback.maxPrompts;
	const catalogValue = String(value?.modelCatalog ?? "");
	const modelCatalog = (MODEL_CATALOGS as readonly string[]).includes(catalogValue)
		? (catalogValue as ModelCatalog)
		: fallback.modelCatalog;
	const configuredModel = String(value?.classifierModel ?? "").trim();
	return {
		historyWindow,
		maxPrompts,
		modelCatalog,
		classifierModel: configuredModel || fallback.classifierModel,
	};
}

export function loadEmotionTraceSettings(): EmotionTraceSettings {
	try {
		if (!existsSync(EMOTION_TRACE_CONFIG_PATH)) return defaults();
		return sanitize(
			JSON.parse(readFileSync(EMOTION_TRACE_CONFIG_PATH, "utf8")) as StoredSettings,
		);
	} catch {
		return defaults();
	}
}

export function saveEmotionTraceSettings(settings: EmotionTraceSettings): boolean {
	try {
		mkdirSync(EMOTION_TRACE_DIRECTORY, { recursive: true, mode: 0o700 });
		const temporaryPath = `${EMOTION_TRACE_CONFIG_PATH}.tmp`;
		writeFileSync(temporaryPath, `${JSON.stringify(sanitize(settings), null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporaryPath, EMOTION_TRACE_CONFIG_PATH);
		return true;
	} catch {
		return false;
	}
}

export function historyWindowDays(window: HistoryWindow): number {
	if (window === "all") return 0;
	return Number.parseInt(window, 10);
}
