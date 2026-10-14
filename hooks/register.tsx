import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ReplyDurations, ReplyInfo, TaskRecord, ToolTime } from '../types'

const durations = { plugin: 'turn-timer', key: 'durations' } as const
const durationsStoreKey = 'durations'
const tasksStoreKey = 'tasks'
const maxRemembered = 1000
const maxTasks = 2000
const stallCheckIntervalMs = 15000
const toolStallMs = 3 * 60 * 1000
const unityCheckAfterMs = 30 * 1000
const unityStallMs = 90 * 1000
const windowsChime = 'C:/Windows/Media/Windows Exclamation.wav'
const macChime = '/System/Library/Sounds/Glass.aiff'
const unityLogActivity = /package manager|resolving packages|resolve packages|importing|asset ?database|refresh|compil|domain reload|reloading assemblies|script ?compilation|shader|lighting|bak(e|ing)|build/i

type InFlightTool = { label: string; startedAt: number; hasAlerted: boolean }

type StallTracker = { inFlight: Map<string, InFlightTool>; isChecking: boolean; isUnityUnavailable: boolean; unityBusySince: number | undefined; hasAlertedUnity: boolean }

export function formatDuration(ms: number): string
{
	const totalSeconds = Math.round(ms / 1000)
	if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)}s`
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`
}

export function formatElapsed(ms: number): string
{
	const totalSeconds = Math.floor(ms / 1000)
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
	return hours > 0 ? `${hours}:${mmss}` : mmss
}

export function replyKey(text: string): string
{
	const normalized = text.trim()
	let hash = 5381
	for (let i = 0; i < normalized.length; i++) hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0
	return `${normalized.length}:${(hash >>> 0).toString(36)}`
}

export function remember(map: ReplyDurations, key: string, info: ReplyInfo): ReplyDurations
{
	const next = { ...map }
	delete next[key]
	next[key] = info
	const keys = Object.keys(next)
	for (const oldKey of keys.slice(0, Math.max(0, keys.length - maxRemembered))) delete next[oldKey]
	return next
}

