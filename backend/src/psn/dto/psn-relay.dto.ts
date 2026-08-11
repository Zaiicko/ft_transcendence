import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { LinkPsnDto } from './link-psn.dto';

// One Sony call the browser made on the backend's behalf, reported back
// as-is: which call (`id`), whether Sony answered 2xx (`ok`), and the raw
// parsed JSON body (untyped on purpose — it's whatever Sony sent, parsed
// downstream by PsnApiService's parse* methods).
export class PsnRelayResultDto {
  @IsString()
  id!: string;

  @IsBoolean()
  ok!: boolean;

  // Whatever Sony sent back, parsed as JSON (null when ok=false and the
  // relay's own fetch/JSON-parse failed) — shape varies per call, so this
  // just needs a decorator to survive whitelist:true+forbidNonWhitelisted;
  // @IsOptional accepts any value, including null.
  @IsOptional()
  body: unknown;
}

export class SubmitPsnRelayDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PsnRelayResultDto)
  results!: PsnRelayResultDto[];
}

// POST /psn/link's body: the Online ID being linked + what the browser's
// relayed search call answered.
export class LinkPsnRelayDto extends LinkPsnDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PsnRelayResultDto)
  results!: PsnRelayResultDto[];
}
