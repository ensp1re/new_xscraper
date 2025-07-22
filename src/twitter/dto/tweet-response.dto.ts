import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class MentionDto {
  @ApiProperty({ example: 'SuccinctLabs' })
  username: string;

  @ApiProperty({ example: '1234567890' })
  id?: string;
}

class MediaDto {
  @ApiProperty({ example: 'https://pbs.twimg.com/media/GlWfEcCWMAAJQgC.jpg' })
  url: string;
}

export class TweetResponseDto {
  @ApiProperty({ example: '1899058755662131354' })
  id: string;

  @ApiProperty({ example: '1899058755662131354' })
  conversationId: string;

  @ApiProperty({ example: 'Enspire ⚡' })
  name: string;

  @ApiProperty({ example: '0xEnsp1re' })
  username: string;

  @ApiProperty({
    example: 'https://twitter.com/0xEnsp1re/status/1899058755662131354',
  })
  permanentUrl: string;

  @ApiProperty({
    example:
      "I don't know what you're doing in crypto if you're not using @SuccinctLabs",
  })
  text: string;

  @ApiPropertyOptional({
    example: `I don't know what you're doing in crypto if you're not using <a href="https://twitter.com/SuccinctLabs">@SuccinctLabs</a>`,
  })
  html?: string;

  @ApiProperty({ example: 2 })
  likes: number;

  @ApiProperty({ example: 1 })
  retweets: number;

  @ApiProperty({ example: 0 })
  replies: number;

  @ApiPropertyOptional({ example: 0 })
  bookmarkCount?: number;

  @ApiPropertyOptional({ example: 130 })
  views?: number;

  @ApiPropertyOptional({ example: 1741257574 })
  timestamp?: number;

  @ApiPropertyOptional({ example: '2025-03-06T10:39:34.000Z' })
  timeParsed?: Date;

  @ApiPropertyOptional({ type: [String] })
  hashtags?: string[];

  @ApiPropertyOptional({ type: [MentionDto] })
  mentions?: MentionDto[];

  @ApiPropertyOptional({ type: [MediaDto] })
  photos?: MediaDto[];

  @ApiPropertyOptional({ type: [MediaDto] })
  videos?: MediaDto[];

  @ApiPropertyOptional({ example: false })
  isQuoted?: boolean;

  @ApiPropertyOptional({ example: false })
  isReply?: boolean;

  @ApiPropertyOptional({ example: false })
  isRetweet?: boolean;

  @ApiPropertyOptional({ example: false })
  isPin?: boolean;

  @ApiPropertyOptional({ example: false })
  sensitiveContent?: boolean;
}
