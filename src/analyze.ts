// SPDX-License-Identifier: MPL-2.0

import {
	buildClassificationPlan,
	classifyPromptHistory,
	type ClassifierCall,
} from "./classifier.ts";
import { loadPromptHistory } from "./history.ts";
import type {
	AnalysisProgress,
	EmotionTraceResult,
	EmotionTraceSettings,
	SessionSource,
} from "./types.ts";

export type SessionLoader = (source: SessionSource) => Promise<unknown[]>;

export async function analyzeEmotionHistory(
	sources: SessionSource[],
	loadEntries: SessionLoader,
	callClassifier: ClassifierCall,
	classifierSkill: string,
	settings: EmotionTraceSettings,
	modelLabel: string,
	onProgress?: (progress: AnalysisProgress) => void,
): Promise<EmotionTraceResult> {
	const history = await loadPromptHistory(
		sources,
		loadEntries,
		settings,
		onProgress,
	);
	const plan = buildClassificationPlan(history.prompts, classifierSkill);
	const points = await classifyPromptHistory(plan, callClassifier, onProgress);
	onProgress?.({ phase: "visualization", completed: 0, total: 1 });
	return {
		generatedAt: new Date().toISOString(),
		historyWindow: settings.historyWindow,
		model: modelLabel,
		coverage: {
			sessionsDiscovered: history.sessionsDiscovered,
			sessionsRead: history.sessionsRead,
			promptsFound: history.promptsFound,
			promptsAnalyzed: points.length,
			charactersSubmitted: plan.promptCharacters,
			truncated: history.truncated || plan.truncated,
		},
		points,
	};
}
