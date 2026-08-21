export interface VerifiedArtifact {
  artifact: string
  verdict: string
  risk_score?: number
  findings?: Array<{
    type?: string
    title?: string
    severity?: string
    file?: string
  }>
  [key: string]: unknown
}

export interface Counts {
  blocked: number
  warned: number
  allowed: number
  uncovered: number
}

export function isUncovered(result: VerifiedArtifact): boolean {
  return String(result.coverage ?? '') === 'none'
}

const SEVERITY_TO_LEVEL: Record<string, string> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
}

export function countVerdicts(results: VerifiedArtifact[]): Counts {
  const counts: Counts = { blocked: 0, warned: 0, allowed: 0, uncovered: 0 }

  for (const result of results) {
    if (isUncovered(result)) {
      counts.uncovered++
      continue
    }
    const verdict = String(result.verdict ?? '').toUpperCase()
    if (verdict === 'BLOCK') {
      counts.blocked++
    } else if (verdict === 'WARN') {
      counts.warned++
    } else {
      counts.allowed++
    }
  }

  return counts
}

export function strictestVerdict(results: VerifiedArtifact[]): string {
  const counts = countVerdicts(results)
  if (counts.blocked > 0) {
    return 'BLOCK'
  }
  if (counts.warned > 0) {
    return 'WARN'
  }
  return 'ALLOW'
}

export function toSarif(results: VerifiedArtifact[], version: string): string {
  const rules = new Map<string, Record<string, unknown>>()
  const sarifResults: Array<Record<string, unknown>> = []

  for (const result of results) {
    const verdict = String(result.verdict ?? '').toUpperCase()
    if (verdict === 'ALLOW') {
      continue
    }

    const findings =
      result.findings && result.findings.length > 0
        ? result.findings
        : [{ type: 'policy', title: `${verdict} verdict for ${result.artifact}` }]

    for (const finding of findings) {
      const ruleId = `phylax/${finding.type ?? 'policy'}`

      if (!rules.has(ruleId)) {
        rules.set(ruleId, {
          id: ruleId,
          name: finding.type ?? 'policy',
          shortDescription: { text: finding.title ?? ruleId },
          helpUri: 'https://build.phyi.dev/core-concepts/',
        })
      }

      sarifResults.push({
        ruleId,
        level:
          verdict === 'BLOCK'
            ? 'error'
            : (SEVERITY_TO_LEVEL[String(finding.severity ?? '').toLowerCase()] ??
              'warning'),
        message: {
          text: `${verdict} ${result.artifact}: ${finding.title ?? finding.type ?? 'policy violation'}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: finding.file ?? 'package.json' },
              region: { startLine: 1 },
            },
          },
        ],
        properties: {
          artifact: result.artifact,
          verdict,
          ...(result.risk_score === undefined ? {} : { riskScore: result.risk_score }),
        },
      })
    }
  }

  return JSON.stringify(
    {
      $schema:
        'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'Phylax',
              informationUri: 'https://phyi.dev',
              version,
              rules: [...rules.values()],
            },
          },
          results: sarifResults,
        },
      ],
    },
    null,
    2,
  )
}

export function toSummary(results: VerifiedArtifact[]): string {
  const counts = countVerdicts(results)
  const lines = [
    '## Phylax verification',
    '',
    `| Verdict | Count |`,
    `| --- | --- |`,
    `| BLOCK | ${counts.blocked} |`,
    `| WARN | ${counts.warned} |`,
    `| ALLOW | ${counts.allowed} |`,
    `| NOT EVALUATED | ${counts.uncovered} |`,
  ]

  if (counts.uncovered > 0) {
    lines.push(
      '',
      `${counts.uncovered} of ${results.length} artifacts have not been evaluated by the `
        + 'network. No verdict was formed for them, so they are neither allowed nor blocked.',
    )
  }

  const notable = results.filter(
    result => !isUncovered(result)
      && String(result.verdict ?? '').toUpperCase() !== 'ALLOW',
  )

  if (notable.length > 0) {
    lines.push('', '### Findings', '', '| Artifact | Verdict | Risk |', '| --- | --- | --- |')
    for (const result of notable.slice(0, 50)) {
      lines.push(
        `| \`${result.artifact}\` | ${String(result.verdict).toUpperCase()} | ${result.risk_score ?? 'n/a'} |`,
      )
    }
    if (notable.length > 50) {
      lines.push('', `and ${notable.length - 50} more`)
    }
  }

  return lines.join('\n')
}
