import { Logger } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import {
  ProductivityApplicationError,
  ProductivityErrorCode,
} from "../application/errors/productivity.errors";
import { TaskDomainError } from "../modules/task/domain/errors/task-domain.error";
import { ProductivityExceptionFilter } from "./productivity-exception.filter";

describe("ProductivityExceptionFilter", () => {
  const status = jest.fn();
  const json = jest.fn();
  const response = { status: status.mockReturnThis(), json };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        headers: { "x-correlation-id": "correlation-1" },
      }),
    }),
  } as unknown as ArgumentsHost;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    loggerError = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
  });
  afterEach(() => loggerError.mockRestore());

  it("maps application errors to a stable envelope", () => {
    new ProductivityExceptionFilter().catch(
      new ProductivityApplicationError(
        ProductivityErrorCode.TASK_NOT_FOUND,
        "Task not found",
        404,
      ),
      host,
    );
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      code: ProductivityErrorCode.TASK_NOT_FOUND,
      message: "Task not found",
      correlationId: "correlation-1",
    });
  });

  it("maps domain invariants without coupling the domain to HTTP", () => {
    new ProductivityExceptionFilter().catch(
      new TaskDomainError("Task title is required"),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("does not expose unexpected error details", () => {
    new ProductivityExceptionFilter().catch(
      new Error("postgresql://user:password@database"),
      host,
    );
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      correlationId: "correlation-1",
    });
    expect(loggerError).toHaveBeenCalled();
  });
});
