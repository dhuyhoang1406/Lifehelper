import { Type } from "class-transformer";
import { IsDefined, IsEmail, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, Length, Matches, MinLength, ValidateNested } from "class-validator";
import { DevicePlatform } from "../../domain/enums/identity.enums";

export class DeviceDto {
  @IsString() @IsNotEmpty() @Length(1, 255) deviceId!: string;
  @IsEnum(DevicePlatform) platform!: DevicePlatform;
  @IsOptional() @IsString() @Length(1, 120) deviceName?: string;
}
export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @Length(8, 128)
  @Matches(/[a-z]/, { message: "password must contain a lowercase letter" })
  @Matches(/[A-Z]/, { message: "password must contain an uppercase letter" })
  @Matches(/\d/, { message: "password must contain a number" })
  password!: string;
  @IsString() @Length(1, 100) displayName!: string;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => DeviceDto) device!: DeviceDto;
}
export class LoginDto {
  @IsEmail() email!: string;
  @IsString() @Length(1, 128) password!: string;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => DeviceDto) device!: DeviceDto;
}
export class RefreshDto {
  @IsString() @IsNotEmpty() refreshToken!: string;
}
export class GoogleLoginDto {
  @IsString() @IsNotEmpty() idToken!: string;
  @ValidateNested() @Type(() => DeviceDto) device!: DeviceDto;
}
