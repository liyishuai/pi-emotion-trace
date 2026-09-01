// SPDX-License-Identifier: MPL-2.0

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	getSettingsListTheme,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	SelectList,
	SettingsList,
	Spacer,
	Text,
	type SelectItem,
	type SettingItem,
} from "@earendil-works/pi-tui";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { analyzeEmotionHistory } from "../src/analyze.ts";
import { readSessionEntriesReadOnly } from "../src/history.ts";
import { renderEmotionTraceHtml } from "../src/report.ts";
import {
	DEFAULT_CLASSIFIER_MODEL,
	EMOTION_TRACE_DIRECTORY,
	EMOTION_TRACE_REPORT_PATH,
	loadEmotionTraceSettings,
	saveEmotionTraceSettings,
} from "../src/settings.ts";
import {
	HISTORY_WINDOWS,
	MODEL_CATALOGS,
	PROMPT_LIMITS,
	type AnalysisProgress,
	type EmotionTraceSettings,
	type ModelCatalog,
} from "../src/types.ts";

const CLASSIFIER_SKILL_URL = new URL(
	"../skills/emotion-trace-classifier/SKILL.md",
	import.meta.url,
);

type ClassifierModel = ReturnType<
	ExtensionCommandContext["modelRegistry"]["getAvailable"]
>[number];

function modelLabel(model: ClassifierModel): string {
	return `${model.provider}/${model.id}`;
}

function availableModels(
	ctx: ExtensionCommandContext,
	catalog: ModelCatalog,
): ClassifierModel[] {
	const available = [...ctx.modelRegistry.getAvailable()];
	const scoped = new Set(ctx.scopedModels.map(({ model }) => modelLabel(model)));
	const scopedAvailable = available.filter((model) => scoped.has(modelLabel(model)));
	const selected =
		catalog === "scoped" && scopedAvailable.length > 0
			? scopedAvailable
			: available;
	return selected.sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)));
}

function defaultModel(
	ctx: ExtensionCommandContext,
	catalog: ModelCatalog,
): ClassifierModel {
	const available = availableModels(ctx, catalog);
	const preferred = available.find(
		(model) => modelLabel(model) === DEFAULT_CLASSIFIER_MODEL,
	);
	if (preferred) return preferred;
	if (ctx.model) {
		const active = available.find(
			(model) => modelLabel(model) === modelLabel(ctx.model!),
		);
		if (active) return active;
	}
	const fallback = available[0];
	if (!fallback) throw new Error("No authenticated model is available");
	return fallback;
}

function resolveModel(
	ctx: ExtensionCommandContext,
	settings: EmotionTraceSettings,
): ClassifierModel {
	return (
		availableModels(ctx, settings.modelCatalog).find(
			(model) => modelLabel(model) === settings.classifierModel,
		) ?? defaultModel(ctx, settings.modelCatalog)
	);
}

function persistSettings(
	ctx: ExtensionCommandContext,
	settings: EmotionTraceSettings,
): void {
	if (!saveEmotionTraceSettings(settings)) {
		ctx.ui.notify("Emotion Trace settings could not be saved", "warning");
	}
}

async function showConfigurationPanel(
	ctx: ExtensionCommandContext,
	initial: EmotionTraceSettings,
): Promise<void> {
	const settings = { ...initial };
	await ctx.ui.custom<undefined>((tui, theme, _keybindings, done) => {
		const modelSubmenu = (
			currentValue: string,
			close: (selectedValue?: string) => void,
		) => {
			const items: SelectItem[] = availableModels(ctx, settings.modelCatalog).map(
				(model) => ({
					value: modelLabel(model),
					label: model.id,
					description: model.provider,
				}),
			);
			const list = new SelectList(items, Math.min(items.length, 12), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});
			list.onSelect = (item) => close(item.value);
			list.onCancel = () => close();
			const index = items.findIndex((item) => item.value === currentValue);
			if (index >= 0) list.setSelectedIndex(index);
			return list;
		};
		const items: SettingItem[] = [
			{
				id: "historyWindow",
				label: "History window",
				description: "Chronological human prompts included in the trace",
				currentValue: settings.historyWindow,
				values: [...HISTORY_WINDOWS],
			},
			{
				id: "maxPrompts",
				label: "Prompt limit",
				description: "Maximum recent prompts submitted for classification",
				currentValue: String(settings.maxPrompts),
				values: PROMPT_LIMITS.map(String),
			},
			{
				id: "modelCatalog",
				label: "Model catalog",
				description: "Scoped models or every authenticated model",
				currentValue: settings.modelCatalog,
				values: [...MODEL_CATALOGS],
			},
			{
				id: "classifierModel",
				label: "Classifier model",
				description: "Scores emotion and interaction signals for each prompt",
				currentValue: settings.classifierModel,
				submenu: modelSubmenu,
			},
		];
		let list: SettingsList;
		list = new SettingsList(
			items,
			items.length + 2,
			getSettingsListTheme(),
			(id, value) => {
				if (id === "historyWindow") {
					settings.historyWindow = value as EmotionTraceSettings["historyWindow"];
				} else if (id === "maxPrompts") {
					settings.maxPrompts = Number(value);
				} else if (id === "modelCatalog") {
					settings.modelCatalog = value as ModelCatalog;
					settings.classifierModel = modelLabel(resolveModel(ctx, settings));
					list.updateValue("classifierModel", settings.classifierModel);
				} else if (id === "classifierModel") {
					settings.classifierModel = value;
				}
				persistSettings(ctx, settings);
			},
			() => done(undefined),
		);
		const container = new Container();
		container.addChild(
			new Text(theme.fg("accent", theme.bold("Emotion Trace Settings")), 1, 0),
		);
		container.addChild(
			new Text(
				theme.fg("muted", "Changes save immediately · Esc closes"),
				1,
				0,
			),
		);
		container.addChild(new Spacer(1));
		container.addChild(list);
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

function progressLines(progress: AnalysisProgress): string[] {
	const label =
		progress.phase === "sessions"
			? "Reading human prompts"
			: progress.phase === "classification"
				? "Classifying emotion and interaction signals"
				: "Building the visualization";
	return [
		"",
		"  Pi Emotion Trace",
		"  ─────────────────────────",
		`  ${label}: ${progress.completed}/${progress.total}`,
	];
}

async function callModel(
	ctx: ExtensionCommandContext,
	model: ClassifierModel,
	prompt: string,
): Promise<string> {
	const response = await ctx.modelRegistry.complete(model, {
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: prompt }],
				timestamp: Date.now(),
			},
		],
	});
	return response.content
		.flatMap((content) => (content.type === "text" ? [content.text] : []))
		.join("");
}

