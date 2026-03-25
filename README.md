# clickup-cli

`clickup-cli` is a reusable local developer CLI for ClickUp.

It is designed for everyday project work across any repo:

- store ClickUp credentials once at user level
- map each repo to its own default workspace, space, list, and assignee
- start a task, post progress, and mark it done from terminal
- generate branch names from ClickUp tasks
- create task plans and sync descriptions, dates, and notes in bulk
- keep a small local state file so repeated commands stay fast

The CLI currently exposes two command names after linking:

- `clickup-cli` - primary command
- `clickup-dev` - compatibility alias

## Requirements

- Node.js 18+
- a ClickUp personal API token
- GitHub is not required for the CLI itself

## Install globally from source

```bash
cd tools/clickup-dev-cli
npm link
```

Then verify:

```bash
clickup-cli help
```

## Global setup

Run this once on your machine:

```bash
clickup-cli setup \
  --token "YOUR_CLICKUP_TOKEN" \
  --team "90181927086" \
  --space "90187599281" \
  --list "901816917111" \
  --assignee "2140582"
```

This writes global defaults to:

```bash
~/.config/clickup-cli/config.json
```

You can also supply any of these through environment variables:

- `CLICKUP_API_TOKEN`
- `CLICKUP_TEAM_ID`
- `CLICKUP_SPACE_ID`
- `CLICKUP_FOLDER_ID`
- `CLICKUP_LIST_ID`
- `CLICKUP_ASSIGNEE_ID`

## Per-project setup

Inside any repository:

```bash
clickup-cli init --name "My Project"
```

This creates:

- `.clickup-cli.json` - project defaults
- `.clickup-cli/state.json` - local workflow state such as active task

Use `.clickup-cli.example.json` as a starting point if you want to create the file manually.

## Typical workflow

```bash
clickup-cli start --task 86abc123
clickup-cli branch-name --task 86abc123
clickup-cli sync --task 86abc123
clickup-cli done --task 86abc123 --comment "Finished first implementation pass and verified typecheck."
```

What these do:

- `start` moves the task to your configured start status, optionally assigns you, stores the active task locally, and suggests a branch name
- `branch-name` generates a branch using your configured format
- `sync` posts a compact git-based progress note back to ClickUp
- `done` moves the task to your done status and clears local active-task state

## Planning workflow

Create a parent task and subtasks from a plan file:

```bash
clickup-cli create-plan --file plan.json
```

Sync descriptions, dates, and notes onto existing tasks:

```bash
clickup-cli sync-metadata --file metadata.json
```

## Discovery commands

```bash
clickup-cli me
clickup-cli teams
clickup-cli spaces --team 123
clickup-cli folders --space 456
clickup-cli space-lists --space 456
clickup-cli lists --folder 789
clickup-cli tasks
clickup-cli task --task 86abc123
```

## Task commands

```bash
clickup-cli create-task --name "Task title"
clickup-cli update-task --task 86abc123 --status "in progress"
clickup-cli comment --task 86abc123 --comment "Working on this now"
```

## Example project config

```json
{
  "provider": "clickup",
  "projectName": "My Project",
  "teamId": "90181927086",
  "spaceId": "90187599281",
  "listId": "901816917111",
  "assigneeId": "2140582",
  "defaults": {
    "startStatus": "in progress",
    "doneStatus": "complete",
    "branchFormat": "cu-{taskId}-{slug}"
  }
}
```

## Notes

- The CLI reads `.env.local` and `.env` from the current repo before falling back to shell env.
- `start` stores the active task locally, so later commands such as `task`, `comment`, `sync`, and `done` can run without repeating `--task`.
- `sync` is intentionally simple right now: it posts branch, last commit, and working-tree summary back to ClickUp.
- The package is structured to be moved into its own repository cleanly.
