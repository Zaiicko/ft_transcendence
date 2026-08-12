import { IsBoolean } from 'class-validator';

// Toggles whether OTHER users can see this account's linked libraries.
export class LibraryVisibilityDto {
  @IsBoolean()
  public: boolean;
}
