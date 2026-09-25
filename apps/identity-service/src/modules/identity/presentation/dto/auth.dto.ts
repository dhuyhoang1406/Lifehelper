import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDefined, IsEmail, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, Length, Matches, MinLength, ValidateNested } from "class-validator";
import { DevicePlatform } from "../../domain/enums/identity.enums";

export class DeviceDto {
  @ApiProperty({ example: "swagger-browser" })
  @IsString() @IsNotEmpty() @Length(1, 255) deviceId!: string;
  @ApiProperty({ enum: DevicePlatform, example: DevicePlatform.WEB })
  @IsEnum(DevicePlatform) platform!: DevicePlatform;
  @ApiPropertyOptional({ example: "Browser" })
  @IsOptional() @IsString() @Length(1, 120) deviceName?: string;
}
export class RegisterDto {
  @ApiProperty({ example: "swagger-test@example.com" })
  @IsEmail() email!: string;
  @ApiProperty({ example: "ExamplePass123", minLength: 8, maxLength: 128, description: "Must contain lowercase, uppercase, and digit characters." })
  @IsString() @MinLength(8) @Length(8, 128)
  @Matches(/[a-z]/, { message: "password must contain a lowercase letter" })
  @Matches(/[A-Z]/, { message: "password must contain an uppercase letter" })
  @Matches(/\d/, { message: "password must contain a number" })
  password!: string;
  @ApiProperty({ example: "Swagger Tester" })
  @IsString() @Length(1, 100) displayName!: string;
  @ApiProperty({ type: () => DeviceDto })
  @IsDefined() @IsObject() @ValidateNested() @Type(() => DeviceDto) device!: DeviceDto;
}
export class LoginDto {
  @ApiProperty({ example: "swagger-test@example.com" })
  @IsEmail() email!: string;
  @ApiProperty({ example: "ExamplePass123" })
  @IsString() @Length(1, 128) password!: string;
  @ApiProperty({ type: () => DeviceDto })
  @IsDefined() @IsObject() @ValidateNested() @Type(() => DeviceDto) device!: DeviceDto;
}
export class RefreshDto {
  @ApiProperty({ example: "<refreshToken from register or login response>" })
  @IsString() @IsNotEmpty() refreshToken!: string;
}
export class GoogleLoginDto {
  @ApiProperty({ example: "<valid Google ID token>", description: "Must be issued to the configured Google client ID." })
  @IsString() @IsNotEmpty() idToken!: string;
  @ApiProperty({ type: () => DeviceDto })
  @IsDefined() @IsObject() @ValidateNested() @Type(() => DeviceDto) device!: DeviceDto;
}
