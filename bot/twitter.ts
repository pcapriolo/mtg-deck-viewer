/**
 * X/Twitter API client — handles auth, mention polling, image extraction, and replies.
 *
 * Uses twitter-api-v2 for OAuth 2.0 user context (needed for posting replies).
 * The bot uses app-level Bearer token for reading and user tokens for writing.
 */

import { TwitterApi } from "twitter-api-v2";

export interface MentionTweet {
  id: string;
  text: string;
  authorId: string;
  authorUsername: string;
  conversationId: string;
  inReplyToId?: string;
  imageUrls: string[];
  createdAt: string;
}

export function createClient(): {
  reader: TwitterApi;
  writer: TwitterApi;
} {
  const bearerToken = requireEnv("X_BEARER_TOKEN");
  const reader = new TwitterApi(bearerToken);

  // OAuth 1.0a user context for posting replies
  const writer = new TwitterApi({
    appKey: requireEnv("X_APP_KEY"),
    appSecret: requireEnv("X_APP_SECRET"),
    accessToken: requireEnv("X_ACCESS_TOKEN"),
    accessSecret: requireEnv("X_ACCESS_SECRET"),
  });

  return { reader, writer };
}

/**
 * Fetch recent mentions of the bot account since a given tweet ID.
 * Returns newest first.
 */
export async function fetchMentions(
  reader: TwitterApi,
  botUserId: string,
  sinceId?: string
): Promise<MentionTweet[]> {
  const params: Record<string, string> = {
    "tweet.fields": "created_at,conversation_id,in_reply_to_user_id,referenced_tweets",
    "media.fields": "url,type",
    expansions: "attachments.media_keys,author_id",
    "user.fields": "username",
    max_results: "20",
  };
  if (sinceId) params.since_id = sinceId;

  const response = await reader.v2.userMentionTimeline(botUserId, params);

  const tweets: MentionTweet[] = [];

  // Build media lookup from includes
  const mediaMap = new Map<string, string>();
  if (response.includes?.media) {
    for (const m of response.includes.media) {
      if (m.type === "photo" && m.url) {
        mediaMap.set(m.media_key, m.url);
      }
    }
  }

  // Build user lookup from includes
  const userMap = new Map<string, string>();
  if (response.includes?.users) {
    for (const u of response.includes.users) {
      userMap.set(u.id, u.username);
    }
  }

  for (const tweet of response.data?.data ?? []) {
    const imageUrls: string[] = [];
    const mediaKeys = (tweet as any).attachments?.media_keys ?? [];
    for (const key of mediaKeys) {
      const url = mediaMap.get(key);
      if (url) imageUrls.push(url);
    }

    tweets.push({
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id ?? "",
      authorUsername: userMap.get(tweet.author_id ?? "") ?? "",
      conversationId: (tweet as any).conversation_id ?? tweet.id,
      inReplyToId: (tweet as any).referenced_tweets?.find(
        (r: any) => r.type === "replied_to"
      )?.id,
      imageUrls,
      createdAt: (tweet as any).created_at ?? "",
    });
  }

  return tweets;
}

/**
 * Fetch a single tweet by ID with its images.
 * Used to walk up the reply chain and find the tweet with the decklist image.
 */
export async function fetchTweet(
  reader: TwitterApi,
  tweetId: string
): Promise<MentionTweet | null> {
  try {
    const response = await reader.v2.singleTweet(tweetId, {
      "tweet.fields": "created_at,conversation_id,referenced_tweets,author_id",
      "media.fields": "url,type",
      expansions: "attachments.media_keys,author_id",
      "user.fields": "username",
    });

    const tweet = response.data;
    if (!tweet) return null;

    const imageUrls: string[] = [];
    const mediaMap = new Map<string, string>();
    if (response.includes?.media) {
      for (const m of response.includes.media) {
        if (m.type === "photo" && m.url) {
          mediaMap.set(m.media_key, m.url);
        }
      }
    }
    const mediaKeys = (tweet as any).attachments?.media_keys ?? [];
    for (const key of mediaKeys) {
      const url = mediaMap.get(key);
      if (url) imageUrls.push(url);
    }

    const userMap = new Map<string, string>();
    if (response.includes?.users) {
      for (const u of response.includes.users) {
        userMap.set(u.id, u.username);
      }
    }

    return {
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id ?? "",
      authorUsername: userMap.get(tweet.author_id ?? "") ?? "",
      conversationId: (tweet as any).conversation_id ?? tweet.id,
      inReplyToId: (tweet as any).referenced_tweets?.find(
        (r: any) => r.type === "replied_to"
      )?.id,
      imageUrls,
      createdAt: (tweet as any).created_at ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Reply to a tweet with the deck viewer link.
 */
export async function replyWithLink(
  writer: TwitterApi,
  replyToId: string,
  deckUrl: string,
  replyText: string
): Promise<string> {
  // Replace the "▶ View deck →" placeholder with the actual URL
  const text = replyText.replace("▶ View deck →", `▶ View deck → ${deckUrl}`);

  const response = await writer.v2.tweet({
    text,
    reply: { in_reply_to_tweet_id: replyToId },
  });

  return response.data.id;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}
