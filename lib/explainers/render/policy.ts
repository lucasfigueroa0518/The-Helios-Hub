import path from 'node:path';

/**
 * Tool policy for the render agent (BUILD_PLAN §5, Risk 2: an LLM with a shell).
 *
 * Every tool call — the orchestrator's and every frame worker's — passes this
 * check in a PreToolUse hook. File tools must stay inside the job directory.
 * Bash runs only an allowlisted program with no shell features that could
 * chain, redirect outside, or substitute another command. The OS sandbox is a
 * second layer under this one, not a replacement for it.
 */

export type PolicyDecision = { allow: true } | { allow: false; reason: string };

const allow: PolicyDecision = { allow: true };
const deny = (reason: string): PolicyDecision => ({ allow: false, reason });

/** Tools the session may have at all. No web fetch, no web search, no MCP. */
// The subagent tool is `Agent` in this SDK (`Task` in older ones); frame workers need it.
// SubagentHandback is how a frame worker returns its report. Denying it drops the
// report; the file is still written, and the orchestrator waits out the silence.
export const SESSION_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Agent', 'Task', 'Skill', 'TodoWrite', 'SubagentHandback'];

/** Tools a frame worker may use: read its packet and frame.md, write its one file. */
export const FRAME_WORKER_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

const PATH_KEYS = ['file_path', 'path', 'notebook_path'];

/** Inside the project but never writable: the pinned skills and the CLI install. */
const READ_ONLY_DIRS = ['.claude', 'node_modules', '.media'];
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

/** True when `target` resolves inside `root` (symlink-free lexical check). */
export function insideDir(root: string, target: string, cwd = root): boolean {
  const resolved = path.resolve(cwd, target);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(base + path.sep);
}

/**
 * Programs Bash may run. `npx` only as `npx hyperframes` (the pinned CLI on the
 * PATH); `node` only on a script inside the job directory.
 */
export const BASH_PROGRAMS = new Set([
  'node',
  'npx',
  'hyperframes',
  'ffmpeg',
  'ffprobe',
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'sed',
  'sort',
  'uniq',
  'pgrep',
  'find',
  'mkdir',
  'cp',
  'mv',
  'pwd',
  'echo',
  'test',
  'true',
  'sleep',
  'wait',
]);

/** Variables a command may not override. */
const PROTECTED_ENV = /^(PATH|HOME|TMPDIR|NODE_OPTIONS|NODE_PATH|NODE_USE_ENV_PROXY|HTTPS?_PROXY|NO_PROXY|ALL_PROXY|LD_\w+|DYLD_\w+|ANTHROPIC_\w+|HEYGEN_\w+|HELIOS_\w+|BASH_ENV|ENV)$/i;

