import { Test } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { DocumentController } from "./document.controller";
import { DocumentUploadUseCases } from "../application/services/document-upload.use-cases";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

it("uses the registered access-token scheme for every Document operation", async () => {
  const module = await Test.createTestingModule({
    controllers: [DocumentController],
    providers: [{ provide: DocumentUploadUseCases, useValue: {} }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = module.createNestApplication();
  try {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, "access-token").build(),
    );
    const operations = Object.values(document.paths).flatMap((path) =>
      [path?.get, path?.post, path?.delete].filter(
        (operation) => operation !== undefined,
      ),
    );
    expect(operations).toHaveLength(6);
    expect(
      document.paths["/documents/upload-url"]?.post?.requestBody,
    ).toMatchObject({
      content: {
        "application/json": {
          examples: {
            textFile: {
              value: {
                filename: "notes.txt",
                mimeType: "text/plain",
                sizeBytes: 6,
              },
            },
          },
        },
      },
    });
    for (const operation of operations) {
      expect(operation?.security).toEqual([{ "access-token": [] }]);
      for (const scheme of Object.keys(operation?.security?.[0] ?? {})) {
        expect(document.components?.securitySchemes).toHaveProperty(scheme);
      }
    }
  } finally {
    await app.close();
  }
});
