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
import { LoginDto, RefreshDto, RegisterDto } from "./dto/auth.dto";
import { CurrentUser } from "./decorators/current-user.decorator";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { ListDeviceSessionsUseCase, LogoutAllSessionsUseCase, LogoutUseCase, RevokeDeviceSessionUseCase } from "../application/use-cases/session-management.use-cases";

@Controller("auth")
export class AuthController {
  constructor(private readonly registerUser: RegisterUserUseCase, private readonly loginUser: LoginUserUseCase, private readonly refreshAccessToken: RefreshAccessTokenUseCase, private readonly getCurrentUser: GetCurrentUserUseCase, private readonly logoutUser: LogoutUseCase, private readonly logoutAll: LogoutAllSessionsUseCase, private readonly listSessions: ListDeviceSessionsUseCase, private readonly revokeSession: RevokeDeviceSessionUseCase) {}
  @Post("register") register(@Body() dto: RegisterDto) {
    return this.registerUser.execute(dto);
  }
  @Post("login") login(@Body() dto: LoginDto) {
    return this.loginUser.execute(dto);
  }
  @Post("refresh") @HttpCode(HttpStatus.OK) refresh(@Body() dto: RefreshDto) {
    return this.refreshAccessToken.execute(dto.refreshToken);
  }
  @Get("me") @UseGuards(JwtAuthGuard) me(@CurrentUser() auth: AuthenticatedUser) {
    return this.getCurrentUser.execute(auth.userId);
  }
  @Post("logout") @HttpCode(204) @UseGuards(JwtAuthGuard) logout(@CurrentUser() auth: AuthenticatedUser) { return this.logoutUser.execute(auth); }
  @Post("logout-all") @HttpCode(204) @UseGuards(JwtAuthGuard) logoutEverywhere(@CurrentUser() auth: AuthenticatedUser) { return this.logoutAll.execute(auth.userId); }
  @Get("sessions") @UseGuards(JwtAuthGuard) sessions(@CurrentUser() auth: AuthenticatedUser) { return this.listSessions.execute(auth.userId); }
  @Delete("sessions/:sessionId") @HttpCode(204) @UseGuards(JwtAuthGuard) revoke(@CurrentUser() auth: AuthenticatedUser, @Param("sessionId") sessionId: string) { return this.revokeSession.execute(auth, sessionId); }
}
