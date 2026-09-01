// SPDX-License-Identifier: MPL-2.0

export const HISTORY_WINDOWS = ["7d", "30d", "90d", "180d", "365d", "all"] as const;
export const PROMPT_LIMITS = [100, 250, 500, 1_000] as const;
export const MODEL_CATALOGS = ["scoped", "all"] as const;

export type HistoryWindow = (typeof HISTORY_WINDOWS)[number];
export type ModelCatalog = (typeof MODEL_CATALOGS)[number];

export type EmotionTraceSettings = {
	historyWindow: HistoryWindow;
	maxPrompts: number;
	modelCatalog: ModelCatalog;
	classifierModel: string;
};

export type SessionSource = {
	id: string;
	path: string;
	created: Date;
	modified: Date;
};

export const VERIFIED_PROMPT_ENTRY_TYPE =
	"pi-emotion-trace:verified-human-prompt";

export type VerifiedPromptRecord = {
	version: 1;
	source: "interactive";
	text: string;
};

export type HistoricalPrompt = {
	id: string;
	sessionId: string;
	timestamp: string;
	text: string;
};

export const EMOTION_LABELS = [
	"joyful",
	"satisfied",
	"hopeful",
	"calm",
	"neutral",
	"uncertain",
	"concerned",
	"frustrated",
	"angry",
	"sad",
	"overwhelmed",
] as const;

export type EmotionLabel = (typeof EMOTION_LABELS)[number];
export type Confidence = "high" | "medium" | "low";

export const INTERACTION_KINDS = ["request", "steering", "response", "other"] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const SIGNAL_TAGS = [
	"steering",
	"rejection",
	"doubt",
	"correction",
	"scope_reassertion",
	"approval",
	"evidence_challenge",
	"stop_request",
	"replacement_request",
] as const;

export type SignalTag = (typeof SIGNAL_TAGS)[number];

export type PromptTracePoint = {
	id: string;
	timestamp: string;
	valence: number;
	emotion: EmotionLabel;
	confidence: Confidence;
	emotionKeywords: string[];
	excerpt: string;
	interactionKind: InteractionKind;
	signals: SignalTag[];
	signalKeywords: string[];
};

export type TraceCoverage = {
	sessionsDiscovered: number;
	sessionsRead: number;
	promptsFound: number;
	promptsAnalyzed: number;
	charactersSubmitted: number;
	truncated: boolean;
};

export type EmotionTraceResult = {
	generatedAt: string;
	historyWindow: HistoryWindow;
	model: string;
	coverage: TraceCoverage;
	points: PromptTracePoint[];
};

export type AnalysisPhase = "sessions" | "classification" | "visualization";

export type AnalysisProgress = {
	phase: AnalysisPhase;
	completed: number;
	total: number;
};
