import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { CompaniesService } from './companies.service';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  // Declared before ':id' so "search" isn't parsed as an id.
  @Get('search')
  search(@Query('q') q?: string) {
    return this.companiesService.search(q?.trim() ?? '');
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.companiesService.findById(id);
  }
}
