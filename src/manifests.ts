import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface DiscoveredArtifact {
  purl: string
  source: string
}

function npmPurl(name: string, version: string): string {
  const encoded = name.startsWith('@')
    ? `${encodeURIComponent(name.split('/')[0] ?? '')}/${name.split('/')[1] ?? ''}`
    : name
  return `pkg:npm/${encoded}@${version}`
}

export function parsePackageLock(content: string, source: string): DiscoveredArtifact[] {
  const parsed = JSON.parse(content) as {
    packages?: Record<string, { version?: string }>
    dependencies?: Record<string, { version?: string }>
  }

  const out: DiscoveredArtifact[] = []

  if (parsed.packages) {
    for (const [path, entry] of Object.entries(parsed.packages)) {
      if (!path || !entry?.version) {
        continue
      }
      const name = path.replace(/^node_modules\//, '').replace(/.*\/node_modules\//, '')
      if (name) {
        out.push({ purl: npmPurl(name, entry.version), source })
      }
    }
  } else if (parsed.dependencies) {
    for (const [name, entry] of Object.entries(parsed.dependencies)) {
      if (entry?.version) {
        out.push({ purl: npmPurl(name, entry.version), source })
      }
    }
  }

  return out
}

export function parseRequirements(content: string, source: string): DiscoveredArtifact[] {
  const out: DiscoveredArtifact[] = []

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? ''
    if (!line || line.startsWith('-')) {
      continue
    }
    const match = /^([A-Za-z0-9._-]+)\s*==\s*([^\s;]+)/.exec(line)
    if (match?.[1] && match[2]) {
      out.push({ purl: `pkg:pypi/${match[1].toLowerCase()}@${match[2]}`, source })
    }
  }

  return out
}

const MANIFESTS: Array<{
  file: string
  parse: (content: string, source: string) => DiscoveredArtifact[]
}> = [
  { file: 'package-lock.json', parse: parsePackageLock },
  { file: 'npm-shrinkwrap.json', parse: parsePackageLock },
  { file: 'requirements.txt', parse: parseRequirements },
]

export async function discoverArtifacts(
  root: string,
  readFileImpl: (path: string) => Promise<string> = path => readFile(path, 'utf8'),
): Promise<DiscoveredArtifact[]> {
  const found: DiscoveredArtifact[] = []

  for (const manifest of MANIFESTS) {
    const path = root.endsWith(manifest.file) ? root : join(root, manifest.file)
    try {
      const content = await readFileImpl(path)
      found.push(...manifest.parse(content, manifest.file))
    } catch {
      continue
    }
  }

  const seen = new Set<string>()
  return found.filter(entry => {
    if (seen.has(entry.purl)) {
      return false
    }
    seen.add(entry.purl)
    return true
  })
}
