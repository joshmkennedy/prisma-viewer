---
"prisma-pad": patch
---

Let Prisma Client resolve the datasource env var from the target schema instead of requiring `DATABASE_URL`, and report the exact missing env var when startup fails.
