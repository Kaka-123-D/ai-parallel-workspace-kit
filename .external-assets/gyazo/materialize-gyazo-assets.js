#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const process = require('process');

const projectRoot = path.resolve(__dirname, '..', '..');
const gyazoIdPattern = /^[a-f0-9]{32}$/i;
const mimeToExtension = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

function printHelp() {
  console.log(`
Materialize public Gyazo assets into a task-local folder.

Usage:
  node .external-assets/gyazo/materialize-gyazo-assets.js --ticket <ROOT_TICKET> --url <GYAZO_URL>
  node .external-assets/gyazo/materialize-gyazo-assets.js --ticket <ROOT_TICKET> --url <URL1> --url <URL2>
  node .external-assets/gyazo/materialize-gyazo-assets.js --ticket <ROOT_TICKET> --file tasks/<ROOT_TICKET>/index.md
  cat backlog.md | node .external-assets/gyazo/materialize-gyazo-assets.js --ticket <ROOT_TICKET> --stdin

Options:
  --ticket <id>        Ticket id used to resolve the default output directory.
  --output-dir <path>  Override the output directory.
  --url <url>          A public Gyazo permalink or i.gyazo asset URL. Repeatable.
  --file <path>        Read text from a file and extract Gyazo URLs. Repeatable.
  --text <text>        Inline text to scan for Gyazo URLs. Repeatable.
  --stdin              Read text from stdin and extract Gyazo URLs.
  --dry-run            Resolve output paths and extracted URLs without downloading.
  --help               Show this help.

Generated files:
  - <output-dir>/<gyazo-id>.<ext>
  - <output-dir>/manifest.json
  - <output-dir>/prompt-assets.md
  - <output-dir>/prompt-with-local-refs.md (when text input is provided)
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

function parseArgs(argv) {
  const options = {
    urls: [],
    files: [],
    texts: [],
    stdin: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--stdin') {
      options.stdin = true;
      continue;
    }

    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (argument === '--ticket' || argument === '--output-dir' || argument === '--url' || argument === '--file' || argument === '--text') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        fail(`Missing value for ${argument}.`);
      }

      index += 1;

      if (argument === '--ticket') {
        options.ticket = value;
      } else if (argument === '--output-dir') {
        options.outputDir = value;
      } else if (argument === '--url') {
        options.urls.push(value);
      } else if (argument === '--file') {
        options.files.push(value);
      } else if (argument === '--text') {
        options.texts.push(value);
      }

      continue;
    }

    fail(`Unknown argument: ${argument}`);
  }

  return options;
}

function resolveOutputDir(ticket, explicitOutputDir) {
  if (explicitOutputDir) {
    return ensureAbsolute(explicitOutputDir);
  }

  if (!ticket) {
    fail('Provide --ticket or --output-dir.');
  }

  const taskDirectory = path.join(projectRoot, 'tasks', ticket);
  const taskFile = path.join(projectRoot, 'tasks', `${ticket}.md`);

  if (fs.existsSync(taskDirectory) && fs.statSync(taskDirectory).isDirectory()) {
    return path.join(taskDirectory, 'gyazo');
  }

  if (fs.existsSync(taskFile) && fs.statSync(taskFile).isFile()) {
    fail(`Legacy task file detected at ${getRelativeProjectPath(taskFile)}. Migrate it to tasks/${ticket}/index.md before using the default Gyazo output.`);
  }

  return path.join(taskDirectory, 'gyazo');
}

function extractGyazoUrls(text) {
  const matches = text.match(/https?:\/\/(?:www\.)?(?:gyazo\.com|i\.gyazo\.com)\/[^\s<>"')\]]+/gi);
  return matches ? matches.map((match) => match.replace(/[;,.]+$/g, '')) : [];
}

function normalizeGyazoUrl(inputUrl) {
  const cleanedInputUrl = String(inputUrl).trim().replace(/[;,.]+$/g, '');
  let parsedUrl;

  try {
    parsedUrl = new URL(cleanedInputUrl);
  } catch (error) {
    throw new Error(`Invalid URL: ${inputUrl}`);
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
  const pathname = parsedUrl.pathname.replace(/\/+$/, '');

  if (hostname === 'i.gyazo.com') {
    const fileName = pathname.split('/').filter(Boolean).pop() || '';
    const match = fileName.match(/([a-f0-9]{32})/i);

    if (!match) {
      throw new Error(`Could not extract Gyazo id from asset URL: ${inputUrl}`);
    }

    const id = match[1].toLowerCase();
    return {
      id,
      pageUrl: `https://gyazo.com/${id}`,
      originalUrl: cleanedInputUrl,
    };
  }

  if (hostname === 'gyazo.com') {
    const segments = pathname.split('/').filter(Boolean);
    const id = segments.find((segment) => gyazoIdPattern.test(segment));

    if (!id) {
      throw new Error(`Could not extract Gyazo id from page URL: ${inputUrl}`);
    }

    return {
      id: id.toLowerCase(),
      pageUrl: `https://gyazo.com/${id.toLowerCase()}`,
      originalUrl: cleanedInputUrl,
    };
  }

  throw new Error(`Unsupported host for Gyazo materialization: ${inputUrl}`);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Backlog Gyazo Asset Materializer',
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Backlog Gyazo Asset Materializer',
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function extractMetaContent(html, attribute, name) {
  const pattern = new RegExp(`<meta[^>]+${attribute}=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
  const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${name}["']`, 'i');

  const directMatch = html.match(pattern);
  if (directMatch) {
    return directMatch[1];
  }

  const reverseMatch = html.match(reversePattern);
  return reverseMatch ? reverseMatch[1] : null;
}

