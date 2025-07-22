import {
  Controller,
  Get,
  Query,
  UseGuards,
  Post,
  Body,
  Param,
  Delete,
  Put,
  HttpStatus,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { TwitterService } from './twitter.service';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiQuery,
  ApiParam,
  ApiBody,
  ApiHeader,
  ApiSecurity,
} from '@nestjs/swagger';
import { SearchTweetsDto } from './dto/search-tweets.dto';
import { TweetResponseDto } from './dto/tweet-response.dto';
import { TwitterAccountDto } from './dto/twitter-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { SearchMode } from './enums/search-mode.enum';
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { TweetProfileResponse } from 'src/interfaces/main.interface';
import { Profile, Tweet } from 'agent-twitter-client';

@ApiTags('twitter')
@Controller('twitter')
@ApiHeader({
  name: 'X-API-Key',
  description: 'API Key for authentication (admin users have unlimited access)',
  required: true,
})
@ApiSecurity('X-API-Key')
@UseGuards(ApiKeyGuard)
export class TwitterController {
  constructor(private readonly twitterService: TwitterService) {}

  // Get tweets by search query
  @Get('tweets/advanced_search')
  @ApiOperation({ summary: 'Search for tweets' })
  @ApiQuery({
    name: 'query',
    required: true,
    description: 'Twitter search query',
  })
  @ApiQuery({
    name: 'mode',
    required: false,
    enum: SearchMode,
    description: 'Search mode (Latest, Top)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Pagination cursor',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns an array of tweets matching the search criteria',
    type: [TweetResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 429, description: 'Too Many Requests' })
  @ApiResponse({ status: 500, description: 'Internal Server Error' })
  async searchTweets(@Query() searchDto: SearchTweetsDto): Promise<{
    tweets: TweetResponseDto[];
    next?: string;
    previous?: string;
  }> {
    try {
      return this.twitterService.searchTweets(
        searchDto.query,
        searchDto.mode,
        searchDto.cursor,
      );
    } catch (error) {
      Logger.error(`Error in searchTweets: ${error.message}`, error);
      throw error;
    }
  }

  // Get quotes for a specific tweet ID
  @Get('tweets/:tweetId/quotes')
  @ApiOperation({ summary: 'Get quotes for a specific tweet ID' })
  @ApiParam({ name: 'tweetId', description: 'Twitter tweet ID' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Pagination cursor',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns an array of quotes for the specified tweet ID',
    type: [Object],
  })
  @ApiResponse({ status: 404, description: 'Quotes not found' })
  async getTweetQuotes(
    @Param('tweetId') tweetId: string,
    @Query('cursor') cursor?: string,
  ): Promise<{
    quotes: Tweet[];
    next?: string;
  } | null> {
    try {
      Logger.log(`Fetching quotes for tweet ID: ${tweetId}, cursor: ${cursor}`);
      return await this.twitterService.getTweetQuotes(tweetId, cursor);
    } catch (error) {
      Logger.error(`Error in getTweetQuotes: ${error.message}`, error);
      throw error;
    }
  }

  // Get replies for a specific tweet ID
  @Get('tweets/:tweetId/replies')
  @ApiOperation({ summary: 'Get replies for a specific tweet ID' })
  @ApiParam({ name: 'tweetId', description: 'Twitter tweet ID' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Pagination cursor',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns an array of replies for the specified tweet ID',
    type: [Object],
  })
  @ApiResponse({ status: 404, description: 'Replies not found' })
  async getTweetReplies(
    @Param('tweetId') tweetId: string,
    @Query('cursor') cursor?: string,
  ): Promise<{
    replies: Tweet[];
    next?: string;
  } | null> {
    try {
      Logger.log(
        `Fetching replies for tweet ID: ${tweetId}, cursor: ${cursor}`,
      );
      return await this.twitterService.getTweetReplies(tweetId, cursor);
    } catch (error) {
      Logger.error(`Error in getTweetReplies: ${error.message}`, error);
      throw error;
    }
  }

  // Get Twitter profile by username
  @Get('users/profile_by_username/:username')
  @ApiOperation({ summary: 'Get Twitter profile by username' })
  @ApiParam({ name: 'username', description: 'Twitter username' })
  @ApiResponse({
    status: 200,
    description: 'Returns the Twitter profile',
    type: Object,
  })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getProfile(@Param('username') username: string): Promise<any | null> {
    try {
      return await this.twitterService.getProfile(username);
    } catch (error) {
      Logger.error(`Error in getProfile: ${error.message}`, error);
      throw error;
    }
  }

  // Get tweets for a specific username with a maximum count
  @Get('users/tweets/:username')
  @ApiOperation({ summary: 'Get tweets for a specific username' })
  @ApiParam({ name: 'username', description: 'Twitter username' })
  @ApiQuery({
    name: 'maxTweets',
    required: false,
    description: 'Number of tweets to fetch (default: 20, max: 200)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns an array of tweets for the specified username',
    type: [Object],
  })
  @ApiResponse({ status: 404, description: 'Tweets not found' })
  async getTweets(
    @Param('username') username: string,
    @Query('maxTweets') maxTweets: number = 20,
  ): Promise<TweetProfileResponse[] | null> {
    try {
      if (maxTweets > 200) {
        throw new Error('Count exceeds the maximum limit of 200');
      }
      return await this.twitterService.getTweets(username, maxTweets);
    } catch (error) {
      Logger.error(`Error in getTweets: ${error.message}`, error);
      throw error;
    }
  }

  // Get replies for a specific username
  @Get('users/replies/:username')
  @ApiOperation({ summary: 'Get replies for a specific username' })
  @ApiParam({ name: 'username', description: 'Twitter username' })
  @ApiQuery({
    name: 'count',
    required: false,
    description: 'Number of tweets and replies to fetch (default: 10, max: 50)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Returns an array of tweets and replies for the specified username',
    type: [Object],
  })
  @ApiResponse({ status: 404, description: 'Tweets and replies not found' })
  async getTweetsAndReplies(
    @Param('username') username: string,
    @Query('count') count: number = 10,
  ): Promise<any[] | null> {
    try {
      if (count > 50) {
        count = 50;
      }
      Logger.log(`Fetching replies for username: ${username}, count: ${count}`);

      return await this.twitterService.getTweetsAndReplies(username, count);
    } catch (error) {
      Logger.error(`Error in getTweetsAndReplies: ${error.message}`, error);
      throw error;
    }
  }

  // Get the latest tweet for a specific username
  @Get('users/latest_tweet/:username')
  @ApiOperation({ summary: 'Get the latest tweet for a specific username' })
  @ApiParam({ name: 'username', description: 'Twitter username' })
  @ApiResponse({
    status: 200,
    description: 'Returns the latest tweet for the specified username',
    type: Object,
  })
  @ApiResponse({ status: 404, description: 'Tweet not found' })
  async getLatestTweet(
    @Param('username') username: string,
  ): Promise<TweetProfileResponse | null> {
    try {
      Logger.log(`Fetching latest tweet for username: ${username}`);
      return await this.twitterService.getLatestTweet(username);
    } catch (error) {
      Logger.error(`Error in getLatestTweet: ${error.message}`, error);
      throw error;
    }
  }

  // Get Twitter profile by user ID
  @Get('users/profile_by_userid/:userId')
  @ApiOperation({ summary: 'Get Twitter profile by user ID' })
  @ApiParam({ name: 'userId', description: 'Twitter user ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the Twitter profile for the specified user ID',
    type: Object,
  })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getProfileByUserId(
    @Param('userId') userId: string,
  ): Promise<Profile | null> {
    try {
      Logger.log(`Fetching profile for user ID: ${userId}`);
      return await this.twitterService.getProfileByUserId(userId);
    } catch (error) {
      Logger.error(`Error in getProfileByUserId: ${error.message}`, error);
      throw error;
    }
  }

  // Get tweets for a specific user ID
  @Get('users/tweets_by_user_id/:userId')
  @ApiOperation({ summary: 'Get tweets for a specific user ID' })
  @ApiParam({ name: 'userId', description: 'Twitter user ID' })
  @ApiQuery({
    name: 'maxTweets',
    required: false,
    description: 'Maximum number of tweets to fetch (default: 10, max: 100)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Pagination cursor',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns an array of tweets for the specified user ID',
  })
  @ApiResponse({ status: 404, description: 'Tweets not found' })
  async getTweetsByUserId(
    @Param('userId') userId: string,
    @Query('maxTweets') maxTweets: number = 10,
    @Query('cursor') cursor?: string,
  ): Promise<{
    tweets: Tweet[];
    next?: string;
  }> {
    try {
      if (maxTweets > 100) {
        maxTweets = 100;
      }
      Logger.log(
        `Fetching tweets for user ID: ${userId}, maxTweets: ${maxTweets}, cursor: ${cursor}`,
      );
      return await this.twitterService.getUserTweetsByUserId(
        userId,
        maxTweets,
        cursor,
      );
    } catch (error) {
      Logger.error(`Error in getTweetsByUserId: ${error.message}`, error);
      throw error;
    }
  }

  // Get a specific tweet by tweet ID
  @Get('tweets/:tweetId')
  @ApiOperation({ summary: 'Get a specific tweet by tweet ID' })
  @ApiParam({ name: 'tweetId', description: 'Twitter tweet ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the tweet for the specified tweet ID',
    type: Object,
  })
  @ApiResponse({ status: 404, description: 'Tweet not found' })
  async getTweet(@Param('tweetId') tweetId: string): Promise<Tweet | null> {
    try {
      Logger.log(`Fetching tweet with ID: ${tweetId}`);
      return await this.twitterService.getTweet(tweetId);
    } catch (error) {
      Logger.error(`Error in getTweet: ${error.message}`, error);
      throw error;
    }
  }

  // Get following profiles for a specific user ID
  @Get('users/following/:userId')
  @ApiOperation({ summary: 'Get following profiles for a specific user ID' })
  @ApiParam({ name: 'userId', description: 'Twitter user ID' })
  @ApiQuery({
    name: 'maxProfiles',
    required: false,
    description: 'Maximum number of profiles to fetch (default: 10, max: 100)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Pagination cursor',
  })
  @ApiResponse({
    status: 200,
    description:
      'Returns an array of following profiles for the specified user ID',
  })
  @ApiResponse({ status: 404, description: 'Following profiles not found' })
  async getProfileFollowing(
    @Param('userId') userId: string,
    @Query('maxProfiles') maxProfiles: number = 20,
    @Query('cursor') cursor?: string,
  ): Promise<{
    profiles: Profile[];
    next?: string;
  } | null> {
    try {
      if (maxProfiles > 100) {
        maxProfiles = 100;
      }
      Logger.log(
        `Fetching following profiles for user ID: ${userId}, maxProfiles: ${maxProfiles}, cursor: ${cursor}`,
      );
      return await this.twitterService.getProfileFollowing(
        userId,
        maxProfiles,
        cursor,
      );
    } catch (error) {
      Logger.error(`Error in getProfileFollowing: ${error.message}`, error);
      throw error;
    }
  }

  // Get followers for a specific user ID
  @Get('users/followers/:userId')
  @ApiOperation({ summary: 'Get followers for a specific user ID' })
  @ApiParam({ name: 'userId', description: 'Twitter user ID' })
  @ApiQuery({
    name: 'maxProfiles',
    required: false,
    description: 'Maximum number of profiles to fetch (default: 10, max: 100)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Pagination cursor',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns an array of followers for the specified user ID',
  })
  @ApiResponse({ status: 404, description: 'Followers not found' })
  async getProfileFollowers(
    @Param('userId') userId: string,
    @Query('maxProfiles') maxProfiles: number = 20,
    @Query('cursor') cursor?: string,
  ): Promise<{
    profiles: Profile[];
    next?: string;
  } | null> {
    try {
      Logger.log(
        `Fetching followers for user ID: ${userId}, maxProfiles: ${maxProfiles}, cursor: ${cursor}`,
      );
      return await this.twitterService.getProfileFollowers(
        userId,
        maxProfiles,
        cursor,
      );
    } catch (error) {
      Logger.error(`Error in getProfileFollowers: ${error.message}`, error);
      throw error;
    }
  }

  // Get accounts for login client
  @Get('accounts')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get all Twitter accounts' })
  @ApiResponse({
    status: 200,
    description: 'Returns all Twitter accounts',
    type: [TwitterAccountDto],
  })
  async getAllAccounts(): Promise<TwitterAccountDto[]> {
    return this.twitterService.getAllAccounts();
  }

  // Get Twitter account for login by username
  @Get('accounts/:username')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get Twitter account by username' })
  @ApiParam({ name: 'username', description: 'Twitter account username' })
  @ApiResponse({
    status: 200,
    description: 'Returns the Twitter account',
    type: TwitterAccountDto,
  })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async getAccountByUsername(
    @Param('username') username: string,
  ): Promise<TwitterAccountDto> {
    return this.twitterService.getAccountByUsername(username);
  }

  // Add a new Twitter account for login
  @Post('accounts')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Add a new Twitter account' })
  @ApiBody({ type: TwitterAccountDto })
  @ApiResponse({
    status: 201,
    description: 'Account created successfully',
    type: TwitterAccountDto,
  })
  async addAccount(
    @Body() accountDto: TwitterAccountDto,
  ): Promise<TwitterAccountDto> {
    return this.twitterService.addAccount(accountDto);
  }

  // Update an existing Twitter account for login
  @Put('accounts/:username')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update a Twitter account' })
  @ApiParam({ name: 'username', description: 'Twitter account username' })
  @ApiBody({ type: UpdateAccountDto })
  @ApiResponse({
    status: 200,
    description: 'Account updated successfully',
    type: TwitterAccountDto,
  })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async updateAccount(
    @Param('username') username: string,
    @Body() updateDto: UpdateAccountDto,
  ): Promise<TwitterAccountDto> {
    return this.twitterService.updateAccount(username, updateDto);
  }

  // Delete a Twitter account for login
  @Delete('accounts/:username')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Twitter account' })
  @ApiParam({ name: 'username', description: 'Twitter account username' })
  @ApiResponse({ status: 204, description: 'Account deleted successfully' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async deleteAccount(@Param('username') username: string): Promise<void> {
    return this.twitterService.deleteAccount(username);
  }

  // Clear cookies for a specific account
  @Post('accounts/:username/clear_cookies')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Clear cookies for a specific account' })
  @ApiParam({ name: 'username', description: 'Twitter account username' })
  @ApiResponse({ status: 200, description: 'Cookies cleared successfully' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async clearCookies(@Param('username') username: string): Promise<void> {
    try {
      await this.twitterService.clearCookies(username);
    } catch (error) {
      Logger.error(`Error in clearCookies: ${error.message}`, error);
      throw error;
    }
  }

  // Clear cookies for all accounts
  @Post('accounts/clear_all_cookies')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Clear cookies for all accounts' })
  @ApiResponse({ status: 200, description: 'All cookies cleared successfully' })
  async clearAllCookies(): Promise<void> {
    try {
      await this.twitterService.clearAllCookies();
    } catch (error) {
      Logger.error(`Error in clearAllCookies: ${error.message}`, error);
      throw error;
    }
  }

  // Set proxy URL for Twitter API requests
  @Post('proxy')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Set proxy URL' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        proxyUrl: {
          type: 'string',
          example: 'http://username:password@host:port',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Proxy set successfully' })
  async setProxy(
    @Body('proxyUrl') proxyUrl: string,
  ): Promise<{ success: boolean }> {
    await this.twitterService.setProxy(proxyUrl);
    return { success: true };
  }

  // Delete all locked/suspended accounts
  @Delete('admin/accounts/locked')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Delete all locked/suspended accounts (Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Locked accounts deleted successfully',
    schema: {
      type: 'object',
      properties: {
        deletedCount: { type: 'number' },
        remainingCount: { type: 'number' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @HttpCode(HttpStatus.OK)
  async deleteLockedAccounts(): Promise<{
    deletedCount: number;
    remainingCount: number;
    message: string;
  }> {
    try {
      return await this.twitterService.deleteLockedAccounts();
    } catch (error) {
      Logger.error(`Error in deleteLockedAccounts: ${error.message}`, error);
      throw error;
    }
  }
}
