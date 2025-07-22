import { Module } from '@nestjs/common';
import { TwitterController } from './twitter.controller';
import { TwitterService } from './twitter.service';
import { TwitterClientProvider } from './twitter-client.provider';
import { ApiKeysModule } from 'src/api-keys/api-keys.module';

@Module({
  imports: [ApiKeysModule],
  controllers: [TwitterController],
  providers: [TwitterService, TwitterClientProvider],
  exports: [TwitterService],
})
export class TwitterModule {}
