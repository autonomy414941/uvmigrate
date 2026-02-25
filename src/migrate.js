const fs = require("node:fs");
const path = require("node:path");
const TOML = require("@iarna/toml");

function parseTomlFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return {
    raw,
    data: TOML.parse(raw),
  };
}

function splitNameAndEmail(value) {
  const match = /^\s*([^<]+?)\s*<([^>]+)>\s*$/.exec(value || "");
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { name: String(value || "").trim() };
}

function parseVersionParts(version) {
  const clean = String(version || "").trim();
  const base = clean.split(/[+-]/, 1)[0];
  const parts = base.split(".");
  const ints = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      break;
    }
    ints.push(Number(part));
  }
  return ints;
}

function formatVersion(parts) {
  return parts.join(".");
}

function caretUpperBound(parts) {
  if (parts.length === 0) {
    return null;
  }
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;

  if (major > 0) {
    return [major + 1, 0, 0];
  }
  if (minor > 0) {
    return [0, minor + 1, 0];
  }
  return [0, 0, patch + 1];
}

function tildeUpperBound(parts) {
  if (parts.length === 0) {
    return null;
  }
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  if (parts.length === 1) {
    return [major + 1, 0, 0];
  }
  return [major, minor + 1, 0];
}

function convertPoetryConstraint(spec) {
  const value = String(spec || "").trim();
  if (!value || value === "*") {
    return "";
  }
  if (value.includes("||")) {
    return { converted: value, warnings: [`Unsupported OR constraint syntax: ${value}`] };
  }

  if (value.startsWith("^") && value.length > 1) {
    const base = value.slice(1).trim();
    const parts = parseVersionParts(base);
    const upper = caretUpperBound(parts);
    if (upper) {
      return { converted: `>=${base},<${formatVersion(upper)}`, warnings: [] };
    }
  }

  if (value.startsWith("~") && !value.startsWith("~=") && value.length > 1) {
    const base = value.slice(1).trim();
    const parts = parseVersionParts(base);
    const upper = tildeUpperBound(parts);
    if (upper) {
      return { converted: `>=${base},<${formatVersion(upper)}`, warnings: [] };
    }
  }

  if (/^\d+(\.\d+)*([a-zA-Z0-9.+-]+)?$/.test(value)) {
    return { converted: `==${value}`, warnings: [] };
  }

  return { converted: value, warnings: [] };
}

function makePythonMarker(spec) {
  const value = String(spec || "").trim();
  if (!value) {
    return null;
  }
  const cmp = /^(<=|>=|<|>|==|!=)\s*([0-9][0-9a-zA-Z.*+-]*)$/.exec(value);
  if (cmp) {
    return `python_version ${cmp[1]} \"${cmp[2]}\"`;
  }
  return null;
}

function convertDependency(name, descriptor) {
  const warnings = [];
  const blockers = [];

  if (typeof descriptor === "string") {
    const parsed = convertPoetryConstraint(descriptor);
    warnings.push(...parsed.warnings);
    return {
      requirement: `${name}${parsed.converted}`,
      optional: false,
      warnings,
      blockers,
    };
  }

  if (!descriptor || typeof descriptor !== "object") {
    blockers.push(`Dependency ${name} has unsupported format.`);
    return { requirement: name, optional: false, warnings, blockers };
  }

  if (descriptor.source) {
    blockers.push(`Dependency ${name} uses source='${descriptor.source}', which needs manual migration.`);
  }

  let requirementBase = name;
  const extras = Array.isArray(descriptor.extras) ? descriptor.extras : [];
  if (extras.length > 0) {
    requirementBase += `[${extras.join(",")}]`;
  }

  const markers = [];
  if (descriptor.markers) {
    markers.push(String(descriptor.markers));
  }
  if (descriptor.python) {
    const pythonMarker = makePythonMarker(descriptor.python);
    if (pythonMarker) {
      markers.push(pythonMarker);
    } else {
      warnings.push(`Dependency ${name} has unsupported python marker syntax '${descriptor.python}'.`);
    }
  }

  if (descriptor.path) {
    const req = `${name} @ ${descriptor.path}`;
    return {
      requirement: markers.length > 0 ? `${req} ; ${markers.join(" and ")}` : req,
      optional: Boolean(descriptor.optional),
      warnings,
      blockers,
    };
  }

  if (descriptor.url) {
    const req = `${name} @ ${descriptor.url}`;
    return {
      requirement: markers.length > 0 ? `${req} ; ${markers.join(" and ")}` : req,
      optional: Boolean(descriptor.optional),
      warnings,
      blockers,
    };
  }

  if (descriptor.git) {
    const ref = descriptor.rev || descriptor.tag || descriptor.branch;
    const gitUrl = ref ? `git+${descriptor.git}@${ref}` : `git+${descriptor.git}`;
    const req = `${name} @ ${gitUrl}`;
    return {
      requirement: markers.length > 0 ? `${req} ; ${markers.join(" and ")}` : req,
      optional: Boolean(descriptor.optional),
      warnings,
      blockers,
    };
  }

  const parsed = convertPoetryConstraint(descriptor.version || "*");
  warnings.push(...parsed.warnings);

  let requirement = `${requirementBase}${parsed.converted}`;
  if (markers.length > 0) {
    requirement += ` ; ${markers.join(" and ")}`;
  }

  return {
    requirement,
    optional: Boolean(descriptor.optional),
    warnings,
    blockers,
  };
}

