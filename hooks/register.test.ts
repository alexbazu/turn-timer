import { test, expect } from 'claude-code/testing'
import { describeTools, formatDuration, formatElapsed, formatTimings, remember, replyKey, toolLabel, topTools } from './register'

const info = (durationMs: number) => ({ durationMs, tools: [] })

test('formats durations', () => {
	expect(formatDuration(4200)).toBe('4.2s')
	expect(formatDuration(125000)).toBe('2m 5s')
	expect(formatDuration(3725000)).toBe('1h 2m 5s')
})

test('toasts the duration when a main-loop turn completes', async ($, on) => {
	const toasts: string[] = []
	on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
	on('ui.status', () => ({ value: undefined }))
	on('turn.complete', () => ({ text: 'ok' }))

	await $.turn.complete({ answer: 'ok', durationMs: 125000, isAborted: false, turnId: 't1', reason: 'answer' })
	expect(toasts).toEqual(['Done in 2m 5s'])
})

test('ignores subagent turns', async ($, on) => {
	const toasts: string[] = []
	on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
	on('turn.complete', () => ({ text: 'ok' }))

	await $.turn.complete({ answer: 'ok', durationMs: 5000, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1' })
	expect(toasts).toEqual([])
})

test('formats elapsed time as a clock', () => {
	expect(formatElapsed(0)).toBe('00:00')
	expect(formatElapsed(65400)).toBe('01:05')
	expect(formatElapsed(3725000)).toBe('1:02:05')
})

test('reply keys ignore surrounding whitespace', () => {
	expect(replyKey('  hello\n')).toBe(replyKey('hello'))
	expect(replyKey('hello')).not.toBe(replyKey('hellp'))
})

test('remember keeps the newest entry last', () => {
	const map = remember(remember({}, 'a', info(1)), 'b', info(2))
	expect(Object.keys(remember(map, 'a', info(3)))).toEqual(['b', 'a'])
})

test('labels shell commands by their leading words', () => {
	expect(toolLabel('Bash', { command: 'unity command recompile_status --json' })).toBe('Bash unity command recompile_status')
	expect(toolLabel('Bash', { command: 'git -C foo status' })).toBe('Bash git')
	expect(toolLabel('mcp__codegraph__codegraph_explore', {})).toBe('codegraph_explore')
	expect(toolLabel('Read', { file_path: 'x' })).toBe('Read')
})

test('ranks and describes tool totals', () => {
	const tools = topTools(new Map([['Read', 5000], ['Bash unity', 100000], ['Grep', 1000]]), 2)
	expect(describeTools(tools)).toBe('Bash unity 1m 40s · Read 5.0s')
})

test('timings lists only today by default', () => {
	const now = new Date(2026, 9, 8, 15, 0).getTime()
	const yesterday = new Date(2026, 9, 7, 15, 0).getTime()
	const tasks = [
		{ at: yesterday, durationMs: 1000, prompt: 'old', tools: [] },
		{ at: now, durationMs: 65000, prompt: 'fix crash', tools: [['Bash unity', 60000]] as [string, number][] },
	]
	const text = formatTimings(tasks, now, '')
	expect(text).toContain('Today: 1 tasks, 1m 5s total')
	expect(text).not.toContain('old')
	expect(formatTimings(tasks, now, 'all')).toContain('2 tasks')
})
