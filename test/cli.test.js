const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const cliPath = path.resolve(__dirname, "../src/cli.js");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "uvmigrate-"));
}

test("inspect --check exits non-zero when blockers exist", () => {
  const dir = makeTempDir();
  const pyproject = path.join(dir, "pyproject.toml");
  fs.writeFileSync(
    pyproject,
    `
[tool.poetry]
name = "broken"
version = "0.1.0"
packages = [{ include = "src" }]

[tool.poetry.dependencies]
python = "^3.10"
`,
    "utf8"
  );

  const result = spawnSync(process.execPath, [cliPath, "inspect", pyproject, "--check"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Blockers:/);
});

test("convert writes output file", () => {
  const dir = makeTempDir();
  const pyproject = path.join(dir, "pyproject.toml");
  const output = path.join(dir, "pyproject.uv.toml");

  fs.writeFileSync(
    pyproject,
    `
[tool.poetry]
name = "demo"
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.11"
requests = "2.32.3"
`,
    "utf8"
  );

  const result = spawnSync(process.execPath, [
    cliPath,
    "convert",
    pyproject,
    "--output",
    output,
  ], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  const written = fs.readFileSync(output, "utf8");
  assert.match(written, /\[project\]/);
  assert.match(written, /requests==2\.32\.3/);
});
