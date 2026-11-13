import { findChecksumProblems, readChromiumChecksums } from './chromium-checksums/chromium-checksums.ts'
import { repoRoot } from './workspace/manifests.ts'

const data = readChromiumChecksums(repoRoot)
const problems = await findChecksumProblems(data)

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem)
  }
  process.exitCode = 1
} else {
  console.log(`Chrome for Testing checksums match: ${data.chromium} (${Object.keys(data.sha256).length} downloads)`)
}