async function writeReport(html: string): Promise<void> {
	await mkdir(EMOTION_TRACE_DIRECTORY, { recursive: true, mode: 0o700 });
	const temporaryPath = `${EMOTION_TRACE_REPORT_PATH}.tmp`;
	await writeFile(temporaryPath, html, { encoding: "utf8", mode: 0o600 });
	await rename(temporaryPath, EMOTION_TRACE_REPORT_PATH);
}

async function openReport(pi: ExtensionAPI): Promise<boolean> {
	const command =
		process.platform === "darwin"
			? { executable: "open", args: [EMOTION_TRACE_REPORT_PATH] }
			: process.platform === "win32"
				? { executable: "cmd", args: ["/c", "start", "", EMOTION_TRACE_REPORT_PATH] }
				: { executable: "xdg-open", args: [EMOTION_TRACE_REPORT_PATH] };
	try {
		const result = await pi.exec(command.executable, command.args, { timeout: 10_000 });
		return result.code === 0;
	} catch {
		return false;
	}
}

export default function emotionTraceExtension(pi: ExtensionAPI): void {
	pi.registerCommand("emotion-trace-config", {
		description: "Configure prompt history scope and emotion classifier model",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/emotion-trace-config requires TUI mode", "warning");
				return;
			}
			try {
				const settings = loadEmotionTraceSettings();
				const resolved = resolveModel(ctx, settings);
				settings.classifierModel = modelLabel(resolved);
				persistSettings(ctx, settings);
				await showConfigurationPanel(ctx, settings);
			} catch (error) {
				ctx.ui.notify(
					`Emotion Trace configuration failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("emotion-trace", {
		description: "Visualize emotion and interaction signals across prompt history",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/emotion-trace requires TUI mode", "warning");
				return;
			}
			try {
				const settings = loadEmotionTraceSettings();
				const model = resolveModel(ctx, settings);
				if (settings.classifierModel !== modelLabel(model)) {
					settings.classifierModel = modelLabel(model);
					persistSettings(ctx, settings);
				}
				ctx.ui.setStatus("emotion-trace", "Analyzing prompt history…");
				ctx.ui.setWidget(
					"emotion-trace",
					progressLines({ phase: "sessions", completed: 0, total: 1 }),
				);
				const classifierSkill = await readFile(CLASSIFIER_SKILL_URL, "utf8");
				const sessionInfos = await SessionManager.listAll((completed, total) => {
					ctx.ui.setWidget(
						"emotion-trace",
						progressLines({ phase: "sessions", completed, total }),
					);
				});
				const sources = sessionInfos.map((info) => ({
					id: info.id,
					path: info.path,
					created: info.created,
					modified: info.modified,
				}));
				const result = await analyzeEmotionHistory(
					sources,
					readSessionEntriesReadOnly,
					async (prompt) => callModel(ctx, model, prompt),
					classifierSkill,
					settings,
					modelLabel(model),
					(progress) => {
						ctx.ui.setWidget("emotion-trace", progressLines(progress));
					},
				);
				if (result.points.length === 0) {
					ctx.ui.notify(
						"No user prompts were found in the selected history window.",
						"warning",
					);
					return;
				}
				await writeReport(renderEmotionTraceHtml(result));
				ctx.ui.setWidget(
					"emotion-trace",
					progressLines({ phase: "visualization", completed: 1, total: 1 }),
				);
				const opened = await openReport(pi);
				ctx.ui.notify(
					`${result.points.length} prompts visualized.\n${EMOTION_TRACE_REPORT_PATH}${opened ? "\n\nOpened in your browser." : ""}`,
					"info",
				);
			} catch (error) {
				ctx.ui.notify(
					`Emotion Trace failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			} finally {
				ctx.ui.setStatus("emotion-trace", undefined);
				ctx.ui.setWidget("emotion-trace", undefined);
			}
		},
	});
}
