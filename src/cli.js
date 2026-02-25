#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  TOML,
  parseTomlFile,
  inspectProjectData,
  convertProjectData,
  formatInspectionReport,
  backupFileIfNeeded,
} = require("./migrate");

function usage() {
  console.log(`uvmigrate - Safe Poetry to uv migration helper

Usage:
  uvmigrate inspect [pyproject-path] [--check] [--json]
  uvmigrate convert [pyproject-path] [--output <path>] [--write] [--force] [--report <path>]

Examples:
  uvmigrate inspect pyproject.toml --check
  uvmigrate convert pyproject.toml --output pyproject.uv.toml --report migration.txt
  uvmigrate convert pyproject.toml --write --force`);
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    check: false,
    json: false,
    write: false,
    force: false,
    output: null,
    report: null,
    path: "pyproject.toml",
  };

  let pathAssigned = false;
  while (args.length > 0) {
    const token = args.shift();
    if (token === "--check") {
      options.check = true;
      continue;
    }
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--write") {
      options.write = true;
      continue;
    }
    if (token === "--force") {
      options.force = true;
      continue;
    }
    if (token === "--output" || token === "-o") {
      const value = args.shift();
      if (!value) {
        throw new Error("--output requires a path");
      }
      options.output = value;
      continue;
    }
    if (token === "--report") {
      const value = args.shift();
      if (!value) {
        throw new Error("--report requires a path");
      }
      options.report = value;
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error(`Unknown option: ${token}`);
    }
    if (!pathAssigned) {
      options.path = token;
      pathAssigned = true;
      continue;
    }
    throw new Error(`Unexpected argument: ${token}`);
  }

  return options;
}

function loadInspection(filePath) {
  const parsed = parseTomlFile(filePath);
  const inspection = inspectProjectData(parsed.data);
  return {
    parsed,
    inspection,
  };
}

function runInspect(options) {
  const targetPath = path.resolve(options.path);
  const { inspection } = loadInspection(targetPath);

  if (options.json) {
    console.log(JSON.stringify({ file: targetPath, ...inspection }, null, 2));
  } else {
    console.log(formatInspectionReport(targetPath, inspection));
  }

  if (options.check && inspection.blockers.length > 0) {
    process.exitCode = 1;
  }
}

function runConvert(options) {
  const targetPath = path.resolve(options.path);
  const { parsed, inspection } = loadInspection(targetPath);

  if (inspection.blockers.length > 0 && !options.force) {
    console.error(formatInspectionReport(targetPath, inspection));
    console.error("\nConversion aborted: blockers found. Re-run with --force to proceed anyway.");
    process.exitCode = 1;
    return;
  }

  const converted = convertProjectData(parsed.data);
  const tomlOutput = TOML.stringify(converted);

  if (options.report) {
    fs.writeFileSync(options.report, formatInspectionReport(targetPath, inspection), "utf8");
  }

  if (!options.write && !options.output) {
    process.stdout.write(tomlOutput);
    return;
  }

  const outputPath = path.resolve(options.output || targetPath);
  if (options.write && outputPath === targetPath) {
    const backupPath = backupFileIfNeeded(targetPath);
    fs.writeFileSync(targetPath, tomlOutput, "utf8");
    console.error(`Overwrote ${targetPath}`);
    console.error(`Backup: ${backupPath}`);
    return;
  }

  fs.writeFileSync(outputPath, tomlOutput, "utf8");
  console.error(`Wrote ${outputPath}`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "-h" || command === "--help" || command === "help") {
    usage();
    return;
  }

  const options = parseArgs(rest);

  if (command === "inspect") {
    runInspect(options);
    return;
  }
  if (command === "convert") {
    runConvert(options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
