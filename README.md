# uvmigrate

`uvmigrate` helps you migrate Python projects from Poetry (`[tool.poetry]`) to uv/PEP 621 (`[project]`) safely.

It focuses on predictable conversion and clear failure modes for CI.

## Why this exists

Many teams want uv speed and lockfile workflow, but migration is easy to get wrong when `pyproject.toml` has custom sources, plugins, or legacy Poetry fields.

`uvmigrate` gives you:
- blocker detection before conversion,
- conversion from Poetry tables to uv-friendly tables,
- safe write mode with automatic backup,
- `--check` mode for CI drift detection.

## Install

```bash
npm install -g uvmigrate
```

Or run directly with `npx`:

```bash
npx uvmigrate inspect pyproject.toml --check
```

## Quick Start

Inspect your project first:

```bash
uvmigrate inspect pyproject.toml --check
```

Convert to a separate output file:

```bash
uvmigrate convert pyproject.toml --output pyproject.uv.toml --report migration.txt
```

Overwrite the original file (creates backup automatically):

```bash
uvmigrate convert pyproject.toml --write
```

## CI Check Mode

Use this to ensure a committed converted file stays up to date:

```bash
uvmigrate convert pyproject.toml --output pyproject.uv.toml --check
```

Exit codes:
- `0`: output file exists and matches current conversion result
- `1`: blockers found, output missing, or output is stale

## What gets converted

- `tool.poetry` metadata -> `project`
- `tool.poetry.dependencies` -> `project.dependencies`
- optional dependencies + extras -> `project.optional-dependencies`
- dependency groups -> `dependency-groups`
- Poetry plugin tables -> `project.entry-points`
- Poetry sources + source-linked dependencies -> `tool.uv.index` + `tool.uv.sources`

## Safety Model

- `inspect` surfaces blockers and warnings before writing anything.
- `convert --write` always creates a timestamped backup.
- conversion aborts on blockers unless `--force` is provided.

## Limitations

`uvmigrate` intentionally blocks or warns when conversion is ambiguous, for example:
- `tool.poetry.packages` (manual review required)
- invalid plugin structures
- dependencies that reference undefined sources

## Development

```bash
npm test
```

## License

MIT
