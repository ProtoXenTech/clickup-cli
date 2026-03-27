const API_BASE_URL = "https://api.clickup.com/api/v2"
const DEFAULT_REQUEST_TIMEOUT_MS = 10000
const DEFAULT_RETRY_COUNT = 2

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assertRequired(value, message) {
  if (!value) {
    throw new Error(message)
  }
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function parseList(value) {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseDateValue(value, options = {}) {
  if (/^\d+$/.test(String(value))) {
    return Number(value)
  }

  const date = new Date(String(value))

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`)
  }

  if (options.endOfDay) {
    date.setHours(23, 59, 59, 999)
  } else {
    date.setHours(9, 0, 0, 0)
  }

  return date.getTime()
}

function parseDurationValue(value) {
  const normalized = String(value).trim().toLowerCase()
  const match = normalized.match(/^(\d+(?:\.\d+)?)(m|h|d)$/)

  if (!match) {
    throw new Error("Time estimate must use m, h, or d units, for example 30m, 4h, or 2d")
  }

  const amount = Number(match[1])
  const unit = match[2]
  const multipliers = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 8 * 60 * 60 * 1000,
  }

  return Math.round(amount * multipliers[unit])
}

function normalizePriority(value) {
  const priorityMap = {
    urgent: 1,
    high: 2,
    normal: 3,
    low: 4,
    1: 1,
    2: 2,
    3: 3,
    4: 4,
  }

  const normalized = priorityMap[String(value).toLowerCase()]

  if (!normalized) {
    throw new Error("Priority must be one of: urgent, high, normal, low, 1, 2, 3, 4")
  }

  return normalized
}

async function clickupRequest(token, endpoint, options = {}) {
  assertRequired(token, "Provide a ClickUp token with `clickup-dev setup --token ...` or CLICKUP_API_TOKEN")

  const maxAttempts = Math.max(1, Number(options.retries ?? DEFAULT_RETRY_COUNT) + 1)
  let lastError

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeoutMs = Number(options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS)
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: options.method || "GET",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: options.body ? JSON.stringify(stripUndefined(options.body)) : undefined,
        signal: controller.signal,
      })

      clearTimeout(timeout)

      const text = await response.text()
      const data = text ? JSON.parse(text) : null

      if (response.ok) {
        return data
      }

      const errorMessage = data?.err || data?.error || response.statusText
      lastError = new Error(`ClickUp API error (${response.status}): ${errorMessage}`)

      const shouldRetry = response.status === 429 || response.status >= 500
      if (!shouldRetry || attempt === maxAttempts) {
        throw lastError
      }
    } catch (error) {
      clearTimeout(timeout)

      const isAbort = error.name === "AbortError"
      const isTransient = isAbort || error instanceof TypeError
      lastError = isAbort
        ? new Error(`ClickUp API request timed out after ${timeoutMs}ms`)
        : error

      if (!isTransient || attempt === maxAttempts) {
        throw lastError
      }
    }

    await sleep(250 * 2 ** (attempt - 1))
  }

  throw lastError
}

function mapTask(task) {
  return {
    id: task.id,
    name: task.name,
    url: task.url,
    status: task.status?.status,
    start_date: task.start_date,
    due_date: task.due_date,
    time_estimate: task.time_estimate,
    time_spent: task.time_spent,
    assignees: (task.assignees || []).map((assignee) => ({
      id: assignee.id,
      username: assignee.username,
      email: assignee.email,
    })),
  }
}

module.exports = {
  assertRequired,
  clickupRequest,
  mapTask,
  normalizePriority,
  parseDateValue,
  parseDurationValue,
  parseList,
}
