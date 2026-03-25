const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")
const {
  resolveConfig,
  saveGlobalConfig,
  saveProjectConfig,
  saveProjectState,
  redactConfig,
} = require("./config")
const {
  assertRequired,
  clickupRequest,
  mapTask,
  normalizePriority,
  parseDateValue,
  parseDurationValue,
  parseList,
} = require("./clickup")

async function run(argv) {
  const [command, ...restArgs] = argv
  const args = parseArgs(restArgs)
  const configContext = resolveConfig()
  const config = configContext.resolved
  const token = config.token

  switch (command) {
    case undefined:
    case "help":
      printHelp()
      return

    case "setup": {
      const nextConfig = {
        ...configContext.globalConfig,
        token: args.token || configContext.globalConfig.token,
        teamId: args.team || configContext.globalConfig.teamId,
        spaceId: args.space || configContext.globalConfig.spaceId,
        folderId: args.folder || configContext.globalConfig.folderId,
        listId: args.list || configContext.globalConfig.listId,
        assigneeId: args.assignee || configContext.globalConfig.assigneeId,
        defaults: {
          ...(configContext.globalConfig.defaults || {}),
          startStatus: args["start-status"] || configContext.globalConfig.defaults?.startStatus || "in progress",
          doneStatus: args["done-status"] || configContext.globalConfig.defaults?.doneStatus || "complete",
          branchFormat: args["branch-format"] || configContext.globalConfig.defaults?.branchFormat || "cu-{taskId}-{slug}",
        },
      }

      saveGlobalConfig(nextConfig)
      printJson({ saved: configContext.paths.globalConfig, config: redactConfig(nextConfig) })
      return
    }

    case "init": {
      const nextProjectConfig = {
        provider: "clickup",
        projectName: args.name || path.basename(process.cwd()),
        teamId: args.team || config.teamId,
        spaceId: args.space || config.spaceId,
        folderId: args.folder || config.folderId,
        listId: args.list || config.listId,
        assigneeId: args.assignee || config.assigneeId,
        defaults: {
          startStatus: args["start-status"] || configContext.projectConfig.defaults?.startStatus || configContext.defaults.startStatus,
          doneStatus: args["done-status"] || configContext.projectConfig.defaults?.doneStatus || configContext.defaults.doneStatus,
          branchFormat: args["branch-format"] || configContext.projectConfig.defaults?.branchFormat || configContext.defaults.branchFormat,
        },
      }

      saveProjectConfig(nextProjectConfig)
      printJson({ saved: configContext.paths.projectConfig, config: nextProjectConfig })
      return
    }

    case "config": {
      printJson({
        globalConfigPath: configContext.paths.globalConfig,
        projectConfigPath: configContext.paths.projectConfig,
        projectStatePath: configContext.paths.projectState,
        config: redactConfig({ ...config, defaults: configContext.defaults }),
        state: configContext.state,
      })
      return
    }

    case "install-hooks": {
      const git = getGitContext()
      if (!git.insideWorkTree || !git.gitDir) {
        throw new Error("Run install-hooks inside a git repository")
      }

      const hookBin = resolveCommandPath(args.command || "clickup-cli")
      const hooks = [
        {
          name: "post-commit",
          event: "post-commit",
        },
        {
          name: "post-push",
          event: "post-push",
        },
      ]

      for (const hook of hooks) {
        const hookPath = path.join(git.gitDir, "hooks", hook.name)
        const script = [
          "#!/bin/sh",
          `\"${hookBin}\" hook-event --event ${hook.event} --silent || true`,
          "",
        ].join("\n")
        fs.writeFileSync(hookPath, script, "utf8")
        fs.chmodSync(hookPath, 0o755)
      }

      printJson({
        installed: hooks.map((hook) => hook.name),
        gitDir: git.gitDir,
        command: hookBin,
      })
      return
    }

    case "me": {
      const me = await clickupRequest(token, "/user")
      printJson({
        id: me.user.id,
        username: me.user.username,
        email: me.user.email,
        color: me.user.color,
      })
      return
    }

    case "teams": {
      const result = await clickupRequest(token, "/team")
      printCollection(result.teams, ["id", "name", "color"])
      return
    }

    case "spaces": {
      const teamId = args.team || config.teamId
      assertRequired(teamId, "Provide a team id with --team or config")
      const result = await clickupRequest(token, `/team/${teamId}/space`)
      printCollection(result.spaces, ["id", "name", "private"])
      return
    }

    case "folders": {
      const spaceId = args.space || config.spaceId
      assertRequired(spaceId, "Provide a space id with --space or config")
      const result = await clickupRequest(token, `/space/${spaceId}/folder`)
      printCollection(result.folders, ["id", "name", "task_count"])
      return
    }

    case "space-lists": {
      const spaceId = args.space || config.spaceId
      assertRequired(spaceId, "Provide a space id with --space or config")
      const result = await clickupRequest(token, `/space/${spaceId}/list`)
      printCollection(result.lists, ["id", "name", "task_count"])
      return
    }

    case "lists": {
      const folderId = args.folder || config.folderId
      assertRequired(folderId, "Provide a folder id with --folder or config")
      const result = await clickupRequest(token, `/folder/${folderId}/list`)
      printCollection(result.lists, ["id", "name", "task_count"])
      return
    }

    case "tasks": {
      const listId = args.list || config.listId
      assertRequired(listId, "Provide a list id with --list or config")
      const query = new URLSearchParams()
      if (args.archived === "true") {
        query.set("archived", "true")
      }
      const suffix = query.toString() ? `?${query.toString()}` : ""
      const result = await clickupRequest(token, `/list/${listId}/task${suffix}`)
      printJson(result.tasks.map(mapTask))
      return
    }

    case "task": {
      const taskId = resolveTaskId(args, configContext.state)
      const task = await clickupRequest(token, `/task/${taskId}`)
      printJson(mapTask(task))
      return
    }

    case "create-task": {
      const listId = args.list || config.listId
      assertRequired(listId, "Provide a list id with --list or config")
      assertRequired(args.name, "Pass --name for the task title")

      const payload = buildTaskPayload(args)
      payload.name = args.name
      payload.description = args.description || ""

      if (args.assignees || config.assigneeId) {
        payload.assignees = parseList(args.assignees || config.assigneeId).map(Number)
      }

      const task = await clickupRequest(token, `/list/${listId}/task`, { method: "POST", body: payload })
      printJson(mapTask(task))
      return
    }

    case "update-task": {
      const taskId = resolveTaskId(args, configContext.state)
      const payload = buildTaskPayload(args)
      applyAssigneeChanges(payload, args)

      if (Object.keys(payload).length === 0) {
        throw new Error("Pass update fields like --status, --description, --due-date, --add-assignees, or --clear-time-estimate")
      }

      const task = await clickupRequest(token, `/task/${taskId}`, { method: "PUT", body: payload })
      printJson(mapTask(task))
      return
    }

    case "comment": {
      const taskId = resolveTaskId(args, configContext.state)
      assertRequired(args.comment, "Pass --comment with the comment body")
      const result = await clickupRequest(token, `/task/${taskId}/comment`, {
        method: "POST",
        body: { comment_text: args.comment, notify_all: false },
      })
      printJson({ id: result.id, taskId, comment: args.comment })
      return
    }

    case "create-plan": {
      const listId = args.list || config.listId
      assertRequired(listId, "Provide a list id with --list or config")
      assertRequired(args.file, "Pass --file with a JSON plan file path")

      const plan = readJsonFile(args.file)
      validatePlan(plan)

      const parentTask = await clickupRequest(token, `/list/${listId}/task`, {
        method: "POST",
        body: {
          name: plan.name,
          description: plan.description || "",
          status: plan.status,
          priority: plan.priority ? normalizePriority(plan.priority) : undefined,
          start_date: plan.startDate ? parseDateValue(plan.startDate) : undefined,
          due_date: plan.dueDate ? parseDateValue(plan.dueDate, { endOfDay: true }) : undefined,
        },
      })

      const createdSubtasks = []
      for (const subtask of plan.subtasks || []) {
        const createdSubtask = await clickupRequest(token, `/list/${listId}/task`, {
          method: "POST",
          body: {
            name: subtask.name,
            description: subtask.description || "",
            status: subtask.status,
            priority: subtask.priority ? normalizePriority(subtask.priority) : undefined,
            start_date: subtask.startDate ? parseDateValue(subtask.startDate) : undefined,
            due_date: subtask.dueDate ? parseDateValue(subtask.dueDate, { endOfDay: true }) : undefined,
            parent: parentTask.id,
          },
        })
        createdSubtasks.push(mapTask(createdSubtask))
      }

      printJson({ task: mapTask(parentTask), subtaskCount: createdSubtasks.length, subtasks: createdSubtasks })
      return
    }

    case "sync-metadata": {
      assertRequired(args.file, "Pass --file with a metadata JSON file path")
      const metadata = readJsonFile(args.file)
      validateMetadata(metadata)
      const results = []

      for (const item of [metadata.parent, ...(metadata.subtasks || [])]) {
        const task = await clickupRequest(token, `/task/${item.taskId}`, {
          method: "PUT",
          body: {
            description: item.description,
            start_date: item.startDate ? parseDateValue(item.startDate) : undefined,
            due_date: item.dueDate ? parseDateValue(item.dueDate, { endOfDay: true }) : undefined,
            time_estimate: item.clearTimeEstimate ? null : item.timeEstimate ? parseDurationValue(item.timeEstimate) : undefined,
          },
        })

        if (item.note) {
          await clickupRequest(token, `/task/${item.taskId}/comment`, {
            method: "POST",
            body: { comment_text: item.note, notify_all: false },
          })
        }

        results.push(mapTask(task))
      }

      printJson(results)
      return
    }

    case "branch-name": {
      const taskId = resolveTaskId(args, configContext.state)
      const task = await clickupRequest(token, `/task/${taskId}`)
      const branchName = formatBranchName(configContext.defaults.branchFormat, task.id, args.slug || task.name)
      printJson({ taskId: task.id, branch: branchName })
      return
    }

    case "start": {
      const taskId = resolveTaskId(args, configContext.state)
      const payload = { status: args.status || configContext.defaults.startStatus }
      if (args.assign !== "false" && (args.assignee || config.assigneeId)) {
        payload.assignees = { add: parseList(args.assignee || config.assigneeId).map(Number), rem: [] }
      }

      const task = await clickupRequest(token, `/task/${taskId}`, { method: "PUT", body: payload })
      const branchName = formatBranchName(configContext.defaults.branchFormat, task.id, args.slug || task.name)
      const git = getGitContext()
      const comment = args.comment || `Started work in ${git.repoName || path.basename(process.cwd())}${git.branch ? ` on branch ${git.branch}` : ""}.`
      await clickupRequest(token, `/task/${taskId}/comment`, {
        method: "POST",
        body: { comment_text: comment, notify_all: false },
      })

      saveProjectState({ ...configContext.state, activeTaskId: task.id, suggestedBranch: branchName, lastStartedAt: new Date().toISOString() })

      if (args.branch === "true" && git.insideWorkTree) {
        try {
          execSync(`git checkout -b ${shellEscape(branchName)}`, { stdio: "pipe" })
        } catch {
        }
      }

      printJson({ task: mapTask(task), suggestedBranch: branchName, stateSavedTo: configContext.paths.projectState })
      return
    }

    case "done": {
      const taskId = resolveTaskId(args, configContext.state)
      const task = await clickupRequest(token, `/task/${taskId}`, {
        method: "PUT",
        body: { status: args.status || configContext.defaults.doneStatus },
      })

      if (args.comment) {
        await clickupRequest(token, `/task/${taskId}/comment`, {
          method: "POST",
          body: { comment_text: args.comment, notify_all: false },
        })
      }

      const nextState = { ...configContext.state }
      if (nextState.activeTaskId === taskId) {
        delete nextState.activeTaskId
      }
      saveProjectState(nextState)
      printJson({ task: mapTask(task), stateSavedTo: configContext.paths.projectState })
      return
    }

    case "sync": {
      const taskId = resolveTaskId(args, configContext.state)
      const git = getGitContext()
      const summary = buildSyncSummary(git, args.label || "manual sync")
      await clickupRequest(token, `/task/${taskId}/comment`, {
        method: "POST",
        body: { comment_text: summary, notify_all: false },
      })

      const prUrl = resolvePullRequestUrl(args.pr)
      if (prUrl) {
        await clickupRequest(token, `/task/${taskId}/comment`, {
          method: "POST",
          body: { comment_text: `Linked pull request: ${prUrl}`, notify_all: false },
        })
      }

      printJson({ taskId, synced: true, summary, prUrl: prUrl || null })
      return
    }

    case "link-pr": {
      const taskId = resolveTaskId(args, configContext.state)
      const prUrl = resolvePullRequestUrl(args.pr)

      if (!prUrl) {
        throw new Error("No pull request found for the current branch. Pass --pr <url> or create/push a PR first.")
      }

      await clickupRequest(token, `/task/${taskId}/comment`, {
        method: "POST",
        body: { comment_text: `Linked pull request: ${prUrl}`, notify_all: false },
      })

      printJson({ taskId, linked: true, prUrl })
      return
    }

    case "hook-event": {
      const git = getGitContext()
      const taskId = resolveTaskIdFromContext(args, configContext.state, git)

      if (!taskId) {
        printJson({ skipped: true, reason: "No active or branch-linked task found" })
        return
      }

      const label = args.event === "post-push" ? "git push" : args.event === "post-commit" ? "git commit" : args.event || "git hook"
      const summary = buildSyncSummary(git, label)
      await clickupRequest(token, `/task/${taskId}/comment`, {
        method: "POST",
        body: { comment_text: summary, notify_all: false },
      })

      let prUrl = null
      if (args.event === "post-push") {
        prUrl = resolvePullRequestUrl()
        if (prUrl) {
          await clickupRequest(token, `/task/${taskId}/comment`, {
            method: "POST",
            body: { comment_text: `Linked pull request: ${prUrl}`, notify_all: false },
          })
        }
      }

      if (args.silent !== "true") {
        printJson({ taskId, synced: true, event: args.event, summary, prUrl })
      }
      return
    }

    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current.startsWith("--")) {
      continue
    }
    const key = current.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith("--")) {
      parsed[key] = "true"
      continue
    }
    parsed[key] = next
    index += 1
  }

  return parsed
}