export function toolLabel(tool: string, input: unknown): string
{
	if (tool.startsWith('mcp__')) return tool.split('__').pop() ?? tool
	if (tool !== 'Bash' && tool !== 'PowerShell') return tool
	const command = typeof input === 'object' && input !== null && 'command' in input ? String((input as { command: unknown }).command) : ''
	const words: string[] = []
	for (const word of command.trim().split(/\s+/))
	{
		if (word === '' || /^[-"'$|&;<>(]/.test(word) || word.includes('/') || word.includes('\\') || word.includes('=')) break
		words.push(word)
		if (words.length === 3) break
	}
	return words.length > 0 ? `${tool} ${words.join(' ')}` : tool
}

export function topTools(totals: Map<string, number>, count: number): ToolTime[]
{
	return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, count)
}

export function describeTools(tools: ToolTime[]): string
{
	return tools.map(([label, ms]) => `${label} ${formatDuration(ms)}`).join(' · ')
}

export function startOfLocalDay(now: number): number
{
	const day = new Date(now)
	day.setHours(0, 0, 0, 0)
	return day.getTime()
}

export function formatTimings(tasks: TaskRecord[], now: number, args: string): string
{
	const scope = args.trim().toLowerCase()
	const count = Number.parseInt(scope, 10)
	const selected = scope === 'all'
		? tasks
		: Number.isFinite(count) && count > 0
			? tasks.slice(-count)
			: tasks.filter(task => task.at >= startOfLocalDay(now))
	const title = scope === 'all' ? 'All recorded tasks' : Number.isFinite(count) && count > 0 ? `Last ${selected.length} tasks` : 'Today'
	if (selected.length === 0) return `${title}: no tasks recorded.`

	const total = selected.reduce((sum, task) => sum + task.durationMs, 0)
	const toolTotals = new Map<string, number>()
	for (const task of selected)
		for (const [label, ms] of task.tools) toolTotals.set(label, (toolTotals.get(label) ?? 0) + ms)

	const lines = selected.map(task => {
		const time = new Date(task.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
		const prompt = task.prompt === '' ? '(continuation)' : task.prompt
		const tools = task.tools.length > 0 ? `  [${describeTools(task.tools)}]` : ''
		return `${time}  ${formatDuration(task.durationMs).padStart(9)}  ${prompt}${tools}`
	})
	const slowest = describeTools(topTools(toolTotals, 5))
	return [
		`${title}: ${selected.length} tasks, ${formatDuration(total)} total`,
		...lines,
		slowest === '' ? '' : `Most time in tools (summed, parallel calls overlap): ${slowest}`,
	].filter(line => line !== '').join('\n')
}

async function playChime($: EngineInterface): Promise<void>
{
	try
	{
		if (await $.fs.exists(windowsChime))
		{
			await $.process.run(['powershell', '-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${windowsChime}').PlaySync()`], { timeoutMs: 10000 })
		}
		else if (await $.fs.exists(macChime))
		{
			await $.process.run(['afplay', macChime], { timeoutMs: 10000 })
		}
	}
	catch
	{
	}
}

async function alertStall($: EngineInterface, text: string): Promise<void>
{
	$.ui.toast(text, { timeoutMs: 20000 })
	await playChime($)
}

async function unityEditorStates($: EngineInterface): Promise<{ project: string; state: string }[] | 'unavailable' | 'not-responding'>
{
	try
	{
		const ran = await $.process.run(['unity', 'status', '--json', '--no-banner', '--non-interactive'], { timeoutMs: 15000 })
		if (ran.exitCode !== 0) return 'unavailable'
		const parsed = JSON.parse(ran.stdout) as { data?: { instances?: { project?: string; state?: string }[] } }
		return (parsed.data?.instances ?? []).map(instance => ({ project: instance.project ?? '', state: instance.state ?? 'unknown' }))
	}
	catch (error)
	{
		return String(error).toLowerCase().includes('timed out') || String(error).toLowerCase().includes('still running') ? 'not-responding' : 'unavailable'
	}
}

async function lastUnityLogActivity($: EngineInterface): Promise<string | undefined>
{
	try
	{
		const isWindows = await $.fs.exists(windowsChime)
		const ran = isWindows
			? await $.process.run(['powershell', '-NoProfile', '-Command', 'Get-Content -Tail 80 "$env:LOCALAPPDATA\\Unity\\Editor\\Editor.log"'], { timeoutMs: 10000 })
			: await $.process.run(['sh', '-c', 'tail -n 80 ~/Library/Logs/Unity/Editor.log'], { timeoutMs: 10000 })
		const lines = ran.stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
		const match = [...lines].reverse().find(line => unityLogActivity.test(line))
		return (match ?? lines[lines.length - 1])?.slice(0, 120)
	}
	catch
	{
		return undefined
	}
}

async function checkStalls($: EngineInterface, stall: StallTracker): Promise<void>
{
	if (stall.isChecking || stall.inFlight.size === 0) return
	stall.isChecking = true
	try
	{
		const now = await $.clock.now()
		let oldestStartedAt = now
		for (const call of stall.inFlight.values())
		{
			oldestStartedAt = Math.min(oldestStartedAt, call.startedAt)
			if (call.hasAlerted || now - call.startedAt < toolStallMs) continue
			call.hasAlerted = true
			await alertStall($, `⚠ ${call.label} has been running for ${formatDuration(now - call.startedAt)}`)
		}

		if (stall.isUnityUnavailable || now - oldestStartedAt < unityCheckAfterMs) return
		const editors = await unityEditorStates($)
		if (editors === 'unavailable')
		{
			stall.isUnityUnavailable = true
			return
		}
		const busy = editors === 'not-responding'
			? { project: '', state: 'not responding' }
			: editors.find(editor => editor.state !== 'ready')
		if (busy === undefined)
		{
			stall.unityBusySince = undefined
			stall.hasAlertedUnity = false
			return
		}
		stall.unityBusySince ??= now
		if (stall.hasAlertedUnity || now - stall.unityBusySince < unityStallMs) return
		stall.hasAlertedUnity = true
		const project = busy.project.split(/[\\/]/).pop() ?? ''
		const activity = await lastUnityLogActivity($)
		await alertStall($, `⚠ Unity editor${project ? ` (${project})` : ''} ${busy.state} for ${formatDuration(now - stall.unityBusySince)}${activity ? ` — last log: ${activity}` : ''}`)
	}
	finally
	{
		stall.isChecking = false
	}
}

export const register: Register = on => {
	let ticker: Timer | undefined
	let stallChecker: Timer | undefined
	let lastTask = ''
	let turnPrompt = ''
	const stall: StallTracker = { inFlight: new Map(), isChecking: false, isUnityUnavailable: false, unityBusySince: undefined, hasAlertedUnity: false }
	const inFlight = stall.inFlight
	const turnToolTotals = new Map<string, number>()

	const statusLine = (elapsed: string) => `⏱ working ${elapsed}${lastTask ? ` · last task: ${lastTask}` : ''}`

	on('session.start', async ($, e, next) => {
		const stored = (await $.store.get(durationsStoreKey)) as ReplyDurations | undefined
		if (stored)
		{
			const { value: current = {} } = await $.state.get(durations)
			await $.state.set(durations, { ...stored, ...current })
		}
		await $.command.register({ name: 'timings', description: 'Task durations: today (default), "all", or the last N', argumentHint: '[all|N]' })
		return next(e)
	})

	on('command.run', { command: 'timings' }, async ($, e) => {
		const tasks = ((await $.store.get(tasksStoreKey)) as TaskRecord[] | undefined) ?? []
		return { text: formatTimings(tasks, await $.clock.now(), e.args) }
	})

	on('turn.start', async ($, e, next) => {
		ticker?.cancel()
		stallChecker?.cancel()
		turnToolTotals.clear()
		inFlight.clear()
		stall.unityBusySince = undefined
		stall.hasAlertedUnity = false
		turnPrompt = e.text.replace(/\s+/g, ' ').trim().slice(0, 80)
		const startedAt = await $.clock.now()
		$.ui.status(statusLine(formatElapsed(0)))
		ticker = $.clock.every(1000, async () => {
			$.ui.status(statusLine(formatElapsed((await $.clock.now()) - startedAt)))
		})
		stallChecker = $.clock.every(stallCheckIntervalMs, () => checkStalls($, stall))
		return next(e)
	})

	on('tool.call', async ($, e, next) => {
		const label = toolLabel(e.tool, e)
		const startedAt = await $.clock.now()
		inFlight.set(e.tool_use_id, { label, startedAt, hasAlerted: false })
		try
		{
			return await next(e)
		}
		finally
		{
			inFlight.delete(e.tool_use_id)
			const elapsed = (await $.clock.now()) - startedAt
			turnToolTotals.set(label, (turnToolTotals.get(label) ?? 0) + elapsed)
		}
	})

	on('turn.complete', async ($, e, next) => {
		const result = await next(e)
		if (e.agentId !== undefined) return result

		ticker?.cancel()
		ticker = undefined
		stallChecker?.cancel()
		stallChecker = undefined
		inFlight.clear()
		lastTask = formatDuration(e.durationMs)
		const tools = topTools(turnToolTotals, 3)
		const verb = e.isAborted ? 'Interrupted after' : e.reason === 'error' ? 'Failed after' : 'Done in'
		$.ui.toast(`${verb} ${lastTask}`, { timeoutMs: 8000 })
		$.ui.status(`⏱ last task: ${lastTask}`)

		const now = await $.clock.now()
		const tasks = ((await $.store.get(tasksStoreKey)) as TaskRecord[] | undefined) ?? []
		await $.store.set(tasksStoreKey, [...tasks, { at: now, durationMs: e.durationMs, prompt: turnPrompt, tools }].slice(-maxTasks))

		if (e.answer.trim() !== '')
		{
			const { value: current = {} } = await $.state.get(durations)
			const saved = remember(current, replyKey(e.answer), { durationMs: e.durationMs, tools })
			await $.state.set(durations, saved)
			await $.store.set(durationsStoreKey, saved)
		}
		return result
	})

	on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
		const { value: map = {} } = await $.state.get(durations)
		const entry = map[replyKey(e.props.text)]
		const drawn = await next(e)
		if (entry === undefined) return drawn

		const info: ReplyInfo = typeof entry === 'number' ? { durationMs: entry, tools: [] } : entry
		const tools = describeTools(info.tools)
		const { Box, Text } = $.ui.resolve(e)
		return (
			<Box flexDirection="column">
				{drawn}
				<Text dimColor>⏱ {formatDuration(info.durationMs)}{tools ? ` · ${tools}` : ''}</Text>
			</Box>
		)
	})
}
