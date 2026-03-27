const fs = require("fs")
const os = require("os")
const path = require("path")

const GLOBAL_DIR = path.join(os.homedir(), ".config", "clickup-cli")
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_DIR, "config.json")
const LEGACY_GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".config", "clickup-dev-cli", "config.json")
const PROJECT_CONFIG_PATH = path.join(process.cwd(), ".clickup-cli.json")
const LEGACY_PROJECT_CONFIG_PATH = path.join(process.cwd(), ".clickup-dev.json")
const PROJECT_STATE_DIR = path.join(process.cwd(), ".clickup-cli")
const LEGACY_PROJECT_STATE_PATH = path.join(process.cwd(), ".clickup-dev", "state.json")
const PROJECT_STATE_PATH = path.join(PROJECT_STATE_DIR, "state.json")
const ENV_FILES = [".env.local", ".env"]
const DEFAULT_WORKFLOW = {
  statuses: {
    start: undefined,
    review: "review",
    done: undefined,
    blocked: "blocked",
  },
  tags: {
    milestone: "milestone",
    launch: "launch",
    ongoing: "ongoing",
  },
}

function loadEnvFiles() {
  for (const envFile of ENV_FILES) {
    const envPath = path.join(process.cwd(), envFile)

    if (!fs.existsSync(envPath)) {
      continue
    }

    const content = fs.readFileSync(envPath, "utf8")
    const lines = content.split(/\r?\n/)

    for (const line of lines) {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith("#")) {
        continue
      }

      const equalsIndex = trimmed.indexOf("=")

      if (equalsIndex === -1) {
        continue
      }

      const key = trimmed.slice(0, equalsIndex).trim()
      const rawValue = trimmed.slice(equalsIndex + 1).trim()
      const value = rawValue.replace(/^['\"]|['\"]$/g, "")

      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  }
}

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) {
    return fallback
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function writeJson(filePath, value) {
  ensureDirectory(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function mergeDefined(base, overrides) {
  const merged = { ...(base || {}) }

  for (const [key, value] of Object.entries(overrides || {})) {
    if (value !== undefined) {
      merged[key] = value
    }
  }

  return merged
}

function resolveConfig() {
  loadEnvFiles()

  const globalConfig = readJson(GLOBAL_CONFIG_PATH, readJson(LEGACY_GLOBAL_CONFIG_PATH))
  const projectConfig = readJson(PROJECT_CONFIG_PATH, readJson(LEGACY_PROJECT_CONFIG_PATH))
  const state = readJson(PROJECT_STATE_PATH, readJson(LEGACY_PROJECT_STATE_PATH))

  const envConfig = {
    token: process.env.CLICKUP_API_TOKEN,
    teamId: process.env.CLICKUP_TEAM_ID,
    spaceId: process.env.CLICKUP_SPACE_ID,
    folderId: process.env.CLICKUP_FOLDER_ID,
    listId: process.env.CLICKUP_LIST_ID,
    assigneeId: process.env.CLICKUP_ASSIGNEE_ID,
  }

  const defaults = mergeDefined(
    {
      startStatus: "in progress",
      doneStatus: "done",
      branchFormat: "cu-{taskId}-{slug}",
    },
    mergeDefined(globalConfig.defaults || {}, projectConfig.defaults || {})
  )
  const workflow = {
    ...DEFAULT_WORKFLOW,
    ...mergeDefined(globalConfig.workflow || {}, projectConfig.workflow || {}),
    statuses: mergeDefined(
      { ...DEFAULT_WORKFLOW.statuses, start: defaults.startStatus, done: defaults.doneStatus },
      mergeDefined(globalConfig.workflow?.statuses || {}, projectConfig.workflow?.statuses || {})
    ),
    tags: mergeDefined(DEFAULT_WORKFLOW.tags, mergeDefined(globalConfig.workflow?.tags || {}, projectConfig.workflow?.tags || {})),
  }

  const config = mergeDefined(globalConfig, projectConfig)
  const resolved = mergeDefined(config, envConfig)

  return {
    globalConfig,
    projectConfig,
    state,
    defaults,
    workflow,
    resolved,
    paths: {
      globalConfig: GLOBAL_CONFIG_PATH,
      projectConfig: PROJECT_CONFIG_PATH,
      projectState: PROJECT_STATE_PATH,
    },
  }
}

function saveGlobalConfig(nextConfig) {
  writeJson(GLOBAL_CONFIG_PATH, nextConfig)
}

function saveProjectConfig(nextConfig) {
  writeJson(PROJECT_CONFIG_PATH, nextConfig)
}

function saveProjectState(nextState) {
  writeJson(PROJECT_STATE_PATH, nextState)
}

function redactConfig(value) {
  return {
    ...value,
    token: value.token ? "***redacted***" : undefined,
  }
}

module.exports = {
  resolveConfig,
  saveGlobalConfig,
  saveProjectConfig,
  saveProjectState,
  redactConfig,
  DEFAULT_WORKFLOW,
}
