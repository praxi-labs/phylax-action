import { describe, expect, it, vi } from 'vitest'

import { PhylaxSdk } from '@phyi/sdk'

import { parseInputs, shouldFail } from '../../src/inputs.js'
import { parsePackageLock, parseRequirements } from '../../src/manifests.js'
import { countVerdicts, strictestVerdict, toSarif } from '../../src/sarif.js'
import { run, type ActionIo } from '../../src/run.js'

const BASE_INPUTS: Record<string, string> = {
  'api-token': 'phx_live_test',
  'artifact-path': '.',
  artifacts: '',
  policy: '',
  'fail-on': 'block',
  format: 'sarif',
  output: 'phylax.sarif',
  comment: 'false',
  'github-token': '',
  'base-url': '',
}

function io(
  overrides: Record<string, string> = {},
  verifyResponse: unknown = [],
): ActionIo & {
  outputs: Record<string, string>
  failures: string[]
  files: Record<string, string>
} {
  const inputs = { ...BASE_INPUTS, ...overrides }
  const outputs: Record<string, string> = {}
  const failures: string[] = []
  const files: Record<string, string> = {}

  return {
    outputs,
    failures,
    files,
    getInput: name => inputs[name] ?? '',
    setOutput: (name, value) => {
      outputs[name] = value
    },
    setFailed: message => failures.push(message),
    info: () => {},
    warning: () => {},
    writeFile: async (path, contents) => {
      files[path] = contents
    },
    writeSummary: async () => {},
    makeSdk: () =>
      new PhylaxSdk({
        apiToken: 'phx_live_test',
        maxRetries: 1,
        fetch: vi.fn().mockImplementation(() =>
          new Response(JSON.stringify(verifyResponse), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ) as never,
      }),
  }
}

describe('inputs', () => {
  it('requires an api token', () => {
    expect(() => parseInputs(name => (name === 'api-token' ? '' : ''))).toThrow(
      /api-token is required/,
    )
  })

  it('rejects an unknown fail-on value', () => {
    const read = (name: string) =>
      name === 'api-token' ? 'x' : name === 'fail-on' ? 'sometimes' : ''
    expect(() => parseInputs(read)).toThrow(/fail-on must be one of/)
  })

  it('rejects an unknown format', () => {
    const read = (name: string) =>
      name === 'api-token' ? 'x' : name === 'format' ? 'xml' : ''
    expect(() => parseInputs(read)).toThrow(/format must be one of/)
  })

  it('splits a comma separated artifact list', () => {
    const read = (name: string) =>
      name === 'api-token' ? 'x' : name === 'artifacts' ? 'a@1, b@2 ,' : ''
    expect(parseInputs(read).artifacts).toEqual(['a@1', 'b@2'])
  })
})

describe('shouldFail', () => {
  it('fails on block by default', () => {
    expect(shouldFail('block', { blocked: 1, warned: 0 })).toBe(true)
    expect(shouldFail('block', { blocked: 0, warned: 5 })).toBe(false)
  })

  it('fails on warn when configured to', () => {
    expect(shouldFail('warn', { blocked: 0, warned: 1 })).toBe(true)
  })

  it('never fails when set to never', () => {
    expect(shouldFail('never', { blocked: 9, warned: 9 })).toBe(false)
  })
})

describe('manifest parsing', () => {
  it('reads a v2 package-lock', () => {
    const lock = JSON.stringify({
      packages: {
        '': { version: '1.0.0' },
        'node_modules/express': { version: '4.18.2' },
        'node_modules/@scope/pkg': { version: '2.0.0' },
      },
    })
    const found = parsePackageLock(lock, 'package-lock.json').map(a => a.purl)

    expect(found).toContain('pkg:npm/express@4.18.2')
    expect(found).toContain('pkg:npm/%40scope/pkg@2.0.0')
  })

  it('reads pinned requirements and ignores comments and flags', () => {
    const found = parseRequirements(
      ['# comment', 'requests==2.32.3', '-r other.txt', 'flask>=2', ''].join('\n'),
      'requirements.txt',
    ).map(a => a.purl)

    expect(found).toEqual(['pkg:pypi/requests@2.32.3'])
  })
})

describe('sarif', () => {
  const results = [
    { artifact: 'pkg:npm/a@1', verdict: 'ALLOW' },
    { artifact: 'pkg:npm/b@2', verdict: 'WARN' },
    {
      artifact: 'pkg:npm/c@3',
      verdict: 'BLOCK',
      findings: [{ type: 'malware', title: 'Install script exfiltrates env', severity: 'critical' }],
    },
  ]

  it('counts verdicts', () => {
    expect(countVerdicts(results)).toEqual({ blocked: 1, warned: 1, allowed: 1, uncovered: 0 })
  })

  it('reports the strictest verdict', () => {
    expect(strictestVerdict(results)).toBe('BLOCK')
    expect(strictestVerdict([{ artifact: 'a', verdict: 'ALLOW' }])).toBe('ALLOW')
  })

  it('omits passing artifacts from the report', () => {
    const sarif = JSON.parse(toSarif(results, '0.1.0'))
    const messages = sarif.runs[0].results.map((r: { message: { text: string } }) => r.message.text)

    expect(messages.some((m: string) => m.includes('pkg:npm/a@1'))).toBe(false)
    expect(messages.some((m: string) => m.includes('pkg:npm/c@3'))).toBe(true)
  })

  it('maps a block to error level', () => {
    const sarif = JSON.parse(toSarif(results, '0.1.0'))
    const blocked = sarif.runs[0].results.find((r: { properties: { verdict: string } }) =>
      r.properties.verdict === 'BLOCK',
    )
    expect(blocked.level).toBe('error')
  })

  it('produces schema identifying fields code scanning requires', () => {
    const sarif = JSON.parse(toSarif(results, '0.1.0'))
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs[0].tool.driver.name).toBe('Phylax')
    expect(Array.isArray(sarif.runs[0].tool.driver.rules)).toBe(true)
  })
})

