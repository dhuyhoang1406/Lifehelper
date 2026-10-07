# Service layout and dependency boundaries

Lifehelper uses feature modules inside independently owned services. Domain models,
application orchestration and adapters are grouped around the business feature they
serve. This convention follows the existing Identity and Productivity modules and
extends the same organization to AI and Document.

## Layout

```text
src/
  app.module.ts                  # environment, logger, health, composition imports
  main.ts                        # HTTP bootstrap
  env.validation.ts              # validated service configuration
  health.controller.ts
  prisma.module.ts                # explicitly exports one service-local PrismaService
  prisma.service.ts
  modules/
    <feature>/
      domain/                    # framework-independent entities, errors, policies
      application/
        use-cases/               # application entry points, including grouped CRUD
        services/                # supporting orchestration/policies when needed
        ports/                   # contracts for storage/providers/external APIs
        repositories/            # feature-owned persistence contracts
        errors/
      presentation/              # HTTP controllers, DTOs, exception translation
      infrastructure/            # implementations of external integration ports
      <feature>.module.ts        # composition where a Nest module is needed
  application/                   # contracts/errors genuinely shared by features
  persistence/                   # service-local Prisma adapters, mappers, transaction helpers
  auth/                          # JWT plumbing shared by authenticated features
  presentation/                  # HTTP helpers genuinely shared by features
  config/                        # validated configuration factories
  testing/                       # service-local test doubles
```

Create only directories and Nest modules with actual consumers. A domain-only service
is not required to have empty application/infrastructure directories or an empty Nest
feature module. Unit tests stay beside the code they exercise; integration/E2E tests
stay under `test/`. Generated clients remain outside handwritten `src/`.

Productivity owns multiple features (task, calendar, habit and reminder). Its shared
repository contracts, errors, authentication and HTTP helpers remain at service level.
`modules/productivity/productivity.module.ts` composes these features and their existing
providers; separate modules per feature can be introduced when independent wiring is
needed. AI, Document, Identity, Notification and Analytics each currently have one
principal feature, so their repository contracts live alongside that feature.

Identity's security adapters belong to its identity feature. JWT verification shared
across endpoints in AI, Document and Productivity stays in service-level `auth/`.
Notification and Analytics currently have domain/persistence scaffolding and health
endpoints; no delivery/analytics runtime is invented merely to match another service.

## Dependency rules

- Domain imports its own domain and shared technical primitives, never Nest, Prisma,
  SDKs, use cases, HTTP DTOs or another feature's domain.
- Application depends on domain and abstract ports/repositories. Nest injection and
  validated configuration access already used by Identity/Productivity are supported;
  persistence clients, SDKs, HTTP controllers and concrete adapters are not.
- Presentation invokes use cases and translates HTTP input/output/errors. It does not
  access Prisma or implement business rules.
- Infrastructure/persistence implement application contracts and map integration data
  into domain values. Persistence may serve multiple features in its owning service.
- Composition modules are the place for concrete factories, injection tokens and Nest
  provider/controller registration. `AppModule` delegates business wiring to them.
- `PrismaModule` uses explicit imports/exports, rather than global providers. Importing
  the same static module from health and business composition shares one Nest instance;
  feature modules must not register another `PrismaService` themselves.
- Global exception filters and guards retain their existing registration and scope.
  Export providers only for actual consumers (for example AI provider health checks).
- Services communicate through APIs/event contracts; they never import another
  service's source or access another service's database.

Repository and port names describe the current capability. Existing grouped CRUD use
cases are supported; do not split them or add interfaces, generic base repositories,
strategies or factories solely for uniform appearance.

## Enforcement and validation

`pnpm architecture:check` scans production TypeScript dependencies across all six
services. It rejects domain/application boundary violations, cross-service source
imports, feature-owned use cases/adapters at service root and direct business wiring
imports in `AppModule`. The checker uses the TypeScript parser, including type imports,
re-exports and literal dynamic imports/require calls. It complements code review and
integration tests; it does not prove database ownership or runtime security by itself.
`pnpm architecture:test` checks the guard against representative regressions.

CI runs both checks, lint, build, type checking, unit, persistence and E2E tests. Module
refactors must also exercise real AI-to-Productivity workflows and Document storage/job
suites because moving a Nest provider can change dependency visibility or lifecycle.
Use dedicated test databases; do not reset application data.

This refactor changes source organization and Nest composition only. No database
migration, API/event contract, authentication policy, timestamp rule, provider choice,
retry policy or document lifecycle is changed. Pending Document processing stages and
Notification/Analytics features remain deferred to their approved roadmap.
