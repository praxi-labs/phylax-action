export type FailOn = 'block' | 'warn' | 'never'
export type ReportFormat = 'sarif' | 'json' | 'none'

export interface ActionInputs {
  apiToken: string
  artifactPath: string
  artifacts: string[]
  policy: string | undefined
  failOn: FailOn
  format: ReportFormat
  output: string
  comment: boolean
  githubToken: string | undefined
  baseUrl: string | undefined
}

export type InputReader = (name: string) => string

const FAIL_ON: readonly FailOn[] = ['block', 'warn', 'never']
const FORMATS: readonly ReportFormat[] = ['sarif', 'json', 'none']

export function parseInputs(read: InputReader): ActionInputs {
  const apiToken = read('api-token').trim()
  if (!apiToken) {
    throw new Error(
      'api-token is required. Store your Phylax token as a secret and pass it as api-token.',
    )
  }

  const failOnRaw = (read('fail-on') || 'block').trim().toLowerCase()
  if (!FAIL_ON.includes(failOnRaw as FailOn)) {
    throw new Error(`fail-on must be one of ${FAIL_ON.join(', ')}. Received "${failOnRaw}".`)
  }

  const formatRaw = (read('format') || 'sarif').trim().toLowerCase()
  if (!FORMATS.includes(formatRaw as ReportFormat)) {
    throw new Error(`format must be one of ${FORMATS.join(', ')}. Received "${formatRaw}".`)
  }

  const artifacts = read('artifacts')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  const githubToken = read('github-token').trim()

  return {
    apiToken,
    artifactPath: read('artifact-path').trim() || '.',
    artifacts,
    policy: read('policy').trim() || undefined,
    failOn: failOnRaw as FailOn,
    format: formatRaw as ReportFormat,
    output: read('output').trim() || 'phylax.sarif',
    comment: read('comment').trim().toLowerCase() === 'true',
    githubToken: githubToken || undefined,
    baseUrl: read('base-url').trim() || undefined,
  }
}

export function shouldFail(
  failOn: FailOn,
  counts: { blocked: number; warned: number },
): boolean {
  if (failOn === 'never') {
    return false
  }
  if (failOn === 'warn') {
    return counts.blocked > 0 || counts.warned > 0
  }
  return counts.blocked > 0
}
