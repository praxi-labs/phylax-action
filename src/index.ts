import { writeFile } from 'node:fs/promises'

import * as core from '@actions/core'

import { run } from './run.js'

await run({
  getInput: name => core.getInput(name),
  setOutput: (name, value) => core.setOutput(name, value),
  setFailed: message => core.setFailed(message),
  info: message => core.info(message),
  warning: message => core.warning(message),
  writeFile: async (path, contents) => {
    await writeFile(path, contents, 'utf8')
  },
  writeSummary: async markdown => {
    await core.summary.addRaw(markdown).write()
  },
})
