#!/usr/bin/env node

import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repoRoot, "upstream", "microsoft-foundry");
const outputRoot = path.join(
  repoRoot,
  "appPackage",
  "skills",
  "microsoft-foundry",
);
const supportedExtensions = new Set([".md", ".py", ".sh"]);

async function walk(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.posix.join(prefix, entry.name);
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function flattenDeepPath(relativePath) {
  const parsed = path.posix.parse(relativePath);
  const directories = parsed.dir ? parsed.dir.split("/") : [];

  if (directories.length <= 3) {
    return relativePath;
  }

  const flattenedName = [...directories.slice(3), parsed.base].join("--");
  return path.posix.join(...directories.slice(0, 3), flattenedName);
}

function outputPathFor(relativePath) {
  if (relativePath === ".gitignore") {
    return undefined;
  }

  const parsed = path.posix.parse(relativePath);
  let outputPath = relativePath;

  if (parsed.base === "SKILL.md" && relativePath !== "SKILL.md") {
    const parentName = path.posix.basename(parsed.dir);
    outputPath = path.posix.join(parsed.dir, `${parentName}-skill.md`);
  } else if (!supportedExtensions.has(parsed.ext.toLowerCase())) {
    outputPath = `${relativePath}.md`;
  }

  return flattenDeepPath(outputPath);
}

function splitTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  const titleMatch = trimmed.match(/^(\S+)(\s+["'][^"']*["'])$/);

  if (titleMatch) {
    return { target: titleMatch[1], title: titleMatch[2] };
  }

  return { target: trimmed, title: "" };
}

function rewriteMarkdownLinks(content, sourcePath, outputPath, outputMap) {
  return content.replace(
    /(!?\[[^\]]*\]\()([^)]+)(\))/g,
    (match, prefix, rawTarget, suffix) => {
      const { target, title } = splitTarget(rawTarget);

      if (
        !target ||
        target.startsWith("#") ||
        target.startsWith("/") ||
        /^[a-z][a-z0-9+.-]*:/i.test(target)
      ) {
        return match;
      }

      const hashIndex = target.indexOf("#");
      const targetPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
      const anchor = hashIndex === -1 ? "" : target.slice(hashIndex);
      const resolvedSourcePath = path.posix.normalize(
        path.posix.join(path.posix.dirname(sourcePath), targetPath),
      );
      const resolvedOutputPath = outputMap.get(resolvedSourcePath);

      if (!resolvedOutputPath) {
        return match;
      }

      let rewrittenTarget = path.posix.relative(
        path.posix.dirname(outputPath),
        resolvedOutputPath,
      );
      if (!rewrittenTarget.startsWith(".")) {
        rewrittenTarget = `./${rewrittenTarget}`;
      }

      return `${prefix}${rewrittenTarget}${anchor}${title}${suffix}`;
    },
  );
}

function rewriteMovedPaths(content, sourcePath, outputPath, outputMap) {
  const replacements = [];

  for (const [targetSourcePath, targetOutputPath] of outputMap) {
    const extension = path.posix.extname(targetSourcePath).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      continue;
    }

    const originalRelativePath = path.posix.relative(
      path.posix.dirname(sourcePath),
      targetSourcePath,
    );
    const outputRelativePath = path.posix.relative(
      path.posix.dirname(outputPath),
      targetOutputPath,
    );
    const isRenamedSelfReference =
      targetSourcePath === sourcePath &&
      path.posix.basename(targetSourcePath) !==
        path.posix.basename(targetOutputPath);

    if (
      originalRelativePath === outputRelativePath ||
      (!originalRelativePath.includes("/") &&
        !originalRelativePath.startsWith(".") &&
        !isRenamedSelfReference)
    ) {
      continue;
    }

    replacements.push([originalRelativePath, outputRelativePath]);
  }

  replacements.sort(([left], [right]) => right.length - left.length);
  for (const [originalPath, replacementPath] of replacements) {
    content = content.split(originalPath).join(replacementPath);
  }

  return content;
}

function wrapUnsupportedFile(relativePath, content) {
  const extension = path.posix.extname(relativePath).slice(1);
  const language = extension === "ps1" ? "powershell" : extension;

  return [
    `# Source: ${relativePath}`,
    "",
    `This upstream \`.${extension}\` file is included as documentation because`,
    "Microsoft 365 Copilot skill packages do not support this file extension.",
    "",
    `\`\`\`${language}`,
    content.trimEnd(),
    "```",
    "",
  ].join("\n");
}

function splitRootSkill(content) {
  const sectionStart = "## Agent: Common Project Context Resolution";
  const nextSection = "## Agent: Agent Types";
  const startIndex = content.indexOf(sectionStart);
  const endIndex = content.indexOf(nextSection);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error("Unable to locate the root skill context-resolution section");
  }

  const referenceContent = content.slice(startIndex, endIndex).trimEnd();
  const replacement = [
    sectionStart,
    "",
    "Before an agent workflow needs unresolved project or environment values,",
    "read [Common Project Context Resolution](references/common-project-context-resolution.md).",
    "",
  ].join("\n");

  return {
    rootContent: `${content.slice(0, startIndex)}${replacement}${content.slice(endIndex)}`,
    referenceContent: `${referenceContent}\n`,
  };
}

