import { IsIn } from 'class-validator';

export class ResolveReportDto {
  // 'delete' removes the reported content (tombstone for a comment with
  // replies, hard delete otherwise); 'dismiss' just closes the report.
  @IsIn(['delete', 'dismiss'])
  action: 'delete' | 'dismiss';
}
