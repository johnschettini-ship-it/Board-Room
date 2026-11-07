// Maps Claude's tool calls and plan text to crew roles.
//   Nova lead · Pax research · Iris design · Kit build · Vale review · Dot qa
import type { RoleId } from './types.ts'

export type Route =
  | { kind: 'work'; role: RoleId; label: string; isCheck: boolean; isShip?: boolean }
  | { kind: 'launch'; role: RoleId; title: string }
  | { kind: 'ignore' }

const UI_FILE = /\.(css|html?|tsx|jsx|svg)$/i
const RESEARCH_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'LS', 'NotebookRead', 'ToolSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool'])
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const LAUNCH_TOOLS = new Set(['Agent', 'Task', 'Workflow'])

// Bash is split into segments (&&, ||, ;, |) and each segment votes by the
// program it runs. Highest vote wins: check > review > build > research.
const CHECK = /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|tests|build|lint|typecheck|type-check|check|ci|e2e|verify)\b|(?:npx|bunx|pnpx)\s+(?:jest|vitest|mocha|tsc|eslint|playwright|cypress|prettier|biome)\b|(?:jest|vitest|mocha|ava|pytest|py\.test|tox|nox|tsc|eslint|stylelint|ruff|flake8|pylint|mypy|pyright|rspec|phpunit|gradle|gradlew|\.\/gradlew|mvn|xcodebuild|shellcheck|hadolint|ctest|make|ninja)\b|python3?\s+-m\s+(?:pytest|unittest|mypy|ruff|flake8)\b|node\s+--test\b|go\s+(?:test|build|vet)\b|cargo\s+(?:test|build|check|clippy)\b|cmake\s+--build\b|prettier\s+--check\b|black\s+--check\b|dotnet\s+(?:test|build)\b|swift\s+(?:test|build)\b|deno\s+(?:test|lint|check)\b|bazel\s+(?:test|build)\b|playwright\s+test\b|cypress\s+run\b|biome\s+(?:check|lint)\b|claude\s+plugin\s+(?:test|validate)\b)/i
const REVIEW = /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?review\b|git\s+(?:diff|log|show|blame|shortlog|range-diff|whatchanged|difftool)\b|gh\s+pr\s+(?:diff|view|review|checks)\b|(?:diff|colordiff|delta|difft|reviewdog|danger|coderabbit)\b|codex\s+review\b|\S*review\S*)/i
const INSPECT = /^(?:ls|ll|cat|bat|less|more|head|tail|grep|egrep|rg|ag|find|fd|wc|tree|file|stat|du|df|pwd|which|whereis|type|env|printenv|jq|yq|curl|wget|http|xxd|od|sort|uniq|cut|awk|sed\s+-n|git\s+(?:status|grep|ls-files|branch|remote|rev-parse))\b/i
const NEUTRAL = /^(?:cd|echo|printf|export|set|true|false|sleep|clear|source|\.)\b/i

function program(segment: string): string {
  let s = segment.trim()
  for (;;) {
    const before = s
    s = s.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, '')
    s = s.replace(/^(?:sudo|time|nice|nohup|exec|command|env)\s+/, '')
    s = s.replace(/^timeout\s+\S+\s+/, '')
    s = s.replace(/^[({]\s*/, '')
    // git's global options hide the subcommand: `git -C dir log`, `git -c k=v diff`.
    s = s.replace(/^git\s+(?:(?:-C|-c|--git-dir|--work-tree)(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)\s+|--no-pager\s+|-P\s+)+/, 'git ')
    if (s === before) return s
  }
}

/**
 * What a shell command shows as its target: the first segment that runs a
 * program, past variable assignments (`S="C:/…"`, `$s = …`) and `cd`/`echo`.
 */
export function bashLabel(command: string, n = 32): string {
  for (const seg of command.split(/&&|\|\||;|\||\n/)) {
    const p = program(seg)
    if (!p || NEUTRAL.test(p) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(p) || /^\$[A-Za-z_][\w:]*\s*=/.test(p)) continue
    return clip(p, n)
  }
  return clip(command, n)
}

// Work leaving the machine: a commit, a push, a pull request created or
// merged, a release, a publish or a deploy. Only these earn the town hall.
const SHIP = /^(?:git\s+(?:commit|push)\b|gh\s+(?:pr\s+(?:create|merge)|release\s+create)\b|gh\s+api\b.*\/(?:merge|releases)\b|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:publish|deploy|release)\b|cargo\s+publish\b|(?:wrangler|fly|flyctl|firebase|vercel|netlify)\s+deploy\b)/i
/** MCP tools that ship: a pull request created or merged, files pushed or committed, a release. */
const SHIP_TOOL = /(?:create|merge)_pull_request|push_files|create_or_update_file|create_release/i

/** True when a shell command ships work (see SHIP). */
export function isShipCommand(command: string): boolean {
  return command.split(/&&|\|\||;|\||\n/).some(seg => SHIP.test(program(seg)))
}

