import { Test } from "@nestjs/testing";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { DocumentRetrievalController } from "./document-retrieval.controller";
import { DocumentRetrievalUseCases } from "../application/use-cases/document-retrieval.use-cases";
import { JwtAuthGuard } from "../../../auth/jwt-auth.guard";

it("declares numeric retrieval budgets and pagination in Swagger", async () => {
  const module = await Test.createTestingModule({
    controllers: [DocumentRetrievalController],
    providers: [{ provide: DocumentRetrievalUseCases, useValue: {} }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = module.createNestApplication();
  try {
    const schema = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    expect(schema.components?.schemas?.DocumentSearchDto).toMatchObject({
      properties: {
        topK: { type: "number", default: 5, minimum: 1, maximum: 20 },
      },
    });
    expect(
      schema.paths["/internal/documents/{id}/chunks"]?.get?.parameters,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "after",
          in: "query",
          schema: expect.objectContaining({ type: "number", default: -1 }),
        }),
        expect.objectContaining({
          name: "limit",
          in: "query",
          schema: expect.objectContaining({ type: "number", default: 10 }),
        }),
      ]),
    );
  } finally {
    await app.close();
  }
});
