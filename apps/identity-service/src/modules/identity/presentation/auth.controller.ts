import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { RegisterUserUseCase } from "../application/use-cases/register-user.use-case";
import { LoginUserUseCase } from "../application/use-cases/login-user.use-case";
import { RefreshAccessTokenUseCase } from "../application/use-cases/refresh-access-token.use-case";
import { GetCurrentUserUseCase } from "../application/use-cases/get-current-user.use-case";
import type { AuthenticatedUser } from "../application/auth.types";
import { GoogleLoginDto, LoginDto, RefreshDto, RegisterDto } from "./dto/auth.dto";
import { CurrentUser } from "./decorators/current-user.decorator";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { ListDeviceSessionsUseCase, LogoutAllSessionsUseCase, LogoutUseCase, RevokeDeviceSessionUseCase } from "../application/use-cases/session-management.use-cases";
import { GoogleLoginUseCase } from "../application/use-cases/google-login.use-case";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { authSwaggerExamples } from "./swagger.examples";

@Controller("auth")
@ApiTags("Authentication")
export class AuthController {
  constructor(private readonly registerUser: RegisterUserUseCase, private readonly loginUser: LoginUserUseCase, private readonly refreshAccessToken: RefreshAccessTokenUseCase, private readonly getCurrentUser: GetCurrentUserUseCase, private readonly logoutUser: LogoutUseCase, private readonly logoutAll: LogoutAllSessionsUseCase, private readonly listSessions: ListDeviceSessionsUseCase, private readonly revokeSession: RevokeDeviceSessionUseCase, private readonly googleLogin: GoogleLoginUseCase) {}
  @Post("register")
  @ApiOperation({ summary: "Register an account and create a device session" })
  @ApiBody({ type: RegisterDto, examples: { default: { value: authSwaggerExamples.register } } })
  @Throttle({ auth: {} }) register(@Body() dto: RegisterDto) {
    return this.registerUser.execute(dto);
  }
  @Post("login")
  @ApiOperation({ summary: "Log in with an account created by register" })
  @ApiBody({ type: LoginDto, examples: { default: { value: authSwaggerExamples.login } } })
  @Throttle({ auth: {} }) login(@Body() dto: LoginDto) {
    return this.loginUser.execute(dto);
  }
  @Post("refresh")
  @ApiOperation({ summary: "Rotate a refresh token", description: "Replace the placeholder with the refreshToken returned by register or login." })
  @ApiBody({ type: RefreshDto, examples: { default: { value: authSwaggerExamples.refresh } } })
  @HttpCode(HttpStatus.OK) @Throttle({ auth: {} }) refresh(@Body() dto: RefreshDto) {
    return this.refreshAccessToken.execute(dto.refreshToken);
  }
  @Post("oauth/google")
  @ApiOperation({ summary: "Log in with Google", description: "Requires a real Google ID token issued to the configured client ID; the placeholder is not executable." })
  @ApiBody({ type: GoogleLoginDto, examples: { default: { value: authSwaggerExamples.google } } })
  @Throttle({ auth: {} }) google(@Body() dto: GoogleLoginDto) { return this.googleLogin.execute(dto); }
  @Get("me") @ApiBearerAuth("access-token") @UseGuards(JwtAuthGuard) me(@CurrentUser() auth: AuthenticatedUser) {
    return this.getCurrentUser.execute(auth.userId);
  }
  @Post("logout") @ApiBearerAuth("access-token") @HttpCode(HttpStatus.NO_CONTENT) @UseGuards(JwtAuthGuard) logout(@CurrentUser() auth: AuthenticatedUser) { return this.logoutUser.execute(auth); }
  @Post("logout-all") @ApiBearerAuth("access-token") @HttpCode(HttpStatus.NO_CONTENT) @UseGuards(JwtAuthGuard) logoutEverywhere(@CurrentUser() auth: AuthenticatedUser) { return this.logoutAll.execute(auth.userId); }
  @Get("sessions") @ApiBearerAuth("access-token") @UseGuards(JwtAuthGuard) sessions(@CurrentUser() auth: AuthenticatedUser) { return this.listSessions.execute(auth.userId); }
  @Delete("sessions/:sessionId") @ApiBearerAuth("access-token") @HttpCode(HttpStatus.NO_CONTENT) @UseGuards(JwtAuthGuard) revoke(@CurrentUser() auth: AuthenticatedUser, @Param("sessionId") sessionId: string) { return this.revokeSession.execute(auth, sessionId); }
}
