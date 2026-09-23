import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export interface SwaggerServiceOptions {
  title: string;
  description: string;
  bearerAuth?: boolean;
}

export function configureSwagger(
  app: INestApplication,
  options: SwaggerServiceOptions,
): void {
  const config = app.get(ConfigService);
  if (!config.get<boolean>("SWAGGER_ENABLED", false)) return;

  let builder = new DocumentBuilder()
    .setTitle(options.title)
    .setDescription(options.description)
    .setVersion("1.0");
  if (options.bearerAuth !== false) {
    builder = builder.addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Access token issued by identity-service",
      },
      "access-token",
    );
  }

  const document = SwaggerModule.createDocument(app, builder.build());
  SwaggerModule.setup(
    config.get<string>("SWAGGER_PATH", "docs"),
    app,
    document,
    { swaggerOptions: { persistAuthorization: true } },
  );
}
