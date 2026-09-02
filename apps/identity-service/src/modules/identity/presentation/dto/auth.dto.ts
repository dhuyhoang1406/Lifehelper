import { Type } from "class-transformer";
import { IsDefined, IsEmail, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, Length, MinLength, ValidateNested } from "class-validator";
import { DevicePlatform } from "../../domain/enums/identity.enums";

export class DeviceDto {
  @IsString() @IsNotEmpty() @Length(1, 255) deviceId!: string;
  @IsEnum(DevicePlatform) platform!: DevicePlatform;
  @IsOptional() @IsString() @Length(1, 120) deviceName?: string;
}
export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @Length(8, 128) password!: string;
  @IsString() @Length(1, 100) displayName!: string;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => DeviceDto) device!: DeviceDto;
}
