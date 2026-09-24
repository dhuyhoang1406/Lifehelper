import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { configureSwagger } from "./index";

describe("configureSwagger", () => {
  const document: OpenAPIObject = {
    openapi: "3.0.0",
    info: { title: "Test", version: "1.0" },
    paths: {},
  };
  const options = {
    title: "Test API",
    description: "Test service API",
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createApp(configValues: Record<string, unknown>): INestApplication {
    const config = {
      get: jest.fn((key: string, defaultValue: unknown) =>
        key in configValues ? configValues[key] : defaultValue,
      ),
    } as unknown as ConfigService;

    return {
      get: jest.fn().mockReturnValue(config),
    } as unknown as INestApplication;
  }

  it("does not create or mount Swagger when it is disabled", () => {
    const createDocument = jest.spyOn(SwaggerModule, "createDocument");
    const setup = jest.spyOn(SwaggerModule, "setup");

    configureSwagger(createApp({ SWAGGER_ENABLED: false }), options);

    expect(createDocument).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });

  it("creates and mounts Swagger at the configured path", () => {
    const createDocument = jest
      .spyOn(SwaggerModule, "createDocument")
      .mockReturnValue(document);
    const setup = jest.spyOn(SwaggerModule, "setup").mockImplementation();
    const app = createApp({
      SWAGGER_ENABLED: true,
      SWAGGER_PATH: "api-docs",
    });

    configureSwagger(app, options);

    expect(createDocument).toHaveBeenCalledWith(
      app,
      expect.objectContaining({
        info: expect.objectContaining({
          title: options.title,
          description: options.description,
          version: "1.0",
        }),
        components: expect.objectContaining({
          securitySchemes: expect.objectContaining({
            "access-token": expect.objectContaining({
              type: "http",
              scheme: "bearer",
            }),
          }),
        }),
      }),
    );
    expect(setup).toHaveBeenCalledWith("api-docs", app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  });

  it("uses the default path and omits bearer auth when requested", () => {
    const createDocument = jest
      .spyOn(SwaggerModule, "createDocument")
      .mockReturnValue(document);
    const setup = jest.spyOn(SwaggerModule, "setup").mockImplementation();
    const app = createApp({ SWAGGER_ENABLED: true });

    configureSwagger(app, { ...options, bearerAuth: false });

    const swaggerConfig = createDocument.mock.calls[0]?.[1];
    expect(swaggerConfig?.components?.securitySchemes).toBeUndefined();
    expect(setup).toHaveBeenCalledWith("docs", app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  });
});
