import { Octokit } from 'octokit'

const REPO_OWNER = 'msitarzewski'
const REPO_NAME = 'agency-agents'

export function createGitHubClient() {
  return new Octokit({
    auth: process.env.GITHUB_TOKEN,
  })
}

export async function fetchAgentFiles() {
  const octokit = createGitHubClient()

  const { data } = await octokit.rest.git.getTree({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    tree_sha: 'main',
    recursive: '1',
  })

  const mdFiles = data.tree.filter(
    (f) => f.type === 'blob' && f.path?.endsWith('.md') && f.path !== 'README.md'
  )

  const results: Array<{ path: string; content: string }> = []

  for (const file of mdFiles) {
    if (!file.path || !file.url) continue
    try {
      const { data: blob } = await octokit.rest.git.getBlob({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        file_sha: file.sha!,
      })
      const content = Buffer.from(blob.content, 'base64').toString('utf-8')
      results.push({ path: file.path, content })
    } catch {
      // skip unreadable files
    }
  }

  return results
}
