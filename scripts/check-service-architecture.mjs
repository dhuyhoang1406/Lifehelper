import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const slash = (value) => value.split(sep).join("/");
const infrastructurePackage =
  /^(?:@nestjs\/(?:typeorm|mongoose)|@prisma\/|@aws-sdk\/|aws-sdk$|ioredis$|redis$|pg$|openai$)/;

export function dependencyViolation(filename, specifier, root) {
  const source = slash(relative(root, filename));
  const match = source.match(/^apps\/([^/]+-service)\/src\/(.*)$/);
  if (!match) return;
  const [, service, location] = match;
  const target = specifier.startsWith(".")
    ? slash(relative(root, resolve(dirname(filename), specifier)))
    : specifier;
  const targetService = target.match(/^apps\/([^/]+-service)\//)?.[1];
  if (
    (targetService && targetService !== service) ||
    /^@lifehelper\/[^/]+-service(?:\/|$)/.test(specifier)
  )
    return "Services must integrate through contracts/APIs, not source imports";
  if (location.includes("/domain/")) {
    const feature = location.split("/")[1];
    if (specifier.startsWith(".")) {
      if (!target.startsWith(`apps/${service}/src/modules/${feature}/domain/`))
        return "Domain imports must stay in their own domain";
    } else if (specifier !== "@lifehelper/shared-types") {
      return "Domain may only import shared technical primitives externally";
    }
  }
  if (/(?:^|\/)application\//.test(location)) {
    if (
      infrastructurePackage.test(specifier) ||
      (specifier.startsWith(".") &&
        /\/(?:persistence|infrastructure|presentation|auth|generated)\/|\/prisma\.(?:service|module)$|\.module$/.test(
          target,
        ))
    )
      return "Application must depend on ports, not infrastructure or HTTP adapters";
  }
  if (location === "app.module.ts" && specifier.startsWith(".")) {
    if (
      !/^\.\/(?:health\.controller|env\.validation|prisma\.module|modules\/[^/]+\/[^/]+\.module)$/.test(
        specifier,
      )
    )
      return "AppModule must delegate business wiring to composition modules";
  }
}

export function dependencies(content, filename) {
  const file = ts.createSourceFile(
    filename,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const result = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      result.push(node.arguments[0].text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      result.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}

function* files(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) yield* files(filename);
    else if (
      entry.name.endsWith(".ts") &&
      !/\.(?:spec|test)\.ts$/.test(entry.name)
    )
      yield filename;
  }
}

export function layoutViolation(service, location) {
  return (
    /^infrastructure\//.test(location) ||
    (/^application\//.test(location) &&
      (service !== "productivity-service" ||
        !/^application\/(?:repositories|errors)\//.test(location))) ||
    (/^presentation\//.test(location) && service !== "productivity-service")
  );
}

export function checkArchitecture(root) {
  const findings = [];
  for (const service of readdirSync(join(root, "apps"))) {
    if (!service.endsWith("-service")) continue;
    for (const filename of files(join(root, "apps", service, "src"))) {
      const location = slash(
        relative(join(root, "apps", service, "src"), filename),
      );
      if (layoutViolation(service, location))
        findings.push(
          `${slash(relative(root, filename))}: feature-owned code belongs in modules/<feature>/`,
        );
      for (const specifier of dependencies(
        readFileSync(filename, "utf8"),
        filename,
      )) {
        const violation = dependencyViolation(filename, specifier, root);
        if (violation)
          findings.push(
            `${slash(relative(root, filename))}: ${specifier}: ${violation}`,
          );
      }
    }
  }
  return findings;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const findings = checkArchitecture(root);
  if (findings.length) {
    console.error(findings.join("\n"));
    process.exitCode = 1;
  } else console.log("Architecture boundaries pass for all six services.");
}
