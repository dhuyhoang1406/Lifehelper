import { ApiProperty } from "@nestjs/swagger";
import { IsHash, IsUUID } from "class-validator";

export class AIActionIdDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  id!: string;
}
export class AIActionDecisionDto {
  @ApiProperty({
    description: "SHA-256 hash returned in the pending action payload",
  })
  @IsHash("sha256")
  payloadHash!: string;
}