/** Shell features that can chain or smuggle commands. `&&`, `;`, and trailing `&` are handled separately. */
const FORBIDDEN_SHELL = [
  { re: /\$\(|`/, why: 'command substitution' },
  { re: /<\(|>\(/, why: 'process substitution' },
  { re: /\|\|/, why: '||' },
  { re: /<<|<(?!\()/, why: 'input redirection' },
  // `source`, `eval`, `exec`, and `sudo` are not on the allowlist, so they need no
  // word-boundary rule here. A boundary on `source` also matched `source.txt`.
  { re: /\b(curl|wget|nc|ncat|ssh|scp|rsync|git|python3?|perl|ruby|bash|sh|zsh|osascript|open|security|launchctl|crontab|kill|pkill|chmod|chown|rm|ln)\b/, why: 'a disallowed program' },
];

/**
 * Split a command line into the commands it runs: on `&&`, `;`, newlines, and
 * single pipes (each side of a pipe must pass on its own), dropping a trailing
 * background `&`. `||` is refused before this runs.
 */
export function splitCommands(command: string): string[] {
  return command
    .split(/&&|;|\n|\|/)
    .map((part) => part.trim().replace(/\s*&$/, '').trim())
    .filter(Boolean);
}

function tokens(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((t) => t.replace(/^["']|["']$/g, '')) ?? [];
}

function checkSegment(segment: string, jobDir: string, cwd: string): PolicyDecision {
  const words = tokens(segment);
  // Leading VAR=value assignments are fine (S=dir, PROJECT_DIR=$PWD) except ones that
  // change what runs or which secrets apply. Their values are path-checked below.
  const assigned: string[] = [];
  while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    const [name, ...rest] = words.shift()!.split('=');
    if (PROTECTED_ENV.test(name)) return deny(`env assignment ${name} is not allowed`);
    assigned.push(rest.join('='));
  }
  const program = words[0];
  if (!program) {
    // A bare assignment (`S=dir;`): only its values need the path check.
    if (!assigned.length) return deny('empty command');
    for (const value of assigned) {
      if ((value.startsWith('/') || value.startsWith('..') || value.startsWith('~')) && !insideDir(jobDir, value, cwd)) {
        return deny(`path outside the job: ${value}`);
      }
    }
    return allow;
  }
  if (program.includes('/') && !insideDir(jobDir, program, cwd)) return deny(`program path outside the job: ${program}`);
  const name = path.basename(program);
  if (!BASH_PROGRAMS.has(name)) return deny(`program "${name}" is not allowlisted`);
  if (name === 'npx' && words[1] !== 'hyperframes' && words[1] !== '--no-install') {
    return deny('npx may only run hyperframes');
  }
  if (name === 'npx' && words[1] === '--no-install' && words[2] !== 'hyperframes') {
    return deny('npx may only run hyperframes');
  }
  if ((name === 'npx' || name === 'hyperframes') && words.some((w) => /^(skills|upgrade|publish|open|catch-up)$/.test(w))) {
    return deny('hyperframes skills/upgrade/publish/open are not allowed');
  }
  if (name === 'node' && (words.includes('-e') || words.includes('--eval') || words.includes('-p'))) {
    return deny('node -e is not allowed; run a script file');
  }
  // sed's `e` command and `s///e` flag run shell commands.
  if (name === 'sed' && words.slice(1).some((w) => /(^|[;{\s])[0-9$,]*e(\s|$|;)|\/[gpiImMw0-9]*e[gpiImMw0-9]*$/.test(w))) {
    return deny('sed command execution is not allowed');
  }
  if (name === 'find' && words.some((w) => /^-(exec|execdir|delete|ok)$/.test(w))) {
    return deny('find -exec/-delete is not allowed');
  }
  // Every path-looking argument and every output redirect must stay inside the job.
  for (const word of [...assigned, ...words.slice(1)]) {
    const candidate = word.replace(/^[0-9]*>>?/, '').replace(/^--?[\w-]+=/, '');
    if (!candidate) continue;
    if (candidate.startsWith('~')) return deny(`home paths are not allowed: ${word}`);
    if ((candidate.startsWith('/') || candidate.startsWith('..')) && !insideDir(jobDir, candidate, cwd)) {
      // Read-only system binaries and devices are fine as arguments (e.g. /dev/null).
      if (candidate !== '/dev/null') return deny(`path outside the job: ${candidate}`);
    }
  }
  return allow;
}

export function checkBash(command: string, jobDir: string, cwd = jobDir): PolicyDecision {
  for (const { re, why } of FORBIDDEN_SHELL) {
    if (re.test(command)) return deny(`bash: ${why} not allowed`);
  }
  for (const segment of splitCommands(command)) {
    // `cd <dir>` inside the job only.
    const cd = /^cd\s+(\S+)$/.exec(segment);
    if (cd) {
      if (!insideDir(jobDir, cd[1].replace(/^["']|["']$/g, ''), cwd)) return deny(`cd outside the job: ${cd[1]}`);
      continue;
    }
    const decision = checkSegment(segment, jobDir, cwd);
    if (!decision.allow) return decision;
  }
  return allow;
}

/** The one gate every tool call passes. */
export function checkToolCall(toolName: string, input: Record<string, unknown>, jobDir: string): PolicyDecision {
  if (!SESSION_TOOLS.includes(toolName)) return deny(`tool ${toolName} is not available`);
  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : '';
    return checkBash(command, jobDir);
  }
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value && !insideDir(jobDir, value)) {
      return deny(`${toolName} outside the job directory: ${value}`);
    }
    if (typeof value === 'string' && value && WRITE_TOOLS.has(toolName)) {
      const ro = READ_ONLY_DIRS.find((dir) => insideDir(path.join(jobDir, dir), value, jobDir));
      if (ro) return deny(`${toolName} into ${ro}/ is not allowed (pinned, read-only)`);
    }
  }
  if (toolName === 'Glob' || toolName === 'Grep') {
    const pattern = typeof input.pattern === 'string' ? input.pattern : '';
    if (toolName === 'Glob' && (pattern.startsWith('/') || pattern.includes('..')) && !insideDir(jobDir, pattern.replace(/\*.*$/, ''))) {
      return deny(`Glob outside the job directory: ${pattern}`);
    }
  }
  return allow;
}
