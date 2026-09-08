import { Body, Controller, Post } from "@nestjs/common";
import { RegisterUserUseCase } from "../application/use-cases/register-user.use-case";
import { LoginUserUseCase } from "../application/use-cases/login-user.use-case";
import { LoginDto, RegisterDto } from "./dto/auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly registerUser: RegisterUserUseCase, private readonly loginUser: LoginUserUseCase) {}
  @Post("register") register(@Body() dto: RegisterDto) {
    return this.registerUser.execute(dto);
  }
  @Post("login") login(@Body() dto: LoginDto) {
    return this.loginUser.execute(dto);
  }
}
