#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const process = require('process');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const issueKeyPattern = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const gyazoUrlPattern = /https?:\/\/(?:www\.)?(?:gyazo\.com|i\.gyazo\.com)\/[^\s<>"')\]）（。、※]+/gi;
const gyazoIdPattern = /([a-f0-9]{32})/i;
const defaultPageSize = 100;
const defaultMaxTickets = 200;

function printHelp() {
  console.log(`
Materialize Backlog ticket context into a task-local folder.

Usage:
  node .external-assets/backlog/materialize-backlog-context.js --ticket <TICKET_KEY>

Options:
  --ticket <key>        Required. Any input ticket key such as PROJ-123 (prefix routes to a space).
  --space <name>        Optional. Force the input ticket's space (e.g. main, client) when its
                        prefix is not assigned to any space. Cross-space links still auto-route.
  --output-dir <path>   Optional custom root output directory. Defaults to tasks/<RESOLVED_ROOT>.
  --max-tickets <num>   Safety limit for crawled tickets. Default: ${defaultMaxTickets}
  --help                Show this help.

Auth & spaces (configure in .agents/.env):
  Single space : BACKLOG_DOMAIN + BACKLOG_API_KEY
  Named spaces : BACKLOG_<NAME>_DOMAIN + BACKLOG_<NAME>_API_KEY
                 + BACKLOG_<NAME>_PREFIXES  (ticket prefixes routed to this space)
                 + BACKLOG_<NAME>_IS_ROOT   (tickets here are source-of-truth roots)
  Each ticket auto-routes to the space whose PREFIXES match its key. A mentioned
  ticket in another space is fetched from that space automatically.

Output:
  tasks/<ROOT_TICKET>/
    backlog-context.md
    source-map.json
    tickets/<TICKET_KEY>/
      issue.json
      comments.json
      rendered.md
      assets/
      gyazo/
`);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function ensureAbsolute(targetPath) {
  return path.isAbsolute(targetPath) ? targetPath : path.join(projectRoot, targetPath);
}

function getRelativeProjectPath(targetPath) {
  return path.relative(projectRoot, targetPath).split(path.sep).join('/');
}

// Ticket-family configuration is project-driven via env so this tool is reusable
// across any Nulab Backlog workspace (set these in .agents/.env):
//   BACKLOG_ROOT_PREFIXES  Comma-separated prefixes of the client / source-of-truth
//                             tickets to resolve a graph up to (e.g. "PROJC").
//                             If unset, ANY ticket may act as a root and the crawler
//                             simply walks up to the topmost parent.
//   BACKLOG_TICKET_PREFIXES   Comma-separated prefixes recognised as known families
//                             (e.g. "PROJ,PROJC"). If unset, the family is derived from
//                             each key's own prefix.
//   BACKLOG_LINK_FIELDS       Comma-separated custom-field names that may list related
//                             ticket keys. Defaults to "Client backlog,Internal Backlog".
// Source-of-truth ("root") prefixes. Seeded from env and extended at config
// load time by any space flagged BACKLOG_<NAME>_IS_ROOT.
const ROOT_PREFIXES = new Set(
  (process.env.BACKLOG_ROOT_PREFIXES || process.env.BACKLOG_ROOT_PREFIX || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
);

const TICKET_FAMILY_PREFIXES = (process.env.BACKLOG_TICKET_PREFIXES || '')
  .split(',')
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);

const LINK_CUSTOM_FIELDS = (process.env.BACKLOG_LINK_FIELDS || 'Client backlog,Internal Backlog')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function prefixOfKey(key) {
  const match = /^([A-Z][A-Z0-9]*)-\d+$/i.exec(String(key || '').trim());
  return match ? match[1].toUpperCase() : '';
}

function isJpRootTicket(key) {
  const prefix = prefixOfKey(key);
  if (!prefix) {
    return false;
  }
  // No client prefix configured -> treat any ticket as a potential root so the
  // crawler resolves to the topmost parent in the issue graph.
  if (ROOT_PREFIXES.size === 0) {
    return true;
  }
  return ROOT_PREFIXES.has(prefix);
}

function normalizeTicketKey(key) {
  return String(key || '').trim().toUpperCase();
}

function familyOfTicket(key) {
  const prefix = prefixOfKey(key);
  if (!prefix) {
    return 'OTHER';
  }
  if (TICKET_FAMILY_PREFIXES.length === 0) {
    return prefix;
  }
  return TICKET_FAMILY_PREFIXES.includes(prefix) ? prefix : 'OTHER';
}

function sanitizeFileName(fileName) {
  return String(fileName).replace(/[\\/:\0]/g, '_');
}

function parseArgs(argv) {
  const options = {
    maxTickets: defaultMaxTickets,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--ticket' || argument === '--output-dir' || argument === '--max-tickets' || argument === '--space') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        fail(`Missing value for ${argument}.`);
      }

      index += 1;

      if (argument === '--ticket') {
        options.ticket = normalizeTicketKey(value);
      } else if (argument === '--output-dir') {
        options.outputDir = value;
      } else if (argument === '--max-tickets') {
        options.maxTickets = Number.parseInt(value, 10);
      } else if (argument === '--space') {
        options.space = value;
      }

      continue;
    }

    fail(`Unknown argument: ${argument}`);
  }

  if (!options.help && !options.ticket) {
    fail('Provide --ticket <TICKET_KEY>.');
  }

  if (!Number.isInteger(options.maxTickets) || options.maxTickets <= 0) {
    fail('--max-tickets must be a positive integer.');
  }

  return options;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, 'utf8');
}

function parseDotEnvValue(value) {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readDotEnvIfExists(filePath) {
  const text = readTextIfExists(filePath);
  if (!text) {
    return null;
  }

  const values = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      return;
    }

    values[match[1]] = parseDotEnvValue(match[2]);
  });

  return values;
}

