# @notionless/create-notionless-plugin

Scaffolder for [Paperus](https://github.com/Naridon-Inc/paperus) plugins.
Targets the **FROZEN Plugin API v1** (`apiVersion: "1"`).

## Usage (CLI)

```bash
npm create @notionless/plugin
# or
npx @notionless/create-notionless-plugin my-plugin --template word-count --id com.acme.word-count
```

Flags:

```
--template   word-count | custom-callout | ai-summarize | magic-login | custom-section | blank
--id         reverse-DNS id, e.g. com.acme.word-count
--name       display name
--author     author string
--license    SPDX id (default MIT)
--force      overwrite existing files
--list       list templates and exit
--help       show help
```

## Usage (programmatic)

The in-app **Plugin Lab** (`plugin:scaffold`) reuses this same engine, so a
plugin scaffolded from the CLI is identical to one scaffolded in-app.

```js
import { scaffold, TEMPLATES, renderTemplate } from '@notionless/create-notionless-plugin'

const { dir, files, manifest } = scaffold({
  template: 'word-count',
  id: 'com.acme.word-count',
  name: 'Word Count',
  author: 'dev@acme.example',
  targetDir: '/abs/path/to/plugins/com.acme.word-count',
})
```

`scaffold()` never prompts and never calls `process.exit`. It validates the id
(reverse-DNS), rejects path traversal in template files, refuses to overwrite
unless `force: true`, and returns the parsed manifest.

## Templates

Each template is a real folder tree under `templates/<name>/` with mustache-style
tokens (`{{id}}`, `{{name}}`, `{{description}}`, `{{author}}`, `{{license}}`,
`{{apiVersion}}`, `{{capabilitiesJson}}`, `{{idSlug}}`). They mirror the working
examples in `examples/plugins/*`.

## License

MIT
