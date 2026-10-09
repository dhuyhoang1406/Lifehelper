# Lifehelper review guidelines

These instructions apply to the entire repository. Review pull requests primarily
against their diff, reading adjacent code only when it is needed for context.

## Review priorities

- Prioritize correctness, security, runtime safety, maintainability, reusability,
  and extensibility.
- Flag hardcoded secrets, credentials, production URLs, and configuration that
  should come from validated environment variables.
- Flag unnecessary duplication and coupling, but do not recommend abstractions
  without a concrete current use. Avoid over-engineering.
- Check error paths and boundary conditions, not only the happy path.
- Ask for tests when changed behavior, important failure modes, or regressions are
  not meaningfully covered.
- Findings are advice for the developer. Codex must not approve or merge a pull
  request and must not treat its own review as the technical merge gate.

## Architecture boundaries

Lifehelper is a monorepo with six independently owned NestJS microservices, a
Flutter client, and small shared technical packages.

- Domain code must remain framework- and infrastructure-independent. Domain files
  must not import Prisma, NestJS, AWS SDKs, Redis clients, OpenAI SDKs, or generated
  persistence clients.
- Infrastructure code may depend on Prisma and external SDKs, and may translate
  between persistence/integration models and domain models.
- A service owns its database and persistence model. Flag cross-service database
  access and cross-service foreign keys. Services integrate through explicit APIs
  or event contracts.
- Shared packages may contain technical utilities, primitives, and integration
  contracts. They must not become a home for service-owned entities, business
  repositories, or mutable business logic.
- Generated directories are build artifacts. Do not review generated client code
  as handwritten source; review its schema or generator configuration instead.
- Preserve existing domain terminology and keep changes inside the correct bounded
  context: identity, productivity, AI, document, notification, or analytics.

## Verification expectations

- TypeScript changes should pass lint, type checking, relevant unit tests, Prisma
  validation/generation where applicable, build, and relevant integration tests.
- Flutter changes should pass `flutter analyze` and `flutter test`.
- Temporary test databases created during verification must be dropped in cleanup/finally
  after both successful and failed runs. Never leave test databases behind or drop
  application databases or pre-existing databases without explicit authorization.
- CI runs automatically on pushes to pull request branches; the AI review is informational and does not gate merging.

## Implementation conventions

- Read adjacent code and [service layout](docs/architecture/service-layout.md) before
  implementing a feature; follow the existing naming and dependency direction.
- Group feature-owned domain, application, presentation and integration adapters under
  `src/modules/<feature>/`. Application entry points go in `application/use-cases/`;
  supporting orchestration/policies go in `application/services/`. Keep tests adjacent.
- Keep service-wide persistence implementations at `src/persistence/`. Feature-owned
  repository contracts belong to the feature; contracts/errors and HTTP helpers used
  by multiple features may stay at service level. Do not invent empty layers/modules.
- Keep `AppModule` limited to service bootstrap configuration, logger, health and
  imports of composition modules. Register business controllers/providers/factories
  in their composition modules. Preserve global filter/guard scope when moving them.
- Import `PrismaModule` explicitly where required; it exports a single service-local
  `PrismaService`. Do not register duplicate clients or make Prisma a global provider.
- Preserve existing grouped CRUD use cases and decorator/factory injection choices
  unless a concrete problem requires a change. Do not introduce generic abstractions
  just to make services look identical.
- Run `pnpm architecture:check` and `pnpm architecture:test` for backend changes, plus
  the affected lint/typecheck/build/unit/integration checks. Explain any new layout
  exception in architecture documentation instead of silently choosing a new pattern.