function normalizeDomain(value) {
  return String(value || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function splitPrefixList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function isTruthyFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

// Merge every known config source into one flat BACKLOG_* key/value map.
// Precedence (low -> high): .codex/config.toml < .mcp.json < legacy .env <
// .agents/.env < process env. Later sources override earlier ones.
function collectBacklogEnv() {
  const merged = {};
  const sources = [];

  const absorb = (label, entries) => {
    if (!entries) {
      return;
    }
    let used = false;
    Object.entries(entries).forEach(([key, value]) => {
      if (key.startsWith('BACKLOG_') && value !== undefined && value !== null && value !== '') {
        merged[key] = String(value);
        used = true;
      }
    });
    if (used) {
      sources.push(label);
    }
  };

  const codexConfig = readTextIfExists(path.join(projectRoot, '.codex', 'config.toml'));
  if (codexConfig) {
    const codexVars = {};
    const re = /(BACKLOG_[A-Z0-9_]+)\s*=\s*"([^"]+)"/g;
    let match;
    while ((match = re.exec(codexConfig)) !== null) {
      codexVars[match[1]] = match[2];
    }
    absorb('.codex/config.toml', codexVars);
  }

  const mcpJson = readJsonIfExists(path.join(projectRoot, '.mcp.json'));
  const mcpEnv = mcpJson && mcpJson.mcpServers && mcpJson.mcpServers.backlog && mcpJson.mcpServers.backlog.env;
  absorb('.mcp.json', mcpEnv);

  absorb('.external-assets/backlog/.env', readDotEnvIfExists(path.join(projectRoot, '.external-assets', 'backlog', '.env')));
  absorb('.agents/.env', readDotEnvIfExists(path.join(projectRoot, '.agents', '.env')));
  absorb('process env', process.env);

  return { merged, sources };
}

// Discover one or more Backlog spaces. Supports:
//   - Named spaces: BACKLOG_<NAME>_DOMAIN + BACKLOG_<NAME>_API_KEY
//       optional BACKLOG_<NAME>_PREFIXES (ticket prefixes routed to this space)
//       optional BACKLOG_<NAME>_IS_ROOT  (tickets here are source-of-truth roots)
//   - Legacy single space: BACKLOG_DOMAIN + BACKLOG_API_KEY (name "default")
// A ticket is routed to the space whose PREFIXES contains its key prefix; if no
// space matches, the prefix-less "default" space (if any) is used.
function loadBacklogSpaces() {
  const { merged, sources } = collectBacklogEnv();
  const spaces = [];
  const seenNames = new Set();

  Object.keys(merged).forEach((key) => {
    const match = /^BACKLOG_([A-Z0-9]+)_DOMAIN$/.exec(key);
    if (!match) {
      return;
    }
    const rawName = match[1];
    const domain = normalizeDomain(merged[`BACKLOG_${rawName}_DOMAIN`]);
    const apiKey = merged[`BACKLOG_${rawName}_API_KEY`];
    if (!domain || !apiKey) {
      return;
    }
    const name = rawName.toLowerCase();
    if (seenNames.has(name)) {
      return;
    }
    seenNames.add(name);
    spaces.push({
      name,
      domain,
      apiKey,
      prefixes: splitPrefixList(merged[`BACKLOG_${rawName}_PREFIXES`]),
      isRoot: isTruthyFlag(merged[`BACKLOG_${rawName}_IS_ROOT`]),
    });
  });

  if (merged.BACKLOG_DOMAIN && merged.BACKLOG_API_KEY && !seenNames.has('default')) {
    spaces.push({
      name: 'default',
      domain: normalizeDomain(merged.BACKLOG_DOMAIN),
      apiKey: merged.BACKLOG_API_KEY,
      prefixes: splitPrefixList(merged.BACKLOG_TICKET_PREFIXES),
      isRoot: isTruthyFlag(merged.BACKLOG_IS_ROOT),
    });
  }

  if (spaces.length === 0) {
    fail(
      'No Backlog space configured. Set BACKLOG_DOMAIN + BACKLOG_API_KEY for a single space, '
        + 'or BACKLOG_<NAME>_DOMAIN + BACKLOG_<NAME>_API_KEY (+ BACKLOG_<NAME>_PREFIXES) for named spaces, '
        + 'in .agents/.env.',
    );
  }

  // Spaces flagged as source-of-truth contribute their prefixes to ROOT_PREFIXES.
  spaces
    .filter((space) => space.isRoot)
    .forEach((space) => space.prefixes.forEach((prefix) => ROOT_PREFIXES.add(prefix)));

  // The prefix-less space (or the only space) is the fallback route for keys
  // whose prefix is not explicitly assigned to any space.
  const defaultSpace = spaces.find((space) => space.prefixes.length === 0)
    || (spaces.length === 1 ? spaces[0] : null);

  return { spaces, defaultSpace, sources };
}

function buildApiUrl(config, pathname, query = {}) {
  const url = new URL(`https://${config.domain}${pathname}`);
  url.searchParams.set('apiKey', config.apiKey);

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        url.searchParams.append(key, String(item));
      });
      return;
    }

    url.searchParams.set(key, String(value));
  });

  return url;
}

async function fetchJson(config, pathname, query) {
  const url = buildApiUrl(config, pathname, query);
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Backlog Context Orchestrator',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Backlog API ${response.status} for ${pathname}: ${body.slice(0, 400)}`);
  }

  return response.json();
}