function normalizePythonConstraint(spec) {
  const value = String(spec || "").trim();
  if (!value || value === "*") {
    return null;
  }
  const converted = convertPoetryConstraint(value);
  return converted.converted || null;
}

function detectManager(data) {
  if (data?.tool?.poetry) {
    return "poetry";
  }
  if (data?.project) {
    return "pep621";
  }
  return "unknown";
}

function inspectProjectData(data) {
  const manager = detectManager(data);
  const blockers = [];
  const warnings = [];
  const stats = {
    dependencies: 0,
    optionalDependencies: 0,
    groups: 0,
  };

  if (manager !== "poetry") {
    blockers.push("tool.poetry not found. This tool currently migrates Poetry projects.");
    return { manager, blockers, warnings, stats };
  }

  const poetry = data.tool.poetry || {};

  if (poetry.packages) {
    blockers.push("tool.poetry.packages is not automatically converted.");
  }
  if (poetry.plugins) {
    blockers.push("tool.poetry.plugins is not automatically converted.");
  }
  if (poetry.include || poetry.exclude) {
    warnings.push("tool.poetry include/exclude patterns require manual review.");
  }

  const dependencies = poetry.dependencies || {};
  const depEntries = Object.entries(dependencies).filter(([name]) => name !== "python");
  stats.dependencies = depEntries.length;

  for (const [name, descriptor] of depEntries) {
    const converted = convertDependency(name, descriptor);
    if (converted.optional) {
      stats.optionalDependencies += 1;
    }
    blockers.push(...converted.blockers);
    warnings.push(...converted.warnings);
  }

  if (!dependencies.python) {
    warnings.push("No python version found in tool.poetry.dependencies.python.");
  }

  const groups = poetry.group || {};
  stats.groups = Object.keys(groups).length;
  for (const [groupName, groupConfig] of Object.entries(groups)) {
    if (!groupConfig || typeof groupConfig !== "object") {
      blockers.push(`Group '${groupName}' has invalid format.`);
      continue;
    }
    const groupDeps = groupConfig.dependencies || {};
    for (const [name, descriptor] of Object.entries(groupDeps)) {
      const converted = convertDependency(name, descriptor);
      blockers.push(...converted.blockers);
      warnings.push(...converted.warnings);
    }
  }

  const legacyDev = poetry["dev-dependencies"] || {};
  if (Object.keys(legacyDev).length > 0) {
    stats.groups += 1;
    warnings.push("Using legacy tool.poetry.dev-dependencies; converted into dependency-groups.dev.");
  }

  const extras = poetry.extras || {};
  if (Object.keys(extras).length > 0 && stats.optionalDependencies === 0) {
    warnings.push("tool.poetry.extras is set but no optional dependencies were detected.");
  }

  return {
    manager,
    blockers: unique(blockers),
    warnings: unique(warnings),
    stats,
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildProjectTable(poetry) {
  const dependencies = poetry.dependencies || {};
  const entries = Object.entries(dependencies).filter(([name]) => name !== "python");

  const project = {};
  if (poetry.name) project.name = poetry.name;
  if (poetry.version) project.version = poetry.version;
  if (poetry.description) project.description = poetry.description;
  if (poetry.readme) project.readme = poetry.readme;
  if (poetry.license) project.license = poetry.license;
  if (Array.isArray(poetry.keywords) && poetry.keywords.length > 0) project.keywords = poetry.keywords;
  if (Array.isArray(poetry.classifiers) && poetry.classifiers.length > 0) project.classifiers = poetry.classifiers;

  if (Array.isArray(poetry.authors) && poetry.authors.length > 0) {
    project.authors = poetry.authors.map(splitNameAndEmail);
  }
  if (Array.isArray(poetry.maintainers) && poetry.maintainers.length > 0) {
    project.maintainers = poetry.maintainers.map(splitNameAndEmail);
  }

  const requiresPython = normalizePythonConstraint(dependencies.python);
  if (requiresPython) {
    project["requires-python"] = requiresPython;
  }

  const convertedDependencies = [];
  const optionalLookup = {};

  for (const [name, descriptor] of entries) {
    const converted = convertDependency(name, descriptor);
    if (converted.optional) {
      optionalLookup[name] = converted.requirement;
      continue;
    }
    convertedDependencies.push(converted.requirement);
  }

  if (convertedDependencies.length > 0) {
    project.dependencies = convertedDependencies;
  }

  const optionalDependencies = {};
  const extras = poetry.extras || {};
  for (const [extraName, packages] of Object.entries(extras)) {
    const values = [];
    for (const packageName of packages || []) {
      values.push(optionalLookup[packageName] || packageName);
    }
    if (values.length > 0) {
      optionalDependencies[extraName] = values;
    }
  }
  if (Object.keys(optionalDependencies).length > 0) {
    project["optional-dependencies"] = optionalDependencies;
  }

  if (poetry.scripts && typeof poetry.scripts === "object") {
    project.scripts = poetry.scripts;
  }

  const urls = {};
  if (poetry.homepage) urls.Homepage = poetry.homepage;
  if (poetry.repository) urls.Repository = poetry.repository;
  if (poetry.documentation) urls.Documentation = poetry.documentation;
  if (Object.keys(urls).length > 0) {
    project.urls = urls;
  }

  return project;
}

function buildDependencyGroups(poetry) {
  const groups = {};

  if (poetry["dev-dependencies"] && typeof poetry["dev-dependencies"] === "object") {
    const items = [];
    for (const [name, descriptor] of Object.entries(poetry["dev-dependencies"])) {
      const converted = convertDependency(name, descriptor);
      items.push(converted.requirement);
    }
    if (items.length > 0) {
      groups.dev = items;
    }
  }

  if (poetry.group && typeof poetry.group === "object") {
    for (const [groupName, groupConfig] of Object.entries(poetry.group)) {
      const deps = groupConfig?.dependencies || {};
      const items = [];
      for (const [name, descriptor] of Object.entries(deps)) {
        const converted = convertDependency(name, descriptor);
        items.push(converted.requirement);
      }
      if (items.length > 0) {
        groups[groupName] = items;
      }
    }
  }

  return groups;
}

function buildUvIndices(poetry) {
  const sources = poetry.source;
  if (!Array.isArray(sources) || sources.length === 0) {
    return [];
  }

  return sources
    .filter((source) => source && source.name && source.url)
    .map((source) => {
      const index = {
        name: source.name,
        url: source.url,
      };
      if (source.default === true) {
        index.default = true;
      }
      if (source.priority === "explicit") {
        index.explicit = true;
      }
      return index;
    });
}

function convertProjectData(data) {
  const poetry = data.tool.poetry;
  const project = buildProjectTable(poetry);
  const dependencyGroups = buildDependencyGroups(poetry);
  const uvIndices = buildUvIndices(poetry);

  const output = {};
  output.project = project;

  if (Object.keys(dependencyGroups).length > 0) {
    output["dependency-groups"] = dependencyGroups;
  }

  output["build-system"] = {
    requires: ["hatchling"],
    "build-backend": "hatchling.build",
  };

  const tool = { ...(data.tool || {}) };
  delete tool.poetry;

  const uvTool = { ...(tool.uv || {}) };
  if (uvIndices.length > 0) {
    uvTool.index = uvIndices;
  }
  if (Object.keys(uvTool).length > 0) {
    tool.uv = uvTool;
  }

  if (Object.keys(tool).length > 0) {
    output.tool = tool;
  }

  return output;
}

function formatInspectionReport(filePath, inspection) {
  const lines = [];
  lines.push(`File: ${filePath}`);
  lines.push(`Detected manager: ${inspection.manager}`);
  lines.push(
    `Stats: dependencies=${inspection.stats.dependencies}, optional=${inspection.stats.optionalDependencies}, groups=${inspection.stats.groups}`
  );

  if (inspection.blockers.length === 0) {
    lines.push("Blockers: none");
  } else {
    lines.push("Blockers:");
    for (const blocker of inspection.blockers) {
      lines.push(`- ${blocker}`);
    }
  }

  if (inspection.warnings.length === 0) {
    lines.push("Warnings: none");
  } else {
    lines.push("Warnings:");
    for (const warning of inspection.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}

function backupFileIfNeeded(filePath) {
  const absolute = path.resolve(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${absolute}.bak.${stamp}`;
  fs.copyFileSync(absolute, backupPath);
  return backupPath;
}

module.exports = {
  TOML,
  parseTomlFile,
  inspectProjectData,
  convertProjectData,
  formatInspectionReport,
  backupFileIfNeeded,
};
