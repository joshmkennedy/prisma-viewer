# Prisma Pad

Prisma Pad is a local, read-only data viewer for Prisma apps. Run it from an existing project with `npx`, point it at a Prisma application, and it opens a browser UI for inspecting models, rows, records, and supported Prisma Client read queries.

It uses the target app's own `prisma`, generated `@prisma/client`, and environment files, so the viewer runs against the same local development setup your app already uses.

## Features

- Browse Prisma models and table rows in a local web UI.
- Inspect individual records as fields or JSON.
- Filter, sort, and paginate model rows.
- Run supported read-only Query Lab operations: `findMany`, `findFirst`, `findUnique`, and `count`.
- Load database configuration from the target app's Prisma datasource env var.
- Start on an open local port and open your browser automatically.

## Requirements

- Node.js 20 or newer
- npm
- A Prisma app with:
  - `prisma` installed
  - `@prisma/client` installed
  - a generated Prisma Client
  - the datasource env var referenced by your Prisma schema, such as `DATABASE_URL` or `POSTGRES_URL`, available in an env file or your shell
  - a reachable development database

## Quick Start

From the Prisma app you want to inspect:

```sh
npx prisma-pad@latest
```

Prisma Pad starts a local server, prints the URL, and opens the viewer in your default browser.

```txt
Prisma Pad running at http://127.0.0.1:54321/
App root: /path/to/your/app
Loaded env: .env.local, .env
```

## Installation

You do not need to install Prisma Pad to use it. The recommended workflow is:

```sh
npx prisma-pad@latest
```

If you use Prisma Pad often, install it globally:

```sh
npm install -g prisma-pad
```

Then run it from any Prisma app:

```sh
prisma-pad
```

To update a global install:

```sh
npm update -g prisma-pad
```

## Set Up Your Prisma App

Prisma Pad runs against an existing Prisma app. In that app, install Prisma and Prisma Client if they are not already installed:

```sh
npm install prisma @prisma/client
```

Generate Prisma Client:

```sh
npx prisma generate
```

Make sure the database URL env var referenced by your Prisma schema is available. Prisma Pad does not require the variable to be named `DATABASE_URL`; it lets the generated Prisma Client resolve whatever your schema uses.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("POSTGRES_URL")
}
```

For that schema, define `POSTGRES_URL`:

```sh
POSTGRES_URL="postgresql://user:password@localhost:5432/my_app"
```

The default Prisma name works too:

```sh
DATABASE_URL="file:./dev.db"
```

You can place that variable in `.env.local`, `.env`, a custom env file, or export it in your shell:

```sh
export POSTGRES_URL="postgresql://user:password@localhost:5432/my_app"
```

Environment precedence is:

1. the file passed with `--env-file`
2. `.env.local`
3. `.env`
4. shell environment

When more than one source defines the same variable, the earlier source in that list wins.

If your app uses another file name, pass it explicitly:

```sh
npx prisma-pad@latest --env-file .env.dev.local
```

Relative `--env-file` paths are resolved from the target app root.

## Usage

Run against the current directory:

```sh
npx prisma-pad@latest
```

Run against another Prisma app:

```sh
npx prisma-pad@latest --root ../my-prisma-app
```

You can also pass the app root as the first positional argument:

```sh
npx prisma-pad@latest ../my-prisma-app
```

Use a fixed port:

```sh
npx prisma-pad@latest --port 5174
```

Use a custom env file:

```sh
npx prisma-pad@latest --env-file .env.dev.local
```

Print the URL without opening a browser:

```sh
npx prisma-pad@latest --no-open
```

Bind to a different host:

```sh
npx prisma-pad@latest --host 0.0.0.0 --port 5174
```

## CLI Reference

```sh
prisma-pad [app-root] [--root <path>] [--env-file <path>] [--host <host>] [--port <port>] [--open] [--no-open]
```

### Arguments

| Argument | Description |
| --- | --- |
| `app-root` | Target Prisma app directory. Defaults to the current working directory. |

### Options

| Option | Description |
| --- | --- |
| `--root <path>` | Target Prisma app directory. Overrides the positional `app-root` value. |
| `--env-file <path>` | Additional env file to load. Relative paths resolve from the target app root and override `.env.local` and `.env`. |
| `--host <host>` | Host for the local viewer server. Defaults to `127.0.0.1`. |
| `--port <port>` | Port for the local viewer server. Defaults to an available random port. |
| `--open` | Open the viewer in the default browser. Enabled by default. |
| `--no-open` | Print the viewer URL without opening a browser. |
| `-h, --help` | Show CLI help. |

## Safety

Prisma Pad is designed for local development. It exposes read-only API endpoints and does not create, update, delete, run raw SQL, apply migrations, or edit schema files.

Use it with development databases. Do not expose the local viewer server to untrusted networks.

## Troubleshooting

### Datasource env var is missing

If Prisma Pad reports that your Prisma schema expects an env var, add that exact variable to the target app's `.env.local`, `.env`, custom env file, or export it before starting Prisma Pad.

For example, this datasource:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("POSTGRES_URL")
}
```

needs:

```sh
export POSTGRES_URL="postgresql://user:password@localhost:5432/my_app"
npx prisma-pad@latest
```

For a schema that uses `env("DATABASE_URL")`:

```sh
export DATABASE_URL="postgresql://user:password@localhost:5432/my_app"
npx prisma-pad@latest
```

For custom env file names:

```sh
npx prisma-pad@latest --env-file .env.dev.local
```

### Prisma is not installed

Install Prisma in the target app:

```sh
npm install prisma
```

### Prisma Client is not installed

Install Prisma Client in the target app:

```sh
npm install @prisma/client
```

### The generated Prisma Client is missing

Generate Prisma Client in the target app:

```sh
npx prisma generate
```

### Rows fail to load

Check that your Prisma datasource URL points to a reachable development database and that the database schema matches the generated Prisma Client. If you changed `schema.prisma`, run:

```sh
npx prisma generate
```

## Development

Install dependencies:

```sh
npm install
```

Run the frontend Vite dev server:

```sh
npm run dev
```

Build the frontend and Node CLI:

```sh
npm run build
```

Run tests:

```sh
npm test
```

## How It Works

1. The CLI resolves the target app root.
2. It loads environment files from the target app.
3. It verifies `prisma` and `@prisma/client`.
4. It initializes the target app's generated Prisma Client, letting Prisma resolve the datasource env var from the schema.
5. It starts a local Vite server with Prisma Pad API middleware.
6. It opens the browser to the local viewer unless `--no-open` is passed.