async function fetchBinary(config, pathname, query) {
  const url = buildApiUrl(config, pathname, query);
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Backlog Context Orchestrator',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Backlog binary API ${response.status} for ${pathname}: ${body.slice(0, 400)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    buffer: Buffer.from(arrayBuffer),
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function dedupeStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractTicketKeys(text) {
  if (!text) {
    return [];
  }

  const matches = text.match(issueKeyPattern);
  return dedupeStrings((matches || []).map((match) => normalizeTicketKey(match)));
}

function extractGyazoUrls(text) {
  if (!text) {
    return [];
  }

  const matches = text.match(gyazoUrlPattern);
  return dedupeStrings(matches || []);
}

function sortTickets(keys, rootKey) {
  return [...keys].sort((left, right) => {
    if (left === rootKey) {
      return -1;
    }
    if (right === rootKey) {
      return 1;
    }
    return left.localeCompare(right);
  });
}

function summarizeText(text, maxLength = 280) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function extractGyazoId(inputUrl) {
  const match = String(inputUrl || '').match(gyazoIdPattern);
  return match ? match[1].toLowerCase() : null;
}

function extractDeclaredOriginalTicketKeys(issue) {
  const keys = new Set();

  if (issue && issue.description) {
    extractTicketKeys(issue.description).forEach((key) => {
      if (isJpRootTicket(key)) {
        keys.add(key);
      }
    });
  }

  if (issue && Array.isArray(issue.customFields)) {
    issue.customFields.forEach((field) => {
      if (!field || typeof field.name !== 'string' || typeof field.value !== 'string') {
        return;
      }

      if (LINK_CUSTOM_FIELDS.includes(field.name)) {
        extractTicketKeys(field.value).forEach((key) => keys.add(key));
      }
    });
  }

  return Array.from(keys);
}

class BacklogContextOrchestrator {
  constructor(spacesConfig, options) {
    this.spaces = spacesConfig.spaces;
    this.defaultSpace = spacesConfig.defaultSpace;
    this.sources = spacesConfig.sources;
    this.unresolvedTickets = new Set();
    this.options = options;
    this.forcedSpace = options.space ? this.spaceByName(options.space) : null;
    if (options.space && !this.forcedSpace) {
      fail(`Unknown --space "${options.space}". Configured spaces: ${this.spaces.map((space) => space.name).join(', ') || '(none)'}.`);
    }
    this.issueCache = new Map();
    this.commentCache = new Map();
    this.childrenCache = new Map();
    this.attachmentCache = new Map();
    this.ticketGraph = new Map();
    this.queue = [];
    this.processed = new Set();
    this.resolvedRootKey = null;
    this.inputIssue = null;
    this.gyazoIndex = new Map();
  }

  spaceByName(name) {
    const normalized = String(name || '').toLowerCase();
    return this.spaces.find((space) => space.name === normalized) || null;
  }

  // Route a ticket KEY to its space by prefix, falling back to the default space.
  // Returns null when no space matches and there is no default (caller decides).
  spaceForKey(key) {
    const prefix = prefixOfKey(key);
    if (prefix) {
      const match = this.spaces.find((space) => space.prefixes.includes(prefix));
      if (match) {
        return match;
      }
    }
    return this.defaultSpace;
  }

  requireSpaceForKey(key) {
    const space = this.spaceForKey(key);
    if (!space) {
      fail(
        `No Backlog space configured for ticket "${key}" (prefix "${prefixOfKey(key) || '?'}"). `
          + `Add its prefix to a BACKLOG_<NAME>_PREFIXES, or define a prefix-less default space.`,
      );
    }
    return space;
  }

  // Resolve the space a fetched issue belongs to (tagged at fetch time).
  spaceForIssue(issue) {
    return this.spaceByName(issue && issue.__spaceName) || this.spaceForKey(issue && issue.issueKey);
  }

  async getIssue(issueIdOrKey, space) {
    const resolvedSpace = space || this.requireSpaceForKey(issueIdOrKey);
    const cacheKey = `${resolvedSpace.name}:${normalizeTicketKey(issueIdOrKey)}`;
    if (this.issueCache.has(cacheKey)) {
      return this.issueCache.get(cacheKey);
    }

    const issue = await fetchJson(resolvedSpace, `/api/v2/issues/${encodeURIComponent(issueIdOrKey)}`);
    issue.__spaceName = resolvedSpace.name;
    this.issueCache.set(cacheKey, issue);
    this.issueCache.set(`${resolvedSpace.name}:${normalizeTicketKey(issue.issueKey)}`, issue);
    return issue;
  }

  async getCommentCount(issueKey, space) {
    const resolvedSpace = space || this.requireSpaceForKey(issueKey);
    const payload = await fetchJson(resolvedSpace, `/api/v2/issues/${encodeURIComponent(issueKey)}/comments/count`);
    return Number(payload.count || 0);
  }

  async getComments(issueKey, space) {
    const resolvedSpace = space || this.requireSpaceForKey(issueKey);
    const normalizedKey = normalizeTicketKey(issueKey);
    const cacheKey = `${resolvedSpace.name}:${normalizedKey}`;
    if (this.commentCache.has(cacheKey)) {
      return this.commentCache.get(cacheKey);
    }

    const expectedCount = await this.getCommentCount(normalizedKey, resolvedSpace);
    const comments = [];
    const seenIds = new Set();
    let minId = null;

    while (true) {
      const query = {
        count: defaultPageSize,
        order: 'asc',
      };

      if (minId !== null) {
        query.minId = minId;
      }

      const batch = await fetchJson(resolvedSpace, `/api/v2/issues/${encodeURIComponent(normalizedKey)}/comments`, query);
      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }

      batch.forEach((comment) => {
        if (!seenIds.has(comment.id)) {
          seenIds.add(comment.id);
          comments.push(comment);
        }
      });

      if (batch.length < defaultPageSize) {
        break;
      }

      minId = batch[batch.length - 1].id + 1;
    }

    if (comments.length !== expectedCount) {
      throw new Error(`Comment count mismatch for ${normalizedKey}: expected ${expectedCount}, fetched ${comments.length}`);
    }

    this.commentCache.set(cacheKey, comments);
    return comments;
  }

  async getChildren(issue, space) {
    const resolvedSpace = space || this.spaceForIssue(issue);
    const cacheKey = `${resolvedSpace.name}:${normalizeTicketKey(issue.issueKey)}`;
    if (this.childrenCache.has(cacheKey)) {
      return this.childrenCache.get(cacheKey);
    }

    const children = [];
    let offset = 0;

    while (true) {
      const batch = await fetchJson(resolvedSpace, '/api/v2/issues', {
        'parentIssueId[]': issue.id,
        count: defaultPageSize,
        offset,
        order: 'asc',
        sort: 'created',
      });

      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }

      children.push(...batch);

      if (batch.length < defaultPageSize) {
        break;
      }

      offset += batch.length;
    }

    this.childrenCache.set(cacheKey, children);
    return children;
  }

  async getAttachments(issueKey, space) {
    const resolvedSpace = space || this.requireSpaceForKey(issueKey);
    const normalizedKey = normalizeTicketKey(issueKey);
    const cacheKey = `${resolvedSpace.name}:${normalizedKey}`;
    if (this.attachmentCache.has(cacheKey)) {
      return this.attachmentCache.get(cacheKey);
    }

    const attachments = await fetchJson(resolvedSpace, `/api/v2/issues/${encodeURIComponent(normalizedKey)}/attachments`);
    this.attachmentCache.set(cacheKey, attachments);
    return attachments;
  }

  async searchIssuesByKeyword(keyword, space) {
    const resolvedSpace = space || this.defaultSpace;
    if (!resolvedSpace) {
      return [];
    }

    const issues = [];
    let offset = 0;

    while (true) {
      const batch = await fetchJson(resolvedSpace, '/api/v2/issues', {
        keyword,
        count: defaultPageSize,
        offset,
        order: 'asc',
        sort: 'updated',
      });

      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }

      batch.forEach((issue) => {
        issue.__spaceName = resolvedSpace.name;
        issues.push(issue);
      });

      if (batch.length < defaultPageSize) {
        break;
      }

      offset += batch.length;
    }

    return issues;
  }

  async getHighestJpRootAncestor(issue, space) {
    const resolvedSpace = space || this.spaceForIssue(issue);
    let current = issue;
    let highestJpRoot = isJpRootTicket(current.issueKey) ? current : null;

    while (current.parentIssueId) {
      current = await this.getIssue(String(current.parentIssueId), resolvedSpace);
      if (isJpRootTicket(current.issueKey)) {
        highestJpRoot = current;
      }
    }

    return highestJpRoot;
  }

  async resolveRoot(inputTicketKey) {
    const inputSpace = this.forcedSpace || this.requireSpaceForKey(inputTicketKey);
    this.inputIssue = await this.getIssue(inputTicketKey, inputSpace);

    const directAncestor = await this.getHighestJpRootAncestor(this.inputIssue, inputSpace);
    if (directAncestor) {
      return directAncestor.issueKey;
    }

    const declaredOriginalKeys = extractDeclaredOriginalTicketKeys(this.inputIssue).filter(isJpRootTicket);
    if (declaredOriginalKeys.length > 0) {
      return declaredOriginalKeys[0];
    }

    const searchCandidates = await this.searchIssuesByKeyword(inputTicketKey, inputSpace);
    const scoredAncestors = [];

    for (const candidate of searchCandidates) {
      const candidateKey = normalizeTicketKey(candidate.issueKey);
      if (!isJpRootTicket(candidateKey)) {
        continue;
      }

      const text = `${candidate.summary || ''}\n${candidate.description || ''}`;
      const score =
        ((candidate.description || '').includes(inputTicketKey) ? 100 : 0) +
        ((candidate.summary || '').includes(inputTicketKey) ? 30 : 0) +
        (text.includes(inputTicketKey) ? 10 : 0);

      const highest = await this.getHighestJpRootAncestor(candidate);
      if (highest) {
        scoredAncestors.push({
          score,
          issueKey: highest.issueKey,
        });
      }
    }

    scoredAncestors.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.issueKey.localeCompare(right.issueKey);
    });

    if (scoredAncestors.length > 0) {
      return scoredAncestors[0].issueKey;
    }

    return normalizeTicketKey(this.inputIssue.issueKey);
  }

  getOrCreateNode(ticketKey) {
    const normalizedKey = normalizeTicketKey(ticketKey);
    if (!this.ticketGraph.has(normalizedKey)) {
      this.ticketGraph.set(normalizedKey, {
        issueKey: normalizedKey,
        reasons: new Set(),
        incomingFrom: new Set(),
        mentionedBy: new Set(),
        expansion: {
          walkParentChain: false,
          includeDirectParent: false,
          includeChildren: false,
          includeMentions: false,
        },
        parentIssueKey: null,
        childIssueKeys: new Set(),
        mentionedTicketKeys: new Set(),
        attachmentFiles: [],
        gyazoManifest: [],
      });
    }

    return this.ticketGraph.get(normalizedKey);
  }

  mergeExpansion(node, expansion) {
    if (!expansion) {
      return;
    }

    Object.keys(node.expansion).forEach((key) => {
      if (expansion[key]) {
        node.expansion[key] = true;
      }
    });
  }

  shouldIncludeChildTicket(childIssueKey, sourceIssueKey) {
    const normalizedChildKey = normalizeTicketKey(childIssueKey);
    const normalizedSourceKey = normalizeTicketKey(sourceIssueKey);
    const normalizedInputKey = normalizeTicketKey(this.options.ticket);

    if (normalizedChildKey === normalizedInputKey) {
      return true;
    }

    if (normalizedInputKey === this.resolvedRootKey) {
      return true;
    }

    if (normalizedSourceKey !== this.resolvedRootKey) {
      return true;
    }

    return false;
  }

  shouldIncludeMentionedTicket(mentionedTicketKey, sourceIssueKey) {
    const normalizedMentionedKey = normalizeTicketKey(mentionedTicketKey);
    const normalizedSourceKey = normalizeTicketKey(sourceIssueKey);
    const normalizedInputKey = normalizeTicketKey(this.options.ticket);

    if (normalizedMentionedKey === normalizedInputKey) {
      return true;
    }

    if (normalizedInputKey === this.resolvedRootKey) {
      return true;
    }

    if (normalizedSourceKey !== this.resolvedRootKey) {
      return true;
    }

    const rootNode = this.ticketGraph.get(this.resolvedRootKey);
    const declaredOriginals = rootNode && rootNode.issue ? extractDeclaredOriginalTicketKeys(rootNode.issue) : [];
    return declaredOriginals.includes(normalizedMentionedKey);
  }

  enqueue(ticketKey, reason, fromTicketKey = null, expansion = null) {
    const normalizedKey = normalizeTicketKey(ticketKey);
    if (!normalizedKey) {
      return;
    }

    if (this.ticketGraph.size >= this.options.maxTickets && !this.ticketGraph.has(normalizedKey)) {
      throw new Error(`Max ticket limit ${this.options.maxTickets} exceeded while expanding from ${fromTicketKey || this.resolvedRootKey}`);
    }

    const node = this.getOrCreateNode(normalizedKey);
    node.reasons.add(reason);
    this.mergeExpansion(node, expansion);

    if (fromTicketKey) {
      node.incomingFrom.add(normalizeTicketKey(fromTicketKey));
      if (reason === 'mentioned') {
        node.mentionedBy.add(normalizeTicketKey(fromTicketKey));
      }
    }

    if (!this.processed.has(normalizedKey) && !this.queue.includes(normalizedKey)) {
      this.queue.push(normalizedKey);
    }
  }

  async crawl() {
    this.resolvedRootKey = await this.resolveRoot(this.options.ticket);

    this.enqueue(this.resolvedRootKey, 'root', null, {
      includeChildren: true,
      includeMentions: true,
    });
    this.enqueue(this.options.ticket, 'input', null, {
      walkParentChain: true,
      includeChildren: true,
      includeMentions: true,
    });

    while (this.queue.length > 0) {
      const ticketKey = this.queue.shift();
      if (this.processed.has(ticketKey)) {
          continue;
      }

      const node = this.getOrCreateNode(ticketKey);

      // Route the ticket to its Backlog space by key prefix. Mentioned tickets
      // may point at a space with no configured prefix (e.g. a third project) —
      // record and skip rather than aborting the whole crawl.
      const space = this.spaceForKey(ticketKey);
      if (!space) {
        node.spaceName = null;
        node.error = `No Backlog space configured for prefix "${prefixOfKey(ticketKey) || '?'}"`;
        this.unresolvedTickets.add(ticketKey);
        this.processed.add(ticketKey);
        continue;
      }
      node.spaceName = space.name;

      const issue = await this.getIssue(ticketKey, space);
      const comments = await this.getComments(ticketKey, space);
      const children = await this.getChildren(issue, space);

      node.issue = issue;
      node.comments = comments;

      if (issue.parentIssueId) {
        const parentIssue = await this.getIssue(String(issue.parentIssueId), space);
        node.parentIssueKey = normalizeTicketKey(parentIssue.issueKey);
        if (node.expansion.walkParentChain) {
          this.enqueue(parentIssue.issueKey, 'parent', ticketKey, {
            walkParentChain: true,
          });
        } else if (node.expansion.includeDirectParent) {
          this.enqueue(parentIssue.issueKey, 'parent', ticketKey);
        }
      }

      if (node.expansion.includeChildren) {
        children.forEach((childIssue) => {
          const childKey = normalizeTicketKey(childIssue.issueKey);
          node.childIssueKeys.add(childKey);
          if (this.shouldIncludeChildTicket(childKey, ticketKey)) {
            this.enqueue(childKey, 'child', ticketKey);
          }
        });
      } else {
        children.forEach((childIssue) => {
          node.childIssueKeys.add(normalizeTicketKey(childIssue.issueKey));
        });
      }

      if (node.expansion.includeMentions) {
        const mentionedKeys = new Set(extractTicketKeys(issue.description));
        comments.forEach((comment) => {
          extractTicketKeys(comment.content).forEach((key) => mentionedKeys.add(key));
        });

        mentionedKeys.forEach((mentionedKey) => {
          if (mentionedKey === ticketKey) {
            return;
          }

          node.mentionedTicketKeys.add(mentionedKey);
          if (this.shouldIncludeMentionedTicket(mentionedKey, ticketKey)) {
            this.enqueue(mentionedKey, 'mentioned', ticketKey, {
              includeDirectParent: true,
              includeChildren: true,
            });
          }
        });
      }

      this.processed.add(ticketKey);
    }
  }

  resolveRootOutputDir(rootTicketKey) {
    if (this.options.outputDir) {
      return ensureAbsolute(this.options.outputDir);
    }

    const taskDir = path.join(projectRoot, 'tasks', rootTicketKey);
    const legacyTaskFile = path.join(projectRoot, 'tasks', `${rootTicketKey}.md`);

    if (fs.existsSync(legacyTaskFile) && fs.statSync(legacyTaskFile).isFile()) {
      fail(`Legacy task file detected at ${getRelativeProjectPath(legacyTaskFile)}. Migrate it to folder-based task storage before using the orchestrator.`);
    }

    return taskDir;
  }

  indexGyazoManifest(manifest) {
    if (!manifest || !Array.isArray(manifest.assets)) {
      return;
    }

    manifest.assets.forEach((asset) => {
      if (!asset || !asset.gyazoId || !asset.relativePath) {
        return;
      }

      const absolutePath = ensureAbsolute(asset.relativePath);
      if (!fs.existsSync(absolutePath)) {
        return;
      }

      this.gyazoIndex.set(asset.gyazoId, asset);
    });
  }

  buildExistingGyazoIndex() {
    this.gyazoIndex.clear();

    const legacyRootManifest = readJsonIfExists(path.join(this.rootOutputDir, 'gyazo', 'manifest.json'));
    this.indexGyazoManifest(legacyRootManifest);

    const ticketsDir = path.join(this.rootOutputDir, 'tickets');
    if (!fs.existsSync(ticketsDir)) {
      return;
    }

    fs.readdirSync(ticketsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .forEach((entry) => {
        const manifest = readJsonIfExists(path.join(ticketsDir, entry.name, 'gyazo', 'manifest.json'));
        this.indexGyazoManifest(manifest);
      });
  }

  buildReusedGyazoAssets(urls) {
    const reused = [];
    const missing = [];

    urls.forEach((url) => {
      const gyazoId = extractGyazoId(url);
      const indexed = gyazoId ? this.gyazoIndex.get(gyazoId) : null;

      if (indexed) {
        reused.push({
          ...indexed,
          originalUrl: url,
          pageUrl: indexed.pageUrl || `https://gyazo.com/${gyazoId}`,
          reusedFrom: indexed.relativePath,
        });
      } else {
        missing.push(url);
      }
    });

    return {
      reused,
      missing,
    };
  }

  writeGyazoArtifacts(gyazoDir, ticketKey, assets) {
    if (assets.length === 0) {
      return;
    }

    fs.mkdirSync(gyazoDir, { recursive: true });

    const manifest = {
      ticket: ticketKey,
      outputDir: getRelativeProjectPath(gyazoDir),
      generatedAt: new Date().toISOString(),
      assets,
    };

    writeJson(path.join(gyazoDir, 'manifest.json'), manifest);

    const lines = [
      '# Gyazo Assets',
      '',
      `Output directory: \`${getRelativeProjectPath(gyazoDir)}\``,
      '',
      ...assets.flatMap((asset) => [
        `- \`${asset.gyazoId}\` -> [@${asset.relativePath}]`,
        `  source: ${asset.originalUrl}`,
      ]),
      '',
    ];

    fs.writeFileSync(path.join(gyazoDir, 'prompt-assets.md'), `${lines.join('\n')}\n`, 'utf8');

    this.indexGyazoManifest(manifest);
  }

  async downloadAttachment(issueKey, attachment, assetsDir, space) {
    const resolvedSpace = space || this.requireSpaceForKey(issueKey);
    const safeName = sanitizeFileName(attachment.name);
    const targetPath = path.join(assetsDir, safeName);
    const { buffer, contentType } = await fetchBinary(
      resolvedSpace,
      `/api/v2/issues/${encodeURIComponent(issueKey)}/attachments/${attachment.id}`
    );
    fs.writeFileSync(targetPath, buffer);

    return {
      id: attachment.id,
      name: attachment.name,
      savedName: safeName,
      size: attachment.size,
      created: attachment.created,
      contentType,
      relativePath: getRelativeProjectPath(targetPath),
    };
  }

  rewriteAttachmentRefs(text, attachmentFiles) {
    let output = String(text || '');
    const byOriginalName = new Map(
      attachmentFiles.map((attachmentFile) => [attachmentFile.name, attachmentFile])
    );

    byOriginalName.forEach((attachmentFile, originalName) => {
      const escapedName = originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const markdownReferenceImagePattern = new RegExp(`!\\[([^\\]]*)\\]\\[${escapedName}\\]`, 'g');
      output = output.replace(
        markdownReferenceImagePattern,
        () => `[@${attachmentFile.relativePath}]`
      );
    });

    return output;
  }

  annotateGyazoRefs(text, manifestEntries) {
    let output = String(text || '');
    manifestEntries.forEach((entry) => {
      const escaped = entry.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(escaped, 'g');
      output = output.replace(pattern, `[@${entry.relativePath}]`);
    });
    return output;
  }

  extractCommentAttachmentNames(comment) {
    const names = [];
    if (!Array.isArray(comment.changeLog)) {
      return names;
    }

    comment.changeLog.forEach((change) => {
      if (change.field === 'attachment' && change.attachmentInfo && change.attachmentInfo.name) {
        names.push(change.attachmentInfo.name);
      }
    });

    return dedupeStrings(names);
  }

  renderIssueMarkdown(node) {
    const { issue, comments, attachmentFiles, gyazoManifest } = node;
    const attachmentByName = new Map(attachmentFiles.map((attachment) => [attachment.name, attachment]));
    let description = this.rewriteAttachmentRefs(issue.description || '', attachmentFiles);
    description = this.annotateGyazoRefs(description, gyazoManifest);

    const lines = [
      `# ${issue.issueKey} — ${issue.summary}`,
      '',
      `- Family: \`${familyOfTicket(issue.issueKey)}\``,
      `- Status: \`${issue.status ? issue.status.name : 'Unknown'}\``,
      `- Parent: ${node.parentIssueKey ? `\`${node.parentIssueKey}\`` : 'None'}`,
      `- Children: ${node.childIssueKeys.size > 0 ? Array.from(node.childIssueKeys).map((key) => `\`${key}\``).join(', ') : 'None'}`,
      `- Mentioned tickets: ${node.mentionedTicketKeys.size > 0 ? Array.from(node.mentionedTicketKeys).map((key) => `\`${key}\``).join(', ') : 'None'}`,
      `- Source file: \`${getRelativeProjectPath(path.join(this.rootOutputDir, 'tickets', issue.issueKey, 'issue.json'))}\``,
      '',
      '## Description',
      '',
      description || '_No description_',
      '',
      '## Issue Attachments',
      '',
    ];

    if (attachmentFiles.length === 0) {
      lines.push('_No attachments_');
    } else {
      attachmentFiles.forEach((attachmentFile) => {
        lines.push(`- \`${attachmentFile.name}\` -> [@${attachmentFile.relativePath}]`);
      });
    }

    lines.push('', `## Comments (${comments.length})`, '');

    if (comments.length === 0) {
      lines.push('_No comments_');
    } else {
      comments.forEach((comment) => {
        const commentAttachments = this.extractCommentAttachmentNames(comment)
          .map((name) => attachmentByName.get(name))
          .filter(Boolean);
        let content = this.rewriteAttachmentRefs(comment.content || '', attachmentFiles);
        content = this.annotateGyazoRefs(content, gyazoManifest);

        lines.push(`### Comment ${comment.id}`);
        lines.push('');
        lines.push(`- Created: \`${comment.created}\``);
        lines.push(`- User: ${comment.createdUser ? comment.createdUser.name : 'Unknown'}`);
        lines.push('');
        lines.push(content || '_No text content_');
        lines.push('');

        if (commentAttachments.length > 0) {
          lines.push('Attachments added in this comment:');
          commentAttachments.forEach((attachmentFile) => {
            lines.push(`- \`${attachmentFile.name}\` -> [@${attachmentFile.relativePath}]`);
          });
          lines.push('');
        }

        if (Array.isArray(comment.changeLog) && comment.changeLog.length > 0) {
          const nonAttachmentChanges = comment.changeLog.filter((change) => change.field !== 'attachment');
          if (nonAttachmentChanges.length > 0) {
            lines.push('Change log:');
            nonAttachmentChanges.forEach((change) => {
              const originalValue = this.annotateGyazoRefs(change.originalValue || '', gyazoManifest) || '(empty)';
              const newValue = this.annotateGyazoRefs(change.newValue || '', gyazoManifest) || '(empty)';
              lines.push(`- ${change.field}: ${originalValue} -> ${newValue}`);
            });
            lines.push('');
          }
        }
      });
    }

    return `${lines.join('\n')}\n`;
  }

  async materializePerTicketFiles() {
    this.rootOutputDir = this.resolveRootOutputDir(this.resolvedRootKey);
    fs.mkdirSync(this.rootOutputDir, { recursive: true });
    fs.mkdirSync(path.join(this.rootOutputDir, 'tickets'), { recursive: true });
    this.buildExistingGyazoIndex();

    const ticketKeys = sortTickets(Array.from(this.ticketGraph.keys()), this.resolvedRootKey);

    for (const ticketKey of ticketKeys) {
      const node = this.ticketGraph.get(ticketKey);
      // Skip tickets that could not be routed to a configured space.
      if (!node.issue) {
        continue;
      }
      const space = this.spaceForKey(ticketKey);
      const ticketDir = path.join(this.rootOutputDir, 'tickets', ticketKey);
      const assetsDir = path.join(ticketDir, 'assets');
      const gyazoDir = path.join(ticketDir, 'gyazo');
      fs.mkdirSync(assetsDir, { recursive: true });

      const issue = node.issue;
      const comments = node.comments;
      const attachments = await this.getAttachments(ticketKey, space);
      const attachmentFiles = [];

      for (const attachment of attachments) {
        const downloaded = await this.downloadAttachment(ticketKey, attachment, assetsDir, space);
        attachmentFiles.push(downloaded);
      }

      node.attachmentFiles = attachmentFiles;

      writeJson(path.join(ticketDir, 'issue.json'), issue);
      writeJson(path.join(ticketDir, 'comments.json'), comments);

      const gyazoTexts = [issue.description || ''];
      comments.forEach((comment) => {
        if (comment.content) {
          gyazoTexts.push(comment.content);
        }
      });
      const gyazoUrls = dedupeStrings(gyazoTexts.flatMap((text) => extractGyazoUrls(text)));
      const { reused: reusedGyazoAssets, missing: missingGyazoUrls } = this.buildReusedGyazoAssets(gyazoUrls);

      if (missingGyazoUrls.length > 0) {
        const gyazoScript = path.join(projectRoot, '.external-assets', 'gyazo', 'materialize-gyazo-assets.js');
        const args = [gyazoScript, '--output-dir', gyazoDir];
        missingGyazoUrls.forEach((url) => {
          args.push('--url', url);
        });
        execFileSync(process.execPath, args, {
          cwd: projectRoot,
          stdio: 'pipe',
        });
      }

      const gyazoManifestPath = path.join(gyazoDir, 'manifest.json');
      let combinedGyazoAssets = [...reusedGyazoAssets];
      if (fs.existsSync(gyazoManifestPath)) {
        const gyazoManifest = readJsonIfExists(gyazoManifestPath);
        if (gyazoManifest && Array.isArray(gyazoManifest.assets)) {
          combinedGyazoAssets = [...combinedGyazoAssets, ...gyazoManifest.assets];
        }
      }
      combinedGyazoAssets = dedupeStrings(combinedGyazoAssets.map((asset) => JSON.stringify(asset))).map((value) => JSON.parse(value));
      this.writeGyazoArtifacts(gyazoDir, ticketKey, combinedGyazoAssets);
      node.gyazoManifest = combinedGyazoAssets;

      const renderedMd = this.renderIssueMarkdown(node);
      fs.writeFileSync(path.join(ticketDir, 'rendered.md'), renderedMd, 'utf8');
    }
  }

  buildSourceMap() {
    const ticketEntries = sortTickets(Array.from(this.ticketGraph.keys()), this.resolvedRootKey).map((ticketKey) => {
      const node = this.ticketGraph.get(ticketKey);
      return {
        issueKey: ticketKey,
        space: node.spaceName || null,
        unresolved: node.issue ? undefined : (node.error || true),
        family: familyOfTicket(ticketKey),
        summary: node.issue ? node.issue.summary : null,
        status: node.issue && node.issue.status ? node.issue.status.name : null,
        reasons: Array.from(node.reasons).sort(),
        incomingFrom: Array.from(node.incomingFrom).sort(),
        mentionedBy: Array.from(node.mentionedBy).sort(),
        parentIssueKey: node.parentIssueKey,
        childIssueKeys: Array.from(node.childIssueKeys).sort(),
        mentionedTicketKeys: Array.from(node.mentionedTicketKeys).sort(),
        files: {
          issue: getRelativeProjectPath(path.join(this.rootOutputDir, 'tickets', ticketKey, 'issue.json')),
          comments: getRelativeProjectPath(path.join(this.rootOutputDir, 'tickets', ticketKey, 'comments.json')),
          rendered: getRelativeProjectPath(path.join(this.rootOutputDir, 'tickets', ticketKey, 'rendered.md')),
          assetsDir: getRelativeProjectPath(path.join(this.rootOutputDir, 'tickets', ticketKey, 'assets')),
          gyazoDir: getRelativeProjectPath(path.join(this.rootOutputDir, 'tickets', ticketKey, 'gyazo')),
        },
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      inputTicket: this.options.ticket,
      resolvedRootTicket: this.resolvedRootKey,
      outputDir: getRelativeProjectPath(this.rootOutputDir),
      backlogConfigSources: this.sources,
      spaces: this.spaces.map((space) => ({
        name: space.name,
        domain: space.domain,
        prefixes: space.prefixes,
        isRoot: space.isRoot,
      })),
      unresolvedTickets: Array.from(this.unresolvedTickets).sort(),
      tickets: ticketEntries,
    };
  }

  buildBacklogContextMarkdown() {
    const rootNode = this.ticketGraph.get(this.resolvedRootKey);
    const ticketKeys = sortTickets(Array.from(this.ticketGraph.keys()), this.resolvedRootKey);
    const sourceOfTruthKeys = ticketKeys.filter((ticketKey) => isJpRootTicket(ticketKey));
    const childKeys = ticketKeys.filter((ticketKey) => {
      const node = this.ticketGraph.get(ticketKey);
      return node.parentIssueKey === this.resolvedRootKey;
    });
    const mentionedOnlyKeys = ticketKeys.filter((ticketKey) => {
      const node = this.ticketGraph.get(ticketKey);
      return node.reasons.has('mentioned') && !node.reasons.has('child') && !node.reasons.has('root');
    });

    const lines = [
      `# ${this.resolvedRootKey} Backlog Context`,
      '',
      '## Resolution',
      '',
      `- Input ticket: \`${this.options.ticket}\``,
      `- Resolved root ticket: \`${this.resolvedRootKey}\``,
      `- Root summary: ${rootNode.issue.summary}`,
      `- Output directory: \`${getRelativeProjectPath(this.rootOutputDir)}\``,
      `- Ticket count captured: ${ticketKeys.length}`,
      '',
      '## Source of Truth Tickets',
      '',
    ];

    if (sourceOfTruthKeys.length === 0) {
      lines.push('- No client / source-of-truth ticket was captured in this context.');
    } else {
      sourceOfTruthKeys.forEach((ticketKey) => {
        const node = this.ticketGraph.get(ticketKey);
        lines.push(`- \`${ticketKey}\` — ${node.issue ? node.issue.summary : '(unresolved)'}`);
      });
    }

    lines.push('', '## Root Ticket', '');
    lines.push(`- \`${this.resolvedRootKey}\` — ${rootNode.issue.summary}`);
    lines.push(`- Status: \`${rootNode.issue.status ? rootNode.issue.status.name : 'Unknown'}\``);
    lines.push(`- Description excerpt: ${summarizeText(this.annotateGyazoRefs(rootNode.issue.description || '', rootNode.gyazoManifest), 420) || '(empty)'}`);
    lines.push(`- Rendered source: \`${getRelativeProjectPath(path.join(this.rootOutputDir, 'tickets', this.resolvedRootKey, 'rendered.md'))}\``);
    lines.push('');
    lines.push('## Child Tickets Under Root', '');

    if (childKeys.length === 0) {
      lines.push('- No direct child tickets captured under the root.');
    } else {
      childKeys.forEach((ticketKey) => {
        const node = this.ticketGraph.get(ticketKey);
        lines.push(`- \`${ticketKey}\` — ${node.issue ? node.issue.summary : '(unresolved)'}`);
        lines.push(`  reasons: ${Array.from(node.reasons).sort().join(', ')}`);
        lines.push(`  rendered: ${getRelativeProjectPath(path.join(this.rootOutputDir, 'tickets', ticketKey, 'rendered.md'))}`);
      });
    }

    lines.push('', '## Mentioned Related Tickets', '');

    if (mentionedOnlyKeys.length === 0) {
      lines.push('- No additional mentioned tickets captured outside the root/child chain.');
    } else {
      mentionedOnlyKeys.forEach((ticketKey) => {
        const node = this.ticketGraph.get(ticketKey);
        lines.push(`- \`${ticketKey}\` — ${node.issue ? node.issue.summary : '(unresolved)'}`);
        lines.push(`  mentioned by: ${Array.from(node.mentionedBy).sort().join(', ') || '(unknown)'}`);
        lines.push(`  rendered: ${getRelativeProjectPath(path.join(this.rootOutputDir, 'tickets', ticketKey, 'rendered.md'))}`);
      });
    }

    lines.push('', '## Captured Tickets', '');

    ticketKeys.forEach((ticketKey) => {
      const node = this.ticketGraph.get(ticketKey);
      lines.push(`### ${ticketKey}`);
      lines.push('');
      if (!node.issue) {
        lines.push(`- Unresolved: ${node.error || 'no Backlog space configured for this ticket prefix'}`);
        lines.push(`- Referenced by: ${Array.from(node.incomingFrom).sort().join(', ') || '(input)'}`);
        lines.push('');
        return;
      }
      lines.push(`- Summary: ${node.issue.summary}`);
      lines.push(`- Space: \`${node.spaceName || '?'}\``);
      lines.push(`- Family: \`${familyOfTicket(ticketKey)}\``);
      lines.push(`- Status: \`${node.issue.status ? node.issue.status.name : 'Unknown'}\``);
      lines.push(`- Reasons: ${Array.from(node.reasons).sort().join(', ')}`);
      lines.push(`- Parent: ${node.parentIssueKey ? `\`${node.parentIssueKey}\`` : 'None'}`);
      lines.push(`- Children: ${node.childIssueKeys.size > 0 ? Array.from(node.childIssueKeys).sort().map((key) => `\`${key}\``).join(', ') : 'None'}`);
      lines.push(`- Mentioned tickets: ${node.mentionedTicketKeys.size > 0 ? Array.from(node.mentionedTicketKeys).sort().map((key) => `\`${key}\``).join(', ') : 'None'}`);
      lines.push(`- Comment count: ${node.comments.length}`);
      lines.push(`- Attachment count: ${node.attachmentFiles.length}`);
      lines.push(`- Gyazo count: ${node.gyazoManifest.length}`);
      lines.push(`- Description excerpt: ${summarizeText(this.annotateGyazoRefs(node.issue.description || '', node.gyazoManifest), 240) || '(empty)'}`);
      lines.push(`- Rendered source: \`${getRelativeProjectPath(path.join(this.rootOutputDir, 'tickets', ticketKey, 'rendered.md'))}\``);
      lines.push('');
    });

    lines.push('## Notes', '');
    lines.push('- Comment retrieval uses Backlog REST API with count verification, not Backlog MCP.');
    lines.push('- Public Gyazo links are materialized into per-ticket `gyazo/` folders.');
    lines.push('- Existing Gyazo assets under the same root task bundle are reused when duplicate URLs appear across related tickets.');
    lines.push('- Internal Backlog attachments are downloaded into per-ticket `assets/` folders.');

    return `${lines.join('\n')}\n`;
  }

  async run() {
    await this.crawl();
    await this.materializePerTicketFiles();

    const sourceMap = this.buildSourceMap();
    writeJson(path.join(this.rootOutputDir, 'source-map.json'), sourceMap);
    fs.writeFileSync(
      path.join(this.rootOutputDir, 'backlog-context.md'),
      this.buildBacklogContextMarkdown(),
      'utf8'
    );

    return {
      inputTicket: this.options.ticket,
      resolvedRootTicket: this.resolvedRootKey,
      outputDir: getRelativeProjectPath(this.rootOutputDir),
      ticketCount: this.ticketGraph.size,
    };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const spacesConfig = loadBacklogSpaces();
  const orchestrator = new BacklogContextOrchestrator(spacesConfig, options);
  const result = await orchestrator.run();

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}

module.exports = {
  loadBacklogSpaces,
  BacklogContextOrchestrator,
  fetchJson,
  fetchBinary,
  prefixOfKey,
  normalizeTicketKey,
  isJpRootTicket,
  familyOfTicket,
};