function inferExtensionFromUrl(assetUrl) {
  const pathname = new URL(assetUrl).pathname;
  const extension = path.extname(pathname).replace('.', '').toLowerCase();
  return extension || null;
}

function inferExtensionFromMime(mimeType) {
  return mimeToExtension[mimeType.toLowerCase()] || null;
}

async function resolveAssetUrl(entry) {
  const oembedUrl = `https://api.gyazo.com/api/oembed?url=${encodeURIComponent(entry.pageUrl)}`;

  try {
    const payload = await fetchJson(oembedUrl);
    if (payload && payload.url) {
      return {
        assetUrl: payload.url,
        title: payload.title || null,
        providerType: payload.type || null,
        source: 'oembed',
      };
    }
  } catch (error) {
    // Best-effort fallback to page metadata below.
  }

  const html = await fetchText(entry.pageUrl);
  const videoUrl =
    extractMetaContent(html, 'property', 'og:video:secure_url') ||
    extractMetaContent(html, 'property', 'og:video') ||
    extractMetaContent(html, 'name', 'twitter:player:stream');

  if (videoUrl) {
    return {
      assetUrl: videoUrl,
      title: extractMetaContent(html, 'property', 'og:title') || null,
      providerType: 'video',
      source: 'meta:video',
    };
  }

  const imageUrl =
    extractMetaContent(html, 'property', 'og:image:secure_url') ||
    extractMetaContent(html, 'property', 'og:image') ||
    extractMetaContent(html, 'name', 'twitter:image');

  if (imageUrl) {
    return {
      assetUrl: imageUrl,
      title: extractMetaContent(html, 'property', 'og:title') || null,
      providerType: 'photo',
      source: 'meta:image',
    };
  }

  throw new Error(`Could not resolve a downloadable asset from ${entry.pageUrl}`);
}

async function downloadAsset(assetUrl, targetPath) {
  const response = await fetch(assetUrl, {
    headers: {
      'user-agent': 'Backlog Gyazo Asset Materializer',
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed with ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));

  return response.headers.get('content-type') || 'application/octet-stream';
}

function annotatePromptText(promptText, manifestEntries) {
  let result = promptText;

  manifestEntries.forEach((entry) => {
    const escaped = entry.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'g');
    result = result.replace(pattern, `[@${entry.relativePath}]`);
  });

  return result;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function dedupeNormalizedEntries(entries) {
  const seenIds = new Set();
  return entries.filter((entry) => {
    if (seenIds.has(entry.id)) {
      return false;
    }

    seenIds.add(entry.id);
    return true;
  });
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let output = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      output += chunk;
    });
    process.stdin.on('end', () => resolve(output));
    process.stdin.on('error', reject);
  });
}

