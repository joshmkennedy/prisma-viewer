Prisma Pad integration fixture
=================================

This is a local-development-only Prisma fixture used by the integration test
suite. Tests copy it to a temporary directory, generate Prisma Client there, and
create a temporary SQLite development database.

It is not intended for production services or shared infrastructure.
