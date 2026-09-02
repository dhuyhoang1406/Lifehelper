import { Body, Controller, Post } from "@nestjs/common";
import { RegisterUserUseCase } from "../application/use-cases/register-user.use-case";
import { RegisterDto } from "./dto/auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly registerUser: RegisterUserUseCase) {}
  @Post("register") register(@Body() dto: RegisterDto) {
    return this.registerUser.execute(dto);
  }
}
