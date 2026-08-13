import { PhylaxSdk } from '@phyi/sdk'

import { discoverArtifacts } from './manifests.js'
import { parseInputs, shouldFail, type ActionInputs, type InputReader } from './inputs.js'
import {
  countVerdicts,
  strictestVerdict,
  toSarif,
  toSummary,
  type VerifiedArtifact,
} from './sarif.js'

export interface ActionIo {
  getInput: InputReader
  setOutput: (name: string, value: string) => void
  setFailed: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
  writeFile: (path: string, contents: string) => Promise<void>
  writeSummary: (markdown: string) => Promise<void>
  makeSdk?: (inputs: ActionInputs) => PhylaxSdk
}

const VERSION = '0.1.0'

export async function run(io: ActionIo): Promise<number> {
  let inputs: ActionInputs

  try {
    inputs = parseInputs(io.getInput)
  } catch (error) {
    io.setFailed(error instanceof Error ? error.message : String(error))
    return 1
  }

  const sdk =
    io.makeSdk?.(inputs) ??
    new PhylaxSdk({
      apiToken: inputs.apiToken,
      baseUrl: inputs.baseUrl,
      userAgent: `phylax-action/${VERSION}`,
    })

  let targets = inputs.artifacts

  if (targets.length === 0) {
    const discovered = await discoverArtifacts(inputs.artifactPath)
    targets = discovered.map(entry => entry.purl)
    io.info(`Discovered ${targets.length} artifacts under ${inputs.artifactPath}`)
  }

  if (targets.length === 0) {
    io.warning(
      'No artifacts found to verify. Supply artifacts explicitly, or point artifact-path at a lockfile.',
    )
    io.setOutput('verdict', 'ALLOW')
    io.setOutput('blocked-count', '0')
    io.setOutput('warned-count', '0')
    return 0
  }

  const response = await sdk.artifacts.verifyMany(targets, {
    ...(inputs.policy ? { policy: inputs.policy } : {}),
  })

  if (!response.success) {
    io.setFailed(
      `Phylax verification failed (${response.code}, HTTP ${response.status}): ${response.error}`,
    )
    return 1
  }

  const results = (
    Array.isArray(response.data) ? response.data : [response.data]
  ) as VerifiedArtifact[]

  const counts = countVerdicts(results)
  const verdict = strictestVerdict(results)

  io.setOutput('verdict', verdict)
  io.setOutput('blocked-count', String(counts.blocked))
  io.setOutput('warned-count', String(counts.warned))

  if (inputs.format !== 'none') {
    const report =
      inputs.format === 'sarif'
        ? toSarif(results, VERSION)
        : JSON.stringify(results, null, 2)

    await io.writeFile(inputs.output, report)
    io.setOutput('report-path', inputs.output)
    io.info(`Wrote ${inputs.format} report to ${inputs.output}`)
  }

  await io.writeSummary(toSummary(results))

  io.info(
    `Verified ${results.length} artifacts. ${counts.blocked} blocked, ${counts.warned} warned.`,
  )

  if (shouldFail(inputs.failOn, counts)) {
    io.setFailed(
      `Phylax verdict ${verdict}. ${counts.blocked} artifacts blocked, ${counts.warned} warned.`,
    )
    return 1
  }

  return 0
}