function buildTaskPayload(args) {
  const payload = {}

  if (args.name) payload.name = args.name
  if (args.description) payload.description = args.description
  if (args.status) payload.status = args.status
  if (args.priority) payload.priority = normalizePriority(args.priority)
  if (args["start-date"]) payload.start_date = parseDateValue(args["start-date"])
  if (args["due-date"]) payload.due_date = parseDateValue(args["due-date"], { endOfDay: true })
  if (args["time-estimate"]) payload.time_estimate = parseDurationValue(args["time-estimate"])
  if (args["clear-time-estimate"] === "true") payload.time_estimate = null

  return payload
}

function applyAssigneeChanges(payload, args) {
  const addAssignees = args["add-assignees"] ? parseList(args["add-assignees"]).map(Number) : []
  const removeAssignees = args["remove-assignees"] ? parseList(args["remove-assignees"]).map(Number) : []

  if (addAssignees.length > 0 || removeAssignees.length > 0) {
    payload.assignees = { add: addAssignees, rem: removeAssignees }
  }
}

function resolveTaskId(args, state) {
  const taskId = args.task || args.id || state.activeTaskId
  assertRequired(taskId, "Pass --task <taskId> or set an active task with `clickup-cli start --task ...`")
  return taskId
}

function resolveTaskIdFromContext(args, state, git) {
  if (args.task || args.id || state.activeTaskId) {
    return args.task || args.id || state.activeTaskId
  }

  if (!git.branch) {
    return null
  }

  const branchMatch = git.branch.match(/(?:^|\/)(?:cu|clickup)-([a-z0-9]+)(?:-|$)/i)
  return branchMatch ? branchMatch[1] : null
}

function readJsonFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath)
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"))
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("Plan file must be a JSON object")
  }
  if (!plan.name || typeof plan.name !== "string") {
    throw new Error("Plan file requires a string 'name' field")
  }
  if (plan.subtasks && !Array.isArray(plan.subtasks)) {
    throw new Error("Plan 'subtasks' field must be an array")
  }
}

function validateMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || !metadata.parent) {
    throw new Error("Metadata file requires a parent object")
  }
}

function formatBranchName(pattern, taskId, source) {
  const slug = String(source)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

  return pattern.replace("{taskId}", taskId.toLowerCase()).replace("{slug}", slug || "task")
}

function getGitContext() {
  const insideWorkTree = runGit("git rev-parse --is-inside-work-tree") === "true"

  if (!insideWorkTree) {
    return { insideWorkTree: false }
  }

  return {
    insideWorkTree: true,
    gitDir: runGit("git rev-parse --git-dir"),
    branch: runGit("git branch --show-current"),
    repoName: path.basename(runGit("git rev-parse --show-toplevel")),
    latestCommit: runGit("git log -1 --pretty=%h\ %s"),
    statusShort: runGit("git status --short"),
  }
}

function resolveCommandPath(command) {
  const resolved = runGit(`command -v ${command}`)
  return resolved || command
}

