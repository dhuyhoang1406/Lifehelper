import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  dependencies,
  layoutViolation,
  dependencyViolation,
} from "./check-service-architecture.mjs";

const root = resolve("/architecture-fixture");
const source = (path) => resolve(root, "apps/document-service/src", path);
const check = (path, specifier) =>
  dependencyViolation(source(path), specifier, root);

test("domain permits its entities and primitives, but rejects framework and sibling feature imports", () => {
  const path = "modules/document/domain/entities/document.entity.ts";
  assert.equal(check(path, "../errors/document-domain.error"), undefined);
  assert.equal(check(path, "@lifehelper/shared-types"), undefined);
  for (const specifier of [
    "@nestjs/common",
    "@prisma/client",
    "../../application/ports/document-storage.port",
    "../../../other/domain/entity",
  ])
    assert.ok(check(path, specifier));
});

test("application accepts ports but rejects persistence and adapters even in type-only imports", () => {
  const path = "modules/document/application/use-cases/upload.ts";
  assert.equal(check(path, "../ports/document-storage.port"), undefined);
  assert.equal(check(path, "../../domain/entities/document.entity"), undefined);
  for (const specifier of [
    "@aws-sdk/client-s3",
    "@prisma/client",
    "../../infrastructure/storage/s3-document-storage",
    "../../../../persistence/document.persistence",
    "../../../../generated/client",
    "../../document.module",
  ])
    assert.ok(check(path, specifier));
});

test("cross-service source dependencies are rejected from adapters too", () => {
  assert.ok(
    check(
      "persistence/document.persistence.ts",
      "../../../productivity-service/src/prisma.service",
    ),
  );
  assert.equal(
    check(
      "modules/document/infrastructure/storage/s3-document-storage.ts",
      "@aws-sdk/client-s3",
    ),
    undefined,
  );
});

test("AppModule permits composition imports but rejects direct use case wiring", () => {
  assert.equal(
    check("app.module.ts", "./modules/document/document.module"),
    undefined,
  );
  assert.equal(check("app.module.ts", "./prisma.module"), undefined);
  assert.ok(
    check("app.module.ts", "./modules/document/application/use-cases/upload"),
  );
});

test("dependency extraction includes exports, import types, require and dynamic imports", () => {
  assert.deepEqual(
    dependencies(
      `
    import type { Port } from './port';
    export { Adapter } from './adapter';
    type Value = import('./type').Value;
    const sdk = require('sdk');
    const loaded = import('./lazy');
    const ignored = 'not-a-dependency';
  `,
      "fixture.ts",
    ),
    ["./port", "./adapter", "./type", "sdk", "./lazy"],
  );
});

test("layout permits shared Productivity contracts but keeps single-feature code together", () => {
  assert.equal(
    layoutViolation(
      "productivity-service",
      "application/repositories/productivity.repositories.ts",
    ),
    false,
  );
  assert.equal(
    layoutViolation("productivity-service", "presentation/pagination.dto.ts"),
    false,
  );
  assert.equal(
    layoutViolation(
      "document-service",
      "modules/document/application/ports/storage.ts",
    ),
    false,
  );
  assert.equal(
    layoutViolation(
      "document-service",
      "application/repositories/document.repositories.ts",
    ),
    true,
  );
  assert.equal(
    layoutViolation("ai-service", "presentation/ai.controller.ts"),
    true,
  );
  assert.equal(
    layoutViolation("productivity-service", "application/use-cases/task.ts"),
    true,
  );
});
