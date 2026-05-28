# Prisma Pad

Prisma Pad is a local, read-only data viewer for Prisma applications. It starts from a target app directory, loads that app's environment, uses that app's generated Prisma Client, and serves a browser UI for inspecting model rows and individual records.

## Requirements

- Node.js 20 or newer
- npm
- A target Prisma app with:
  - `prisma` installed
  - `@prisma/client` installed
  - a generated Prisma Client
  - `DATABASE_URL` exported in the shell or defined in `.env.local` or `.env`
  - a reachable development database

## Run With npx

From any Prisma app directory, run:

```sh
npx prisma-pad
```

Prisma Pad starts a local dev server and opens the browser automatically.

## Install This Project

From this repository:

```sh
npm install
npm run build
npm link
```

You can also install it globally from this checkout:

```sh
npm install -g .
```

## Prepare Your Prisma App

In the app you want to inspect, make sure Prisma is installed and generated:

```sh
npm install prisma @prisma/client
npx prisma generate
```

Make sure the app has `DATABASE_URL` exported in the shell or defined in `.env.local` or `.env`:

```sh
DATABASE_URL="file:./dev.db"
```

Prisma Pad loads `.env.local` first and `.env` second. When both files define the same variable, `.env.local` wins.

## Run Prisma Pad

From any Prisma app directory, run:

```sh
prisma-pad
```

Prisma Pad starts a local dev server and opens the browser automatically.

You can also run the CLI against a specific Prisma app:

```sh
prisma-pad --root /path/to/your/prisma-app
```

You can also pass the app root as the first positional argument:

```sh
prisma-pad /path/to/your/prisma-app
```

The CLI prints a local URL such as:

```txt
Prisma Pad running at http://127.0.0.1:54321/
```

If you do not want the browser to open automatically, pass `--no-open`.

## CLI Options

```sh
prisma-pad [app-root] [--root <path>] [--host <host>] [--port <port>] [--no-open]
```

- `app-root`: Target Prisma app directory. Defaults to the current working directory.
- `--root <path>`: Explicit target Prisma app directory.
- `--host <host>`: Host for the local viewer server. Defaults to `127.0.0.1`.
- `--port <port>`: Port for the local viewer server. Defaults to an available random port.
- `--open`: Open the viewer in the default browser. Enabled by default.
- `--no-open`: Print the viewer URL without opening a browser.
- `-h, --help`: Show CLI help.

Example with a fixed port:

```sh
prisma-pad --root ../my-app --port 5174
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

- The CLI resolves the target app root.
- It loads `.env.local` and `.env` from the target app when present, while also supporting shell-provided env vars.
- It verifies `DATABASE_URL`, `prisma`, and `@prisma/client`.
- It initializes the target app's generated Prisma Client.
- It starts a local Vite server with read-only API middleware.
- It opens the browser to the local app.
- The browser UI calls local endpoints to list Prisma models and rows.

The viewer exposes only read endpoints. It does not create, update, delete, run raw SQL, apply migrations, or edit schema files.

## Troubleshooting

If startup says `DATABASE_URL` is missing, export it in your shell or add it to the target app's `.env.local` or `.env`.

If startup says Prisma is not installed, run this in the target app:

```sh
npm install prisma @prisma/client
```

If startup says the generated Prisma Client is missing or could not initialize, run this in the target app:

```sh
npx prisma generate
```

If the viewer starts but row loading fails, verify that `DATABASE_URL` points to a reachable development database and that the database schema matches the generated Prisma Client.