/** The role a shell command belongs to, and whether it is a test/build/lint run. */
export function classifyBash(command: string): { role: RoleId; isCheck: boolean } {
  let best = 0
  for (const seg of command.split(/&&|\|\||;|\||\n/)) {
    const p = program(seg)
    if (!p || NEUTRAL.test(p)) continue
    const vote = CHECK.test(p) ? 4 : REVIEW.test(p) ? 3 : INSPECT.test(p) ? 1 : 2
    best = Math.max(best, vote)
  }
  if (best === 4) return { role: 'qa', isCheck: true }
  if (best === 3) return { role: 'review', isCheck: false }
  if (best === 1) return { role: 'research', isCheck: false }
  return { role: 'build', isCheck: false }
}

const WORDS: [RoleId, RegExp][] = [
  ['qa', /\b(?:tests?|testing|qa|lint(?:er|ing)?|typecheck|type-check|regressions?|verify|verification|validat(?:e|ion)|smoke|e2e|coverage|failing|bugs?|debug(?:ging)?|run the build)\b/gi],
  ['review', /\b(?:review(?:s|ing|er)?|audit(?:s|ing)?|critique|diffs?|pull request|pr|code-review|approve|sign[- ]?off)\b/gi],
  ['design', /\b(?:ui|ux|css|styles?|styling|layout|design(?:s|ing)?|visuals?|mockups?|wireframes?|themes?|icons?|colou?rs?|typography|svg|html|animation|pixel(?:s|-art)?|pane|screens?)\b/gi],
  ['research', /\b(?:research|investigat(?:e|ion)|explor(?:e|ation)|find|search|read(?:ing)?|understand|analy[sz](?:e|is)|look (?:into|up)|docs|documentation|survey|compare|gather|context|inspect)\b/gi],
  ['lead', /\b(?:plan(?:ning)?|report|summar(?:y|i[sz]e)|write[- ]?up|present|brief|deliver|ship|release|announce|coordinate|decide|explain|tell the user)\b/gi],
  ['build', /\b(?:implement(?:ation)?|build|code|write|create|add|refactor|fix|port|wire|hook|integrate|update|change|edit|migrate|scaffold|install|configure|set ?up)\b/gi],
]

/** Picks the role whose keywords the text names most; ties go to the earlier role, none to build. */
export function classifyText(text: string): RoleId {
  let best: RoleId = 'build', score = 0
  for (const [role, re] of WORDS) {
    const n = (text.match(re) || []).length
    if (n > score) { best = role; score = n }
  }
  return best
}

const base = (p: unknown): string => {
  const s = typeof p === 'string' ? p : ''
  return s.split(/[\\/]/).pop() || s
}
const clip = (s: unknown, n: number): string => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function subagentRole(input: Record<string, unknown>): RoleId {
  const type = String(input.subagent_type ?? '')
  if (/^explore$/i.test(type)) return 'research'
  if (/^plan$/i.test(type)) return 'lead'
  if (/review/i.test(type)) return 'review'
  if (/test|qa/i.test(type)) return 'qa'
  if (/design|ui|ux/i.test(type)) return 'design'
  return classifyText(`${type} ${String(input.description ?? '')} ${String(input.prompt ?? '').slice(0, 400)}`)
}

/** Routes one tool call to a crew role. `self` is this mod's own tool prefix. */
export function routeTool(tool: string, input: Record<string, unknown>, self: string): Route {
  if (tool.startsWith(self)) return { kind: 'ignore' }
  if (LAUNCH_TOOLS.has(tool)) {
    const title = clip(input.description ?? input.name ?? input.prompt ?? tool, 40)
    return { kind: 'launch', role: subagentRole(input), title }
  }
  if (RESEARCH_TOOLS.has(tool)) {
    const label = tool === 'Read' ? base(input.file_path) : tool === 'Grep' || tool === 'Glob' ? clip(input.pattern, 28) : tool === 'WebSearch' ? clip(input.query, 28) : tool === 'WebFetch' ? hostOf(input.url) : clip(input.query ?? input.path, 28)
    return { kind: 'work', role: 'research', label, isCheck: false }
  }
  if (EDIT_TOOLS.has(tool)) {
    const path = String(input.file_path ?? input.notebook_path ?? '')
    return { kind: 'work', role: UI_FILE.test(path) ? 'design' : 'build', label: base(path), isCheck: false }
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(input.command ?? '')
    const { role, isCheck } = classifyBash(cmd)
    return { kind: 'work', role, label: bashLabel(cmd), isCheck, isShip: isShipCommand(cmd) }
  }
  if (tool.startsWith('mcp__')) {
    const name = tool.split('__').slice(2).join('__')
    if (SHIP_TOOL.test(name)) return { kind: 'work', role: 'build', label: clip(name, 28), isCheck: false, isShip: true }
    return { kind: 'work', role: /search|fetch|read|get|list|query|find|lookup|browse/i.test(name) ? 'research' : 'lead', label: clip(name, 28), isCheck: false }
  }
  return { kind: 'work', role: 'lead', label: '', isCheck: false }
}

function hostOf(u: unknown): string {
  try { return new URL(String(u)).hostname } catch { return clip(u, 28) }
}
