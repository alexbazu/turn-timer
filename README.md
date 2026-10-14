# turn-timer

Claude Code mod that shows how long each task took when Claude finishes it.

## Preview

While Claude is working, the status line counts up:

```
⏱ working 01:23 · last task: 42.0s
```

When the task ends, a toast pops up and every reply gets its duration plus the slowest tools underneath:

```
Done in 1m 23s
```

```
● Fixed the null check in GarageMenu and recompiled — no errors.
  ⏱ 1m 23s · Bash unity command 48.2s · Read 3.1s · Edit 0.4s
```

`/timings` lists today's tasks (`/timings all` or `/timings 20` for more):

```
Today: 3 tasks, 4m 12s total
Oct 14, 10:02 AM      42.0s  fix the null ref in GarageMenu  [Read 3.1s · Edit 0.4s]
Oct 14, 10:15 AM     1m 23s  recompile and check the console  [Bash unity command 48.2s · Read 3.1s]
Oct 14, 11:40 AM      2m 7s  write tests for formatDuration  [Bash npm test 1m 2s · Write 0.6s]
Most time in tools (summed, parallel calls overlap): Bash npm test 1m 2s · Bash unity command 48.2s · Read 6.2s
```

If a tool runs for over 3 minutes, or a Unity editor stays busy for over 90 seconds, you get a toast and a chime:

```
⚠ Bash npm test has been running for 3m 0s
⚠ Unity editor (MyGame) compiling for 1m 30s — last log: Reloading assemblies after finishing script compilation.
```

## Install

```
claude plugin marketplace add alexbazu/turn-timer
claude plugin install turn-timer@alexb-mods
```

Restart Claude Code afterwards.
