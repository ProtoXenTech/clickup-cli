const API_BASE_URL = "https://api.clickup.com/api/v2"

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

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(stripUndefined(options.body)) : undefined,
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const errorMessage = data?.err || data?.error || response.statusText
    throw new Error(`ClickUp API error (${response.status}): ${errorMessage}`)
  }

  return data
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