function runGit(command) {
  try {
    return execSync(command, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return ""
  }
}

function runGh(command) {
  try {
    return execSync(command, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return ""
  }
}

function resolvePullRequestUrl(explicitUrl) {
  if (explicitUrl) {
    return explicitUrl
  }

  const prUrl = runGh("gh pr view --json url --jq .url")
  return prUrl || null
}

function buildSyncSummary(git, label = "sync") {
  if (!git.insideWorkTree) {
    return `${label} update from ${path.basename(process.cwd())}: not inside a git repository.`
  }

  const changedFiles = git.statusShort
    ? git.statusShort
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 10)
    : []

  const parts = [
    `${capitalize(label)} update from ${git.repoName}.`,
    git.branch ? `Branch: ${git.branch}.` : null,
    git.latestCommit ? `Latest commit: ${git.latestCommit}.` : null,
    changedFiles.length > 0 ? `Working tree changes: ${changedFiles.join(", ")}.` : "Working tree clean.",
  ].filter(Boolean)

  return parts.join(" ")
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function printCollection(items, fields) {
  const rows = (items || []).map((item) => {
    const row = {}
    for (const field of fields) {
      row[field] = field.split(".").reduce((value, key) => (value == null ? value : value[key]), item)
    }
    return row
  })
  printJson(rows)
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printHelp() {
  const helpText = [
    "clickup-cli",
    "",
    "Setup:",
    "  clickup-cli setup --token <token> --team <teamId> --space <spaceId> --list <listId> --assignee <userId>",
    "  clickup-cli init --name <project-name>",
    "  clickup-cli config",
    "  clickup-cli install-hooks",
    "",
    "Discovery:",
    "  clickup-cli me",
    "  clickup-cli teams",
    "  clickup-cli spaces --team <teamId>",
    "  clickup-cli folders --space <spaceId>",
    "  clickup-cli space-lists --space <spaceId>",
    "  clickup-cli lists --folder <folderId>",
    "  clickup-cli tasks",
    "  clickup-cli task --task <taskId>",
    "",
    "Daily work:",
    "  clickup-cli start --task <taskId>",
    "  clickup-cli sync --task <taskId>",
    "  clickup-cli link-pr --task <taskId>",
    "  clickup-cli done --task <taskId> --comment \"Finished implementation\"",
    "  clickup-cli branch-name --task <taskId>",
    "  clickup-cli hook-event --event post-commit",
    "",
    "Task operations:",
    "  clickup-cli create-task --name \"Task name\"",
    "  clickup-cli update-task --task <taskId> --status \"in progress\"",
    "  clickup-cli comment --task <taskId> --comment \"Progress update\"",
    "  clickup-cli create-plan --file plan.json",
    "  clickup-cli sync-metadata --file metadata.json",
  ].join("\n")

  process.stdout.write(`${helpText}\n`)
}

module.exports = { run }
