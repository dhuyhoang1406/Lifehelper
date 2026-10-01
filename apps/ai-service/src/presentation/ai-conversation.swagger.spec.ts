import { Test } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AIConversationUseCases } from "../application/services/ai-conversation.use-cases";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AIConversationController } from "./ai-conversation.controller";

describe("AI conversation Swagger documentation", () => {
  it("describes pagination query parameters as primitive numbers", async () => {
    const module = await Test.createTestingModule({
      controllers: [AIConversationController],
      providers: [{ provide: AIConversationUseCases, useValue: {} }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().addBearerAuth(undefined, "access-token").build(),
      );
      const list = document.paths["/ai/conversations"]?.get?.parameters ?? [];
      const history =
        document.paths["/ai/conversations/{id}"]?.get?.parameters ?? [];
      expect(list).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "page",
            schema: expect.objectContaining({ type: "number" }),
          }),
          expect.objectContaining({
            name: "limit",
            schema: expect.objectContaining({ type: "number" }),
          }),
        ]),
      );
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "limit",
            schema: expect.objectContaining({ type: "number" }),
          }),
          expect.objectContaining({
            name: "cursor",
            schema: expect.objectContaining({ type: "string" }),
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });
});
