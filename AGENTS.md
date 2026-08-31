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
- CI runs automatically on pushes to pull request branches; the AI review is informational and does not gate merging.
