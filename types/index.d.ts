export type ToolTime = [label: string, durationMs: number]

export type ReplyInfo = { durationMs: number; tools: ToolTime[] }

export type ReplyDurations = Record<string, ReplyInfo | number>

export type TaskRecord = { at: number; durationMs: number; prompt: string; tools: ToolTime[] }

declare module 'claude-code' {
	interface PluginState {
		'turn-timer': { durations: ReplyDurations }
	}
}
