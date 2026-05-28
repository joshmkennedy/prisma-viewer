#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_DIR="$ROOT_DIR/tests/fixtures/prisma-app"
WORK_FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/prisma-pad-fixture.XXXXXX")"
PRISMA_BIN="$ROOT_DIR/node_modules/.bin/prisma"
PORT="${PORT:-5174}"
SESSION="${SESSION:-prisma-pad-refactor}"
BASE_URL="http://127.0.0.1:$PORT"

cp -R "$FIXTURE_DIR/." "$WORK_FIXTURE_DIR"
ln -s "$ROOT_DIR/node_modules" "$WORK_FIXTURE_DIR/node_modules"

cd "$WORK_FIXTURE_DIR"
"$PRISMA_BIN" generate --schema prisma/schema.prisma
"$PRISMA_BIN" db push --schema prisma/schema.prisma
DATABASE_URL=file:./dev.db node <<'NODE'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.post.deleteMany();
  await prisma.user.deleteMany();
  const ada = await prisma.user.create({
    data: { email: "ada@example.com", name: "Ada Lovelace" },
  });
  await prisma.post.create({
    data: {
      title: "Analytical Engine Notes",
      published: true,
      authorId: ada.id,
    },
  });
  await prisma.user.create({
    data: { email: "grace@example.com", name: "Grace Hopper" },
  });
}

main().finally(async () => prisma.$disconnect());
NODE

cd "$ROOT_DIR"
mkdir -p dogfood-output/screenshots dogfood-output/logs
: > dogfood-output/logs/console.txt
: > dogfood-output/logs/errors.txt

npm run build
node dist/node/cli.js --root "$WORK_FIXTURE_DIR" --port "$PORT" --no-open &
SERVER_PID=$!
cleanup() {
  agent-browser --session "$SESSION" close >/dev/null 2>&1 || true
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  rm -rf "$WORK_FIXTURE_DIR"
}
trap cleanup EXIT

sleep 2

capture_route() {
  local route="$1"
  local screenshot="$2"

  agent-browser --session "$SESSION" open "$BASE_URL$route"
  agent-browser --session "$SESSION" wait 1000
  agent-browser --session "$SESSION" screenshot "dogfood-output/screenshots/$screenshot"
}

capture_route "/" models-index.png
capture_route "/model/User" model-user-default.png
capture_route "/model/User?row=0" model-user-selected-row.png
capture_route "/model/User?search=ada" model-user-filtered.png
capture_route "/model/User?page=999&row=99&sort=missing:desc&filters=%5B%7B%22field%22%3A%22missing%22%2C%22operator%22%3A%22contains%22%2C%22value%22%3A%22x%22%7D%5D" model-user-stale-url.png
capture_route "/query-lab" query-lab-default.png
capture_route "/query-lab/User" query-lab-user-route.png

agent-browser --session "$SESSION" find role button click --name "Run Query Lab preview"
agent-browser --session "$SESSION" wait 1000
agent-browser --session "$SESSION" screenshot dogfood-output/screenshots/query-lab-result-table.png
agent-browser --session "$SESSION" find role button click --name "JSON"
agent-browser --session "$SESSION" wait 500
agent-browser --session "$SESSION" screenshot dogfood-output/screenshots/query-lab-result-json.png
agent-browser --session "$SESSION" screenshot dogfood-output/screenshots/query-lab-inspector.png
agent-browser --session "$SESSION" fill 'input[aria-label="Saved Query Lab view name"]' "User findMany"
agent-browser --session "$SESSION" find role button click --name "Save Query Lab view"
agent-browser --session "$SESSION" wait 500
agent-browser --session "$SESSION" screenshot dogfood-output/screenshots/query-lab-saved-views.png

for route in / /model/User /query-lab /query-lab/User; do
  smoke_session="$SESSION-smoke-${route//\//-}"
  agent-browser --session "$smoke_session" open "$BASE_URL$route"
  agent-browser --session "$smoke_session" wait 1000
  printf '\n## %s\n' "$route" >> dogfood-output/logs/errors.txt
  agent-browser --session "$smoke_session" errors >> dogfood-output/logs/errors.txt
  printf '\n## %s\n' "$route" >> dogfood-output/logs/console.txt
  agent-browser --session "$smoke_session" console >> dogfood-output/logs/console.txt
  agent-browser --session "$smoke_session" close
done
