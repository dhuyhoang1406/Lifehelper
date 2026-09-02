import { HttpException, Logger } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { IdentityApplicationError, IdentityErrorCode } from "../application/errors/identity.errors";
import { IdentityExceptionFilter } from "./identity-exception.filter";

describe("IdentityExceptionFilter", () => {
  const status = jest.fn();
  const json = jest.fn();
  const response = { status: status.mockReturnThis(), json };
  const request = { headers: { "x-correlation-id": "correlation-1" } };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => loggerError.mockRestore());

  it("maps application errors to the stable error envelope", () => {
    new IdentityExceptionFilter().catch(
      new IdentityApplicationError(
        IdentityErrorCode.EMAIL_ALREADY_EXISTS,
        "Email is already registered",
        409,
      ),
      host,
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      statusCode: 409,
      code: IdentityErrorCode.EMAIL_ALREADY_EXISTS,
      message: "Email is already registered",
      correlationId: "correlation-1",
    });
  });

  it("preserves Nest HTTP exceptions", () => {
    new IdentityExceptionFilter().catch(
      new HttpException({ code: "BAD_REQUEST" }, 400),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ code: "BAD_REQUEST" });
  });

  it("hides unexpected error details and logs the cause", () => {
    new IdentityExceptionFilter().catch(new Error("database password"), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      correlationId: "correlation-1",
    });
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining("database password"));
  });
});
