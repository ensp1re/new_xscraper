export interface Mention {
  id?: string;
  username?: string;
  name?: string;
}

export interface Photo {
  id?: string;
  url?: string;
}

export interface QuotedStatus {
  bookmarkCount?: number;
  conversationId?: string;
  id?: string;
  hashtags?: string[];
  likes?: number;
  mentions?: Mention[];
  name?: string;
  permanentUrl?: string;
  photos?: Photo[];
  replies?: number;
  retweets?: number;
  text?: string;
  thread?: any[];
  urls?: any[];
  userId?: string;
  username?: string;
  videos?: any[];
  isQuoted?: boolean;
  isReply?: boolean;
  isRetweet?: boolean;
  isPin?: boolean;
  sensitiveContent?: boolean;
  timeParsed?: string;
  timestamp?: number;
  html?: string;
  views?: number;
}

export interface TweetProfileResponse {
  bookmarkCount?: number;
  conversationId?: string;
  id?: string;
  hashtags?: string[];
  likes?: number;
  mentions?: Mention[];
  name?: string;
  permanentUrl?: string;
  photos?: Photo[];
  replies?: number;
  retweets?: number;
  text?: string;
  thread?: any[];
  urls?: any[];
  userId?: string;
  username?: string;
  videos?: any[];
  isQuoted?: boolean;
  isReply?: boolean;
  isRetweet?: boolean;
  isPin?: boolean;
  sensitiveContent?: boolean;
  timeParsed?: string;
  timestamp?: number;
  quotedStatusId?: string;
  html?: string;
  views?: number;
  quotedStatus?: QuotedStatus;
}
