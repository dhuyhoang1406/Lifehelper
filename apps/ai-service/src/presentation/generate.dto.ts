import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class GenerateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16_000)
  prompt!: string;
}