function adaptRootSkillForCowork(content) {
  const dependencyStart = "### Dependency Check and Setup";
  const dependencyEnd = "### Workflow Guidance";
  const dependencyStartIndex = content.indexOf(dependencyStart);
  const dependencyEndIndex = content.indexOf(dependencyEnd);

  if (
    dependencyStartIndex === -1 ||
    dependencyEndIndex === -1 ||
    dependencyEndIndex <= dependencyStartIndex
  ) {
    throw new Error("Unable to locate the root skill dependency section");
  }

  const dependencyReplacement = [
    dependencyStart,
    "",
    "The upstream dependency script applies only to workflows that execute local",
    "`azd`, Azure CLI, Python, or shell commands. In Microsoft 365 Cowork, do not",
    "search for or run dependency scripts before connector-only operations such as",
    "listing Foundry agents.",
    "",
    "For a local command workflow, run the appropriate script before continuing:",
    "",
    "```bash",
    "./scripts/check-and-setup-dependencies.sh     # macOS / Linux",
    "./scripts/check-and-setup-dependencies.ps1    # Windows (pwsh)",
    "```",
    "",
    "",
  ].join("\n");

  content = `${content.slice(0, dependencyStartIndex)}${dependencyReplacement}${content.slice(dependencyEndIndex)}`;

  const foundryMcpStart = "### Foundry MCP";
  const foundryMcpEnd = "### azd";
  const foundryMcpStartIndex = content.indexOf(foundryMcpStart);
  const foundryMcpEndIndex = content.indexOf(foundryMcpEnd);

  if (
    foundryMcpStartIndex === -1 ||
    foundryMcpEndIndex === -1 ||
    foundryMcpEndIndex <= foundryMcpStartIndex
  ) {
    throw new Error("Unable to locate the root skill Foundry MCP section");
  }

  const foundryMcpReplacement = [
    foundryMcpStart,
    "",
    "In Microsoft 365 Cowork, use the bundled **Microsoft Foundry MCP** agent",
    "connector as the Foundry tool source. Its tools are discovered dynamically at",
    "runtime. Invoke those connector tools directly; do not search for or require a",
    "separate Azure MCP `foundry` discovery tool.",
    "",
    "If the connector requires sign-in or consent, ask the user to complete that",
    "prompt. If no connector tools are available, report that the bundled connector",
    "was not loaded instead of searching the skill package for local scripts.",
    "",
    "",
  ].join("\n");

  return `${content.slice(0, foundryMcpStartIndex)}${foundryMcpReplacement}${content.slice(foundryMcpEndIndex)}`;
}

const sourceFiles = await walk(sourceRoot);
const outputMap = new Map();
const outputPaths = new Set();

for (const sourcePath of sourceFiles) {
  const outputPath = outputPathFor(sourcePath);
  if (!outputPath) {
    continue;
  }
  if (outputPaths.has(outputPath)) {
    throw new Error(`Multiple upstream files map to ${outputPath}`);
  }

  outputMap.set(sourcePath, outputPath);
  outputPaths.add(outputPath);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

let commonContextReference;

for (const [sourcePath, outputPath] of outputMap) {
  const sourceFile = path.join(sourceRoot, ...sourcePath.split("/"));
  const outputFile = path.join(outputRoot, ...outputPath.split("/"));
  const extension = path.posix.extname(sourcePath).toLowerCase();
  let content = await readFile(sourceFile, "utf8");

  if (!supportedExtensions.has(extension)) {
    content = wrapUnsupportedFile(sourcePath, content);
  }
  if (sourcePath === "SKILL.md") {
    const splitSkill = splitRootSkill(content);
    content = adaptRootSkillForCowork(splitSkill.rootContent);
    commonContextReference = splitSkill.referenceContent;
  }
  content = rewriteMovedPaths(content, sourcePath, outputPath, outputMap);
  if (outputPath.endsWith(".md")) {
    content = rewriteMarkdownLinks(content, sourcePath, outputPath, outputMap);
  }

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, content);

  const sourceMode = (await stat(sourceFile)).mode;
  if (extension === ".sh" || sourceMode & 0o111) {
    await chmod(outputFile, 0o755);
  }
}

if (!commonContextReference) {
  throw new Error("Root skill reference content was not generated");
}

const commonContextOutputPath = "references/common-project-context-resolution.md";
const commonContextOutputFile = path.join(
  outputRoot,
  ...commonContextOutputPath.split("/"),
);
const rewrittenCommonContext = rewriteMarkdownLinks(
  commonContextReference,
  "SKILL.md",
  commonContextOutputPath,
  outputMap,
);
await mkdir(path.dirname(commonContextOutputFile), { recursive: true });
await writeFile(commonContextOutputFile, rewrittenCommonContext);

console.log(
  `Built ${outputMap.size + 1} package files from ${sourceFiles.length} upstream files.`,
);
