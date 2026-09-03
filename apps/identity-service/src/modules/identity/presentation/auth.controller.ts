import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { RegisterUserUseCase } from "../application/use-cases/register-user.use-case";
import { LoginUserUseCase } from "../application/use-cases/login-user.use-case";
import { RefreshAccessTokenUseCase } from "../application/use-cases/refresh-access-token.use-case";
import { LoginDto, RefreshDto, RegisterDto } from "./dto/auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly registerUser: RegisterUserUseCase, private readonly loginUser: LoginUserUseCase, private readonly refreshAccessToken: RefreshAccessTokenUseCase) {}
  @Post("register") register(@Body() dto: RegisterDto) {
    return this.registerUser.execute(dto);
  }
  @Post("login") login(@Body() dto: LoginDto) {
    return this.loginUser.execute(dto);
  }
  @Post("refresh") @HttpCode(HttpStatus.OK) refresh(@Body() dto: RefreshDto) {
    return this.refreshAccessToken.execute(dto.refreshToken);
  }
}
