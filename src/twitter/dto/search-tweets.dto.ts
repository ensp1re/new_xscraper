import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { SearchMode } from '../enums/search-mode.enum';

export class SearchTweetsDto {
  @ApiProperty({
    description: 'Twitter search query',
    example: 'from:elonmusk (tesla OR spacex) -filter:replies',
    examples: {
      userTweets: {
        summary: 'Get tweets from a specific user',
        value: 'from:elonmusk',
      },
      keywordSearch: {
        summary: 'Search for keywords',
        value: 'bitcoin ethereum',
      },
      advancedSearch: {
        summary: 'Advanced search',
        value: 'from:0xEnsp1re (succinct OR SuccinctLabs) -filter:replies',
      },
    },
  })
  @IsString()
  query: string;

  @ApiProperty({
    description: 'Search mode',
    enum: SearchMode,
    enumName: 'SearchMode',
    default: SearchMode.Latest,
    examples: {
      latest: {
        summary: 'Latest tweets',
        value: SearchMode.Latest,
      },
      top: {
        summary: 'Top tweets',
        value: SearchMode.Top,
      },
    },
  })
  @IsEnum(SearchMode)
  @IsOptional()
  @Type(() => Number)
  mode?: SearchMode = SearchMode.Latest;

  @ApiProperty({
    description: 'Pagination cursor',
    default: '',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}
