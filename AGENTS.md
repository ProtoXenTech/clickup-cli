# Agent Guidelines for clickup-cli

This repository defines the shared ClickUp workflow used across projects.

## Workflow intent

- Keep ClickUp usage simple and consistent
- Store auth, workspace, space, assignee, and workflow defaults globally
- Keep `listId` project-specific
- Use one ClickUp list per project
- Use top-level tasks as milestones
- Allow unlimited nested subtasks for implementation work
- Keep descriptions short, practical, and low-overhead

## Preferred commands

- `clickup-cli plan --file roadmap.json`
- `clickup-cli start --task <taskId>`
- `clickup-cli update --task <taskId> --summary "..." --commit "abc1234"`
- `clickup-cli review --task <taskId> --tests "npm test"`
- `clickup-cli done --task <taskId> --summary "..."`

## Comment style

- Save only key information worth finding later
- Keep notes short
- Include relevant commit hashes when they help trace the work
- Avoid noisy comment spam for every small action

## For downstream project AGENTS.md files

Projects can copy this short note:

```md
## ClickUp workflow

Use the globally installed `clickup-cli`.

- One ClickUp list per repo
- Milestones are top-level tasks
- Work items can be nested as deeply as needed
- Use `clickup-cli plan --file roadmap.json` for new project roadmaps
- Use `clickup-cli start`, `clickup-cli update`, `clickup-cli review`, and `clickup-cli done` for daily work
- Keep comments short and only store key progress, blockers, PR links, and relevant commit hashes
```