describe('run', () => {
  it('passes a clean run and writes a report', async () => {
    const context = io({ artifacts: 'pkg:npm/a@1' }, [
      { artifact: 'pkg:npm/a@1', verdict: 'ALLOW' },
    ])
    const code = await run(context)

    expect(code).toBe(0)
    expect(context.failures).toEqual([])
    expect(context.outputs['verdict']).toBe('ALLOW')
    expect(context.files['phylax.sarif']).toBeDefined()
  })

  it('fails the job on a block', async () => {
    const context = io({ artifacts: 'pkg:npm/bad@1' }, [
      { artifact: 'pkg:npm/bad@1', verdict: 'BLOCK' },
    ])
    const code = await run(context)

    expect(code).toBe(1)
    expect(context.outputs['blocked-count']).toBe('1')
    expect(context.failures.join(' ')).toMatch(/BLOCK/)
  })

  it('still writes the report when the job fails', async () => {
    const context = io({ artifacts: 'pkg:npm/bad@1' }, [
      { artifact: 'pkg:npm/bad@1', verdict: 'BLOCK' },
    ])
    await run(context)

    expect(context.files['phylax.sarif']).toBeDefined()
  })

  it('does not fail on a warn by default', async () => {
    const context = io({ artifacts: 'pkg:npm/w@1' }, [
      { artifact: 'pkg:npm/w@1', verdict: 'WARN' },
    ])
    expect(await run(context)).toBe(0)
  })

  it('fails on a warn when fail-on is warn', async () => {
    const context = io({ artifacts: 'pkg:npm/w@1', 'fail-on': 'warn' }, [
      { artifact: 'pkg:npm/w@1', verdict: 'WARN' },
    ])
    expect(await run(context)).toBe(1)
  })

  it('writes no report when format is none', async () => {
    const context = io({ artifacts: 'pkg:npm/a@1', format: 'none' }, [
      { artifact: 'pkg:npm/a@1', verdict: 'ALLOW' },
    ])
    await run(context)

    expect(Object.keys(context.files)).toEqual([])
  })

  it('fails cleanly on a missing token rather than throwing', async () => {
    const context = io({ 'api-token': '' })
    expect(await run(context)).toBe(1)
    expect(context.failures.join(' ')).toMatch(/api-token is required/)
  })
})

describe('uncovered artifacts', () => {
  const mixed = [
    { artifact: 'npm:a', verdict: 'ALLOW' },
    { artifact: 'npm:b', verdict: 'ALLOW', coverage: 'none' },
  ]

  it('does not count an unevaluated artifact as allowed', () => {
    expect(countVerdicts(mixed)).toEqual({ blocked: 0, warned: 0, allowed: 1, uncovered: 1 })
  })

  it('fails the job only when fail-on is uncovered', () => {
    const counts = { blocked: 0, warned: 0, uncovered: 1 }
    expect(shouldFail('block', counts)).toBe(false)
    expect(shouldFail('warn', counts)).toBe(false)
    expect(shouldFail('uncovered', counts)).toBe(true)
    expect(shouldFail('never', counts)).toBe(false)
  })
})