async function gatherInputs(options) {
  const promptSegments = [];

  options.texts.forEach((text) => {
    promptSegments.push(text);
  });

  options.files.forEach((filePath) => {
    const absolutePath = ensureAbsolute(filePath);
    const fileContent = fs.readFileSync(absolutePath, 'utf8');
    promptSegments.push(fileContent);
  });

  if (options.stdin) {
    const stdinContent = await readStdin();
    if (stdinContent.trim()) {
      promptSegments.push(stdinContent);
    }
  }

  const promptText = promptSegments.join('\n\n').trim();
  const extractedUrls = promptSegments.flatMap((text) => extractGyazoUrls(text));
  const allUrls = [...options.urls, ...extractedUrls];
  const uniqueUrls = Array.from(new Set(allUrls));

  if (uniqueUrls.length === 0) {
    fail('No Gyazo URLs were provided or extracted.');
  }

  return {
    promptText,
    urls: uniqueUrls,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const outputDir = resolveOutputDir(options.ticket, options.outputDir);
  const { promptText, urls } = await gatherInputs(options);
  const normalizedEntries = dedupeNormalizedEntries(urls.map((url) => normalizeGyazoUrl(url)));

  if (options.dryRun) {
    const summary = normalizedEntries.map((entry) => ({
      gyazoId: entry.id,
      originalUrl: entry.originalUrl,
      pageUrl: entry.pageUrl,
      outputDir: getRelativeProjectPath(outputDir),
    }));

    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const manifestEntries = [];

  for (const entry of normalizedEntries) {
    console.log(`Resolving ${entry.pageUrl}`);
    const resolved = await resolveAssetUrl(entry);

    const provisionalExtension = inferExtensionFromUrl(resolved.assetUrl);
    const provisionalTargetPath = path.join(outputDir, `${entry.id}.${provisionalExtension || 'bin'}`);
    const mimeType = await downloadAsset(resolved.assetUrl, provisionalTargetPath);
    const finalExtension = provisionalExtension || inferExtensionFromMime(mimeType) || 'bin';
    const finalTargetPath = path.join(outputDir, `${entry.id}.${finalExtension}`);

    if (provisionalTargetPath !== finalTargetPath) {
      fs.renameSync(provisionalTargetPath, finalTargetPath);
    }

    const relativePath = getRelativeProjectPath(finalTargetPath);
    manifestEntries.push({
      gyazoId: entry.id,
      originalUrl: entry.originalUrl,
      pageUrl: entry.pageUrl,
      assetUrl: resolved.assetUrl,
      relativePath,
      fileName: path.basename(finalTargetPath),
      extension: finalExtension,
      mimeType,
      providerType: resolved.providerType,
      resolutionSource: resolved.source,
      title: resolved.title,
      downloadedAt: new Date().toISOString(),
    });

    console.log(`Saved ${relativePath}`);
  }

  const manifest = {
    ticket: options.ticket || null,
    outputDir: getRelativeProjectPath(outputDir),
    generatedAt: new Date().toISOString(),
    assets: manifestEntries,
  };

  writeJson(path.join(outputDir, 'manifest.json'), manifest);

  const assetLines = [
    '# Gyazo Assets',
    '',
    `Output directory: \`${getRelativeProjectPath(outputDir)}\``,
    '',
    ...manifestEntries.flatMap((entry) => [
      `- \`${entry.gyazoId}\` -> [@${entry.relativePath}]`,
      `  source: ${entry.originalUrl}`,
    ]),
    '',
  ];
  fs.writeFileSync(path.join(outputDir, 'prompt-assets.md'), `${assetLines.join('\n')}\n`, 'utf8');

  if (promptText) {
    const annotatedPrompt = annotatePromptText(promptText, manifestEntries);
    fs.writeFileSync(path.join(outputDir, 'prompt-with-local-refs.md'), `${annotatedPrompt}\n`, 'utf8');
  }

  console.log(`Done. Generated ${manifestEntries.length} asset(s) in ${getRelativeProjectPath(outputDir)}.`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
