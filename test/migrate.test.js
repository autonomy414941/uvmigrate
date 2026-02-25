const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TOML,
  inspectProjectData,
  convertProjectData,
} = require("../src/migrate");

const poetryProject = TOML.parse(`
[tool.poetry]
name = "demo"
version = "0.1.0"
description = "demo project"
authors = ["Alice Doe <alice@example.com>"]
readme = "README.md"
repository = "https://github.com/acme/demo"

[tool.poetry.dependencies]
python = "^3.11"
requests = "2.32.3"
fastapi = {version = "^0.112.2", extras = ["all"]}
orjson = {version = "^3.10.0", optional = true}

[tool.poetry.group.dev.dependencies]
pytest = "^8.3.2"

[tool.poetry.extras]
speed = ["orjson"]

[[tool.poetry.source]]
name = "corp"
url = "https://packages.example.com/simple"
priority = "explicit"
`);

test("inspect detects poetry project without blockers", () => {
  const inspection = inspectProjectData(poetryProject);
  assert.equal(inspection.manager, "poetry");
  assert.equal(inspection.blockers.length, 0);
  assert.equal(inspection.stats.dependencies, 3);
  assert.equal(inspection.stats.groups, 1);
});

test("convert builds uv-compatible shape", () => {
  const converted = convertProjectData(poetryProject);

  assert.equal(converted.project.name, "demo");
  assert.equal(converted.project["requires-python"], ">=3.11,<4.0.0");
  assert.deepEqual(converted.project.dependencies, [
    "requests==2.32.3",
    "fastapi[all]>=0.112.2,<0.113.0",
  ]);

  assert.deepEqual(converted["dependency-groups"].dev, [
    "pytest>=8.3.2,<9.0.0",
  ]);

  assert.deepEqual(converted.project["optional-dependencies"].speed, [
    "orjson>=3.10.0,<4.0.0",
  ]);

  assert.equal(converted.tool.uv.index[0].name, "corp");
  assert.equal(converted.tool.uv.index[0].explicit, true);
});

test("inspect reports blockers for unsupported sections", () => {
  const broken = TOML.parse(`
[tool.poetry]
name = "broken"
version = "0.1.0"
packages = [{ include = "src" }]

[tool.poetry.dependencies]
python = "^3.10"
privatepkg = {version = "^1.0", source = "company"}
`);

  const inspection = inspectProjectData(broken);
  assert.ok(inspection.blockers.some((line) => line.includes("tool.poetry.packages")));
  assert.ok(inspection.blockers.some((line) => line.includes("privatepkg")));
});
