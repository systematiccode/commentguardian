import { Devvit, CommentCreate, SettingScope } from '@devvit/public-api';

type FlagType = 'SCAM_ACCUSATION' | 'HARASSMENT' | 'VALUE_POLICING';

interface UserConduct {
  score: number;
  scamFlags: number;
  harassmentFlags: number;
  valueFlags: number;
  lastUpdated: string; // ISO
  lastAlertScore?: number; // highest threshold we’ve already alerted on
}

interface ConductEvent {
  commentId: string;
  permalink: string;
  flags: FlagType[];
  delta: number;
  createdAt: string; // ISO
  commentSnippet?: string;
  postTitle?: string;
}

const CONDUCT_USERS_KEY = 'conduct_users';

function conductKeyForUser(username: string): string {
  return `conduct:${username.toLowerCase()}`;
}

function conductEventsKeyForUser(username: string): string {
  return `conduct_events:${username.toLowerCase()}`;
}

function autoReplyKey(username: string, postId: string): string {
  return `autoreply:${username.toLowerCase()}:${postId}`;
}

const DEFAULT_AUTO_REPLY_TEXT =
  "Hi u/{username}, friendly reminder from r/{subreddit}:\n\n" +
  "- Feedback on trade value is welcome, but please keep it **polite** and focused on the **Pokémon**, not the person.\n" +
  "- Avoid calling people scammers unless there is clear evidence of a rule-breaking scam.\n\n" +
  "If you have concerns about a trade, please **report the post or comment** and let the mod team review it.";

// ---------- Settings ----------

Devvit.addSettings([
  //
  // 🔹 Detection & Scoring
  //
  {
    type: 'group',
    label: 'Detection & scoring',
    fields: [
      {
        type: 'string',
        name: 'scam_phrases',
        label: 'Scam accusation phrases',
        scope: SettingScope.Installation,
        defaultValue:
          'scammer,this is a scam,such a scam,you are scamming,youre scamming',
        helpText:
          'Comma or newline separated list. These phrases will be treated as scam accusations.',
      },
      {
        type: 'boolean',
        name: 'enable_scam_flags',
        label: 'Enable scam accusation detection & scoring',
        scope: SettingScope.Installation,
        defaultValue: true,
      },
      {
        type: 'string',
        name: 'score_scam',
        label: 'Scam accusation score weight',
        scope: SettingScope.Installation,
        defaultValue: '3',
        helpText: 'Integer. Default is 3 points per flagged comment.',
      },

      {
        type: 'string',
        name: 'harassment_phrases',
        label: 'Harassment / insult phrases',
        scope: SettingScope.Installation,
        defaultValue:
          'are you stupid,you are stupid,youre stupid,you are dumb,youre dumb,you must be blind,touch grass',
        helpText:
          'Comma or newline separated list of phrases that count as harassment/insults.',
      },
      {
        type: 'boolean',
        name: 'enable_harassment_flags',
        label: 'Enable harassment detection & scoring',
        scope: SettingScope.Installation,
        defaultValue: true,
      },
      {
        type: 'string',
        name: 'score_harassment',
        label: 'Harassment score weight',
        scope: SettingScope.Installation,
        defaultValue: '4',
        helpText: 'Integer. Default is 4 points per flagged comment.',
      },

      {
        type: 'string',
        name: 'value_policing_phrases',
        label: 'Aggressive value-policing phrases',
        scope: SettingScope.Installation,
        defaultValue:
          'ripoff,rip-off,trash offer,clown trade,terrible value,insane offer,this is ridiculous,greedy',
        helpText:
          'Comma or newline separated list of phrases used for aggressive value policing.',
      },
      {
        type: 'boolean',
        name: 'enable_policing_flags',
        label: 'Enable value-policing detection & scoring',
        scope: SettingScope.Installation,
        defaultValue: true,
      },
      {
        type: 'string',
        name: 'score_policing',
        label: 'Value-policing score weight',
        scope: SettingScope.Installation,
        defaultValue: '1',
        helpText: 'Integer. Default is 1 point per flagged comment.',
      },
    ],
  },

  //
  // 🔹 Moderation Actions & Filters
  //
  {
    type: 'group',
    label: 'Moderation actions & filters',
    fields: [
      {
        type: 'boolean',
        name: 'notify_via_modmail',
        label: 'Send Modmail alerts for flagged comments',
        scope: SettingScope.Installation,
        defaultValue: false,
        helpText:
          'If enabled, each flagged comment will generate a Modmail thread.',
      },
      {
        type: 'boolean',
        name: 'report_to_modqueue',
        label: 'Create a report in modqueue for flagged comments',
        scope: SettingScope.Installation,
        defaultValue: true,
        helpText:
          'If enabled, flagged comments will appear in the subreddit modqueue.',
      },
      {
        type: 'string',
        name: 'monitored_post_flairs',
        label: 'Only monitor specific POST flairs',
        scope: SettingScope.Installation,
        defaultValue: '',
        helpText:
          'Comma or newline separated list of post flair texts. If set, only comments on posts with these flairs are monitored.',
      },
      {
        type: 'boolean',
        name: 'delete_command_comments',
        label: 'Auto-remove !cg-* command comments from mods',
        scope: SettingScope.Installation,
        defaultValue: true,
        helpText:
          'If enabled, the bot will remove mod command comments like !cg-top, !cg-user, etc. after processing.',
      },
    ],
  },

  //
  // 🔹 Score Reset & Threshold Alerts
  //
  {
    type: 'group',
    label: 'Score reset & alerts',
    fields: [
      {
        type: 'string',
        name: 'score_reset_days',
        label: 'Score reset window (days)',
        scope: SettingScope.Installation,
        defaultValue: '',
        helpText:
          'Number of days after which a user score is reset. Leave blank or 0 to never auto-reset.',
      },
      {
        type: 'boolean',
        name: 'alert_threshold_enabled',
        label: 'Enable score threshold alerts (Modmail)',
        scope: SettingScope.Installation,
        defaultValue: false,
        helpText:
          'If enabled, the bot will send Modmail when a user crosses the threshold score.',
      },
      {
        type: 'string',
        name: 'alert_threshold_score',
        label: 'Threshold score',
        scope: SettingScope.Installation,
        defaultValue: '',
        helpText:
          'Score at which to alert mods (e.g., 20). Leave blank or 0 to disable alerts.',
      },
    ],
  },

  //
  // 🔹 Auto Replies & Behaviour (what we were calling Stage 3)
  //
  {
    type: 'group',
    label: 'Auto replies & behaviour',
    fields: [
      {
        type: 'boolean',
        name: 'auto_reply_enabled',
        label: 'Enable auto-reply to flagged comments',
        scope: SettingScope.Installation,
        defaultValue: false,
        helpText:
          'If enabled, the bot will reply to some flagged comments with a gentle reminder.',
      },
      {
        type: 'string',
        name: 'auto_reply_text',
        label: 'Auto-reply text (Markdown)',
        scope: SettingScope.Installation,
        defaultValue: DEFAULT_AUTO_REPLY_TEXT,
        helpText:
          'You can use {username} and {subreddit} placeholders. This text will be posted as the bot reply.',
      },
      {
        type: 'string',
        name: 'behavior_window_days',
        label: 'Behaviour window (days)',
        scope: SettingScope.Installation,
        defaultValue: '30',
        helpText:
          'Number of days to consider when deciding if someone is a “first” or “repeat” offender.',
      },
      {
        type: 'boolean',
        name: 'auto_reply_on_first_offense',
        label: 'Reply on first offense within window',
        scope: SettingScope.Installation,
        defaultValue: false,
        helpText:
          'If enabled, the bot will reply even on the first flagged comment in the behaviour window.',
      },
      {
        type: 'boolean',
        name: 'auto_reply_on_repeat_offense',
        label: 'Reply on repeat offenses within window',
        scope: SettingScope.Installation,
        defaultValue: true,
        helpText:
          'If enabled, the bot will reply when the same user is flagged multiple times within the behaviour window.',
      },
      {
        type: 'boolean',
        name: 'auto_reply_include_soft_flags',
        label: 'Include soft flags (value policing) in auto-replies',
        scope: SettingScope.Installation,
        defaultValue: false,
        helpText:
          'If disabled (recommended), auto-replies only trigger for hard flags (scam accusations / harassment). Value-policing-only comments will still be reported/scored but will not get an auto-reply.',
      },


      {
        type: 'boolean',
        name: 'auto_reply_once_per_thread',
        label: 'Only reply once per user per post',
        scope: SettingScope.Installation,
        defaultValue: true,
        helpText:
          'If enabled, the bot will only reply once to a given user in a given post thread.',
      },
      {
        type: 'string',
        name: 'bot_username',
        label: 'Bot username (for loop prevention)',
        scope: SettingScope.Installation,
        defaultValue: 'commentguardian',
        helpText:
          'Exact Reddit username of the bot account running this Devvit app. Used to avoid the bot replying to itself.',
      },

    ],
  },

  //
  // 🔹 Stage 4 — Accuracy
  //
  {
    type: 'group',
    label: 'Stage 4 — Accuracy',
    fields: [
      {
        type: 'boolean',
        name: 'enable_word_boundary_matching',
        label: 'Enable word-boundary matching for single-word phrases',
        scope: SettingScope.Installation,
        defaultValue: true,
        helpText:
          'Reduces false positives by matching whole words for single-word phrases (e.g., scam, scammer) instead of substring matches.',
      },
      {
        type: 'boolean',
        name: 'enable_scam_negation_guard',
        label: 'Enable scam negation/context guard',
        scope: SettingScope.Installation,
        defaultValue: true,
        helpText:
          'If enabled, phrases like "not a scam" / "stop calling it a scam" will NOT be flagged as scam accusations.',
      },
    ],
  },

  //
  // 🔹 Stage 5 — Fairness
  //
  {
    type: 'group',
    label: 'Stage 5 — Fairness',
    fields: [
      {
        type: 'boolean',
        name: 'enable_trust_adjustment',
        label: 'Enable trust adjustment (confirmed-trade flair)',
        scope: SettingScope.Installation,
        defaultValue: true,
        helpText:
          'If enabled, users with high confirmed-trade flair are treated as more trusted for auto-replies and threshold alerts (still reported/scored normally).',
      },
      {
        type: 'number',
        name: 'trusted_trade_count_min',
        label: 'Trusted trade count minimum',
        scope: SettingScope.Installation,
        defaultValue: 20,
        helpText:
          'Minimum confirmed-trade count (from user flair text) for a user to be considered trusted.',
      },
      {
        type: 'number',
        name: 'trusted_alert_threshold_multiplier',
        label: 'Trusted alert threshold multiplier',
        scope: SettingScope.Installation,
        defaultValue: 2,
        helpText:
          'When threshold alerts are enabled, trusted users require threshold × this multiplier to trigger mod alerts.',
      },
      {
        type: 'boolean',
        name: 'enable_score_decay',
        label: 'Enable score decay (instead of only hard reset)',
        scope: SettingScope.Installation,
        defaultValue: false,
        helpText:
          'If enabled, the score will decay over time when a user is loaded (lazy decay). This is optional and can be used alongside score_reset_days.',
      },
      {
        type: 'number',
        name: 'score_decay_points_per_day',
        label: 'Score decay points per day',
        scope: SettingScope.Installation,
        defaultValue: 1,
        helpText:
          'How many points to subtract per day since lastUpdated (floored), when score decay is enabled.',
      },
    ],
  },
]);


Devvit.configure({
  redditAPI: true,
  modMail: true,
  kv: true,
});

// ---------- Helpers: settings & parsing ----------

async function loadPhraseList(
  context: Devvit.Context,
  key: string,
  fallback: string[]
): Promise<string[]> {
  const raw = (await context.settings.get(key)) as string | undefined;
  console.log('loadPhraseList:', key, 'raw =', raw);
  if (!raw) return fallback;

  const list = raw
    .split(/[\n\r,]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0);

  console.log('loadPhraseList:', key, 'parsed =', list);
  return list;
}


function normalizeText(input: string): string {
  // Lowercase, collapse whitespace, and normalize punctuation to spaces
  return (input ?? '')
    .toLowerCase()
    .replace(/[_*`~]/g, ' ') // markdown-ish chars
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^a-z0-9\s'-]/g, ' ') // keep letters/numbers/space/'/-
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function isWordBoundaryEnabled(context: Devvit.Context): Promise<boolean> {
  const v = (await context.settings.get('enable_word_boundary_matching')) as
    | boolean
    | undefined;
  return v !== false; // default true
}

function phraseMatches(textNorm: string, phrase: string, useWordBoundary: boolean): boolean {
  const p = (phrase ?? '').trim().toLowerCase();
  if (!p) return false;

  // Multi-word phrase: use includes on normalized text
  if (p.includes(' ')) {
    return textNorm.includes(p);
  }

  if (!useWordBoundary) {
    return textNorm.includes(p);
  }

  // Single word: enforce word boundary
  const re = new RegExp(`\\b${escapeRegex(p)}\\b`, 'i');
  return re.test(textNorm);
}

function scamNegationOrContext(textNorm: string): boolean {
  // If the comment is discouraging scam accusations, don't flag it as a scam accusation.
  // Keep this intentionally small + high-signal.
  const patterns: RegExp[] = [
    /\bnot\s+a\s+scam\b/i,
    /\bisn'?t\s+a\s+scam\b/i,
    /\bno\s+scam\b/i,
    /\bstop\s+calling\b.*\bscam\b/i,
    /\bdon'?t\s+call\b.*\bscam\b/i,
    /\bavoid\s+calling\b.*\bscam\b/i,
    /\bplease\s+don'?t\s+call\b.*\bscam\b/i,
  ];
  return patterns.some((re) => re.test(textNorm));
}

async function getResetWindowMs(
  context: Devvit.Context
): Promise<number | null> {
  const raw = (await context.settings.get(
    'score_reset_days'
  )) as string | undefined;
  console.log('getResetWindowMs: raw score_reset_days =', raw);

  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const days = parseInt(trimmed, 10);
  if (isNaN(days) || days <= 0) return null;

  const ms = days * 24 * 60 * 60 * 1000;
  console.log('getResetWindowMs: parsed days =', days, 'ms =', ms);
  return ms;
}

async function getBehaviorWindowMs(
  context: Devvit.Context
): Promise<number | null> {
  const raw = (await context.settings.get(
    'behavior_window_days'
  )) as string | undefined;
  console.log('getBehaviorWindowMs: raw behavior_window_days =', raw);

  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const days = parseInt(trimmed, 10);
  if (isNaN(days) || days <= 0) return null;

  const ms = days * 24 * 60 * 60 * 1000;
  console.log('getBehaviorWindowMs: parsed days =', days, 'ms =', ms);
  return ms;
}

async function getScoreWeight(
  context: Devvit.Context,
  key: string,
  fallback: number
): Promise<number> {
  const raw = (await context.settings.get(key)) as string | undefined;
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const value = parseInt(trimmed, 10);
  if (isNaN(value)) return fallback;
  return value;
}

async function getAlertThreshold(
  context: Devvit.Context
): Promise<number | null> {
  const enabled = (await context.settings.get(
    'alert_threshold_enabled'
  )) as boolean | undefined;
  const raw = (await context.settings.get(
    'alert_threshold_score'
  )) as string | undefined;

  console.log(
    'getAlertThreshold: enabled =',
    enabled,
    'raw alert_threshold_score =',
    raw
  );

  if (enabled === false) return null;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const n = parseInt(trimmed, 10);
  if (isNaN(n) || n <= 0) return null;

  return n;
}

/**
 * Resolve a username using:
 *  1) event.author?.name
 *  2) comment.getAuthorName()
 *  3) comment.author?.name
 *  4) comment.authorName
 */
async function resolveUsername(
  event: CommentCreate,
  comment: any
): Promise<string | undefined> {
  const eventAuthor: any = (event as any).author;

  console.log(
    'resolveUsername: starting with',
    'eventAuthorName=',
    eventAuthor?.name,
    'comment.author=',
    comment.author,
    'comment.authorName=',
    (comment as any).authorName
  );

  if (eventAuthor?.name) {
    console.log('resolveUsername: using event.author.name =', eventAuthor.name);
    return eventAuthor.name;
  }

  try {
    if ((comment as any).getAuthorName) {
      const apiName = await (comment as any).getAuthorName();
      console.log('resolveUsername: getAuthorName() returned =', apiName);
      if (apiName) {
        console.log('resolveUsername: using getAuthorName() =', apiName);
        return apiName;
      }
    } else {
      console.log('resolveUsername: comment.getAuthorName is not defined');
    }
  } catch (err) {
    console.log('resolveUsername: getAuthorName() threw error:', err);
  }

  if (comment.author?.name) {
    console.log('resolveUsername: using comment.author.name =', comment.author.name);
    return comment.author.name;
  }

  if ((comment as any).authorName) {
    console.log(
      'resolveUsername: using comment.authorName =',
      (comment as any).authorName
    );
    return (comment as any).authorName;
  }

  console.log('resolveUsername: username missing (fallbacks failed)');
  return undefined;
}


function extractFlairTextFromEvent(event: CommentCreate, comment: any): string {
  const eventAuthor: any = (event as any).author;

  const candidates: any[] = [
    eventAuthor?.flair?.text,
    eventAuthor?.flairText,
    eventAuthor?.userFlairText,
    (comment as any)?.authorFlair?.text,
    (comment as any)?.authorFlairText,
    (event as any)?.authorFlair?.text,
    (event as any)?.authorFlairText,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim();
    }
  }
  return '';
}

function parseTradeCountFromFlairText(flairText: string): number | null {
  if (!flairText) return null;
  const m = flairText.match(/(\d{1,6})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

async function getTrustContext(
  context: Devvit.Context,
  event: CommentCreate,
  comment: any,
  username?: string
): Promise<{ isTrusted: boolean; tradeCount: number | null; flairText: string }> {
  const enabled =
    ((await context.settings.get('enable_trust_adjustment')) as boolean | undefined) !== false;

  const flairText = extractFlairTextFromEvent(event, comment);
  const tradeCount = parseTradeCountFromFlairText(flairText);

  const minTrustedRaw = (await context.settings.get(
    'trusted_trade_count_min'
  )) as number | undefined;
  const minTrusted = typeof minTrustedRaw === 'number' && minTrustedRaw > 0 ? minTrustedRaw : 20;

  const isTrusted = enabled && tradeCount != null && tradeCount >= minTrusted;

  console.log(
    'trustContext:',
    'enabled=',
    enabled,
    'user=',
    username,
    'flairText=',
    flairText,
    'tradeCount=',
    tradeCount,
    'minTrusted=',
    minTrusted,
    'isTrusted=',
    isTrusted
  );

  return { isTrusted, tradeCount, flairText };
}

async function getTrustedThresholdMultiplier(context: Devvit.Context): Promise<number> {
  const raw = (await context.settings.get(
    'trusted_alert_threshold_multiplier'
  )) as number | undefined;
  if (typeof raw === 'number' && raw >= 1) return raw;
  return 2;
}


// ---------- Stage 3 helpers: reply text validation + rate-limit safe retry ----------

const AUTO_REPLY_COOLDOWN_UNTIL_KEY = 'autoreply_cooldown_until';

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRateLimitSeconds(err: any): number | null {
  const details =
    (err && (err.details || err.message || String(err))) as string | undefined;
  if (!details) return null;

  // Examples we’ve seen:
  // "RATELIMIT: ... Take a break for 5 seconds ..."
  const m = details.match(/break for\s+(\d+)\s+seconds?/i);
  if (m && m[1]) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

function isRateLimitError(err: any): boolean {
  const details = (err && (err.details || err.message || '')) as string;
  return /RATELIMIT/i.test(details);
}

function isNoTextError(err: any): boolean {
  const details = (err && (err.details || err.message || '')) as string;
  return /NO_TEXT/i.test(details);
}

function buildAutoReplyBody(
  templateSource: string,
  username: string,
  subredditName: string
): string {
  // Strict validation to prevent NO_TEXT and other empty-text issues.
  const safeTemplate = (templateSource ?? '').toString();
  const rendered = safeTemplate
    .replace(/{username}/g, username)
    .replace(/{subreddit}/g, subredditName)
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  const finalText = rendered.length > 0 ? `${rendered}

<!-- CommentGuardian:auto-reply -->` : '';

  return finalText;
}

async function getAutoReplyCooldownUntilMs(
  context: Devvit.Context
): Promise<number> {
  const kv = context.kvStore;
  if (!kv) return 0;
  const v = await kv.get<string>(AUTO_REPLY_COOLDOWN_UNTIL_KEY);
  if (!v) return 0;
  const n = parseInt(v, 10);
  if (isNaN(n) || n <= 0) return 0;
  return n;
}

async function setAutoReplyCooldownSeconds(
  context: Devvit.Context,
  seconds: number
): Promise<void> {
  const kv = context.kvStore;
  if (!kv) return;
  const s = Math.max(1, Math.min(3600, seconds)); // cap at 1h
  const until = Date.now() + s * 1000;
  await kv.put(AUTO_REPLY_COOLDOWN_UNTIL_KEY, String(until));
  console.log(
    'Stage3: global auto-reply cooldown set for',
    s,
    'seconds. untilMs =',
    until
  );
}

async function submitAutoReplyWithRetry(
  context: Devvit.Context,
  parentCommentId: string,
  replyBody: string,
  usernameForLogs: string
): Promise<void> {
  // IMPORTANT: Avoid using Comment.reply(string) because we’ve seen NO_TEXT even with non-empty strings.
  // Using submitComment with explicit {text} prevents the "NO_TEXT" gRPC error.
  const reddit = context.reddit;

  const trimmed = (replyBody ?? '').toString().trim();
  if (!trimmed) {
    console.log(
      'Stage3: submitAutoReplyWithRetry: replyBody empty after trim, skipping'
    );
    return;
  }

  // Single short retry for RATELIMIT.
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        'Stage3: posting auto-reply attempt',
        attempt,
        'for',
        usernameForLogs,
        'len=',
        trimmed.length
      );

      // @ts-ignore - submitComment exists in Devvit Reddit API runtime
      await (reddit as any).submitComment({ id: parentCommentId, text: trimmed });
      console.log('Stage3: auto-reply posted successfully for', usernameForLogs);
      return;
    } catch (err) {
      console.error('Stage3: error posting auto-reply (attempt ' + attempt + ')', err);

      // NO_TEXT should never retry: it means text wasn’t passed correctly.
      if (isNoTextError(err)) {
        console.log('Stage3: NO_TEXT error detected; will not retry');
        return;
      }

      if (isRateLimitError(err)) {
        const sec = parseRateLimitSeconds(err) ?? 5;
        // Set a global cooldown so we don’t hammer replies during bursts.
        await setAutoReplyCooldownSeconds(context, sec + 1);

        if (attempt < maxAttempts) {
          const waitSec = Math.min(10, sec + 1);
          console.log('Stage3: RATELIMIT detected; waiting', waitSec, 'seconds then retry');
          await sleepMs(waitSec * 1000);
          continue;
        }
      }

      // For any other error, do not retry (avoid loops).
      return;
    }
  }
}

// ---------- Classifier (Stage 1) ----------

async function classifyComment(
  body: string,
  context: Devvit.Context
): Promise<FlagType[]> {
  console.log('classifyComment: body =', body);

  const textNorm = normalizeText(body);
  const useWordBoundary = await isWordBoundaryEnabled(context);

  const scamWords = await loadPhraseList(context, 'scam_phrases', [
    'scammer',
    'this is a scam',
    'such a scam',
    'you are scamming',
    'youre scamming',
  ]);

  const harassmentWords = await loadPhraseList(context, 'harassment_phrases', [
    'are you stupid',
    'you are stupid',
    'youre stupid',
    'you are dumb',
    'youre dumb',
    'you must be blind',
    'touch grass',
  ]);

  const policingWords = await loadPhraseList(
    context,
    'value_policing_phrases',
    [
      'ripoff',
      'rip-off',
      'trash offer',
      'clown trade',
      'terrible value',
      'insane offer',
      'this is ridiculous',
      'greedy',
    ]
  );

  const flags: FlagType[] = [];

  // ---- Scam accusation detection (with negation/context guard) ----
  const scamHit = scamWords.some((w) => phraseMatches(textNorm, w, useWordBoundary));
  const negationEnabled =
    ((await context.settings.get('enable_scam_negation_guard')) as boolean | undefined) !== false;

  const scamContextNegation = negationEnabled ? scamNegationOrContext(textNorm) : false;

  console.log('classifyComment: scamHit =', scamHit, 'negationGuard =', negationEnabled, 'negationMatched =', scamContextNegation);

  if (scamHit && !scamContextNegation) {
    flags.push('SCAM_ACCUSATION');
  }

  // ---- Harassment detection ----
  const harassmentHit = harassmentWords.some((w) =>
    phraseMatches(textNorm, w, useWordBoundary)
  );
  console.log('classifyComment: harassmentHit =', harassmentHit);
  if (harassmentHit) {
    flags.push('HARASSMENT');
  }

  // ---- Value policing detection ----
  const policingHit = policingWords.some((w) =>
    phraseMatches(textNorm, w, useWordBoundary)
  );
  console.log('classifyComment: policingHit =', policingHit);
  if (policingHit) {
    flags.push('VALUE_POLICING');
  }

  console.log('classifyComment: final flags =', flags);
  return flags;
}

// ---------- KV helpers: scoring + events ----------

async function clearUserHistory(
  context: Devvit.Context,
  username: string
): Promise<void> {
  const kv = context.kvStore;
  if (!kv) return;
  const conductKey = conductKeyForUser(username);
  const eventsKey = conductEventsKeyForUser(username);
  console.log(
    'clearUserHistory: deleting keys',
    conductKey,
    'and',
    eventsKey
  );
  try {
    await kv.delete(conductKey);
  } catch (err) {
    console.log('clearUserHistory: error deleting conduct key', err);
  }
  try {
    await kv.delete(eventsKey);
  } catch (err) {
    console.log('clearUserHistory: error deleting events key', err);
  }
}

async function getUserConduct(
  context: Devvit.Context,
  username: string
): Promise<UserConduct> {
  const kv = context.kvStore;
  console.log('getUserConduct: for', username, 'kvStore exists =', !!kv);
  if (!kv) {
    console.log('getUserConduct: kvStore missing, returning empty conduct');
    return {
      score: 0,
      scamFlags: 0,
      harassmentFlags: 0,
      valueFlags: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  const key = conductKeyForUser(username);
  const stored = (await kv.get<UserConduct>(key)) ?? undefined;

  console.log('getUserConduct: key =', key, 'stored =', stored);

  const now = Date.now();
  const resetWindowMs = await getResetWindowMs(context);

  if (!stored) {
    const empty: UserConduct = {
      score: 0,
      scamFlags: 0,
      harassmentFlags: 0,
      valueFlags: 0,
      lastUpdated: new Date().toISOString(),
    };
    console.log('getUserConduct: no existing conduct, returning empty object');
    return empty;
  }

  if (resetWindowMs != null && stored.lastUpdated) {
    const last = new Date(stored.lastUpdated).getTime();
    const age = now - last;
    console.log(
      'getUserConduct: checking reset window for',
      username,
      'age ms =',
      age,
      'window ms =',
      resetWindowMs
    );
    if (age > resetWindowMs) {
      console.log(
        'getUserConduct: conduct is older than reset window, resetting user',
        username
      );
      const reset: UserConduct = {
        score: 0,
        scamFlags: 0,
        harassmentFlags: 0,
        valueFlags: 0,
        lastUpdated: new Date().toISOString(),
      };
      await kv.put(key, reset);
      await clearUserHistory(context, username);
      return reset;
    }
  }


  // Optional Stage 5.3: lazy score decay (applied when loading the user)
  const decayEnabled =
    ((await context.settings.get('enable_score_decay')) as boolean | undefined) === true;

  if (decayEnabled) {
    const pointsPerDayRaw = (await context.settings.get(
      'score_decay_points_per_day'
    )) as number | undefined;
    const pointsPerDay =
      typeof pointsPerDayRaw === 'number' && pointsPerDayRaw > 0
        ? pointsPerDayRaw
        : 1;

    const ageMs = Date.now() - new Date(stored.lastUpdated).getTime();
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (days > 0 && (stored.score ?? 0) > 0) {
      const decay = pointsPerDay * days;
      const oldScore = stored.score ?? 0;
      stored.score = Math.max(0, oldScore - decay);

      // If score decayed below the last alert score, allow future alerts again
      if ((stored as any).lastAlertScore && (stored as any).lastAlertScore > stored.score) {
        (stored as any).lastAlertScore = 0;
      }

      stored.lastUpdated = new Date().toISOString();
      await kv.put(key, stored);

      console.log(
        'getUserConduct: applied score decay for',
        username,
        'days=',
        days,
        'pointsPerDay=',
        pointsPerDay,
        'oldScore=',
        oldScore,
        'newScore=',
        stored.score
      );
    }
  }

  return stored;
}

async function saveUserConduct(
  context: Devvit.Context,
  username: string,
  conduct: UserConduct
): Promise<void> {
  const kv = context.kvStore;
  console.log('saveUserConduct: for', username, 'kvStore exists =', !!kv);
  if (!kv) {
    console.log('saveUserConduct: kvStore missing, skipping save');
    return;
  }
  conduct.lastUpdated = new Date().toISOString();
  const key = conductKeyForUser(username);
  console.log('saveUserConduct: putting key =', key, 'value =', conduct);
  await kv.put(key, conduct);
}

async function addUserToIndex(
  context: Devvit.Context,
  username: string
): Promise<void> {
  const kv = context.kvStore;
  console.log('addUserToIndex: for', username, 'kvStore exists =', !!kv);
  if (!kv) {
    console.log('addUserToIndex: kvStore missing, skipping index update');
    return;
  }
  const existing =
    ((await kv.get<string[]>(CONDUCT_USERS_KEY)) as string[] | undefined) ?? [];
  console.log('addUserToIndex: current index =', existing);

  const uname = username.toLowerCase();
  if (!existing.includes(uname)) {
    const updated = [...existing, uname];
    console.log('addUserToIndex: updated index =', updated);
    await kv.put(CONDUCT_USERS_KEY, updated);
  } else {
    console.log('addUserToIndex: user already in index, no change');
  }
}

async function addConductEvent(
  context: Devvit.Context,
  username: string,
  event: ConductEvent
): Promise<void> {
  const kv = context.kvStore;
  if (!kv) {
    console.log('addConductEvent: kvStore missing, skipping event log');
    return;
  }
  const key = conductEventsKeyForUser(username);
  const existing =
    ((await kv.get<ConductEvent[]>(key)) as ConductEvent[] | undefined) ?? [];
  const updated = [...existing, event];

  const MAX_EVENTS = 20;
  const trimmed =
    updated.length > MAX_EVENTS
      ? updated.slice(updated.length - MAX_EVENTS)
      : updated;

  console.log(
    'addConductEvent: saving events for',
    username,
    'count =',
    trimmed.length
  );
  await kv.put(key, trimmed);
}

async function getUserEvents(
  context: Devvit.Context,
  username: string
): Promise<ConductEvent[]> {
  const kv = context.kvStore;
  if (!kv) return [];
  const key = conductEventsKeyForUser(username);
  const events =
    ((await kv.get<ConductEvent[]>(key)) as ConductEvent[] | undefined) ?? [];
  console.log('getUserEvents: for', username, 'count =', events.length);
  return events;
}

// ---------- Auto-clean helper ----------

async function autoCleanStaleUsers(
  context: Devvit.Context,
  subredditId: string
): Promise<void> {
  const { kvStore, reddit } = context;
  console.log('autoCleanStaleUsers: starting');

  if (!kvStore) {
    console.log('autoCleanStaleUsers: kvStore missing');
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] Auto-clean failed – KV not available',
      bodyMarkdown:
        'KV is not available for CommentGuardian. Please check Devvit.configure and permissions.',
    });
    return;
  }

  const resetWindowMs = await getResetWindowMs(context);
  if (resetWindowMs == null) {
    console.log('autoCleanStaleUsers: no reset window configured');
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] Auto-clean skipped – no reset window',
      bodyMarkdown:
        'Auto-clean could not run because `score_reset_days` is not set or is 0. Set a positive number of days to enable automatic resetting.',
    });
    return;
  }

  let users =
    ((await kvStore.get<string[]>(CONDUCT_USERS_KEY)) as string[] | undefined) ??
    [];
  users = users.filter((u) => u && u !== '[unknown]');
  console.log('autoCleanStaleUsers: users from index =', users);

  if (users.length === 0) {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] Auto-clean completed – no tracked users',
      bodyMarkdown:
        'Auto-clean ran successfully but there are no tracked users in CommentGuardian.',
    });
    return;
  }

  const now = Date.now();
  const cleaned: string[] = [];
  const skipped: string[] = [];

  for (const uname of users) {
    const key = conductKeyForUser(uname);
    const stored = (await kvStore.get<UserConduct>(key)) ?? undefined;

    if (!stored || !stored.lastUpdated) {
      console.log(
        'autoCleanStaleUsers: no stored conduct or lastUpdated for',
        uname
      );
      skipped.push(uname);
      continue;
    }

    const last = new Date(stored.lastUpdated).getTime();
    const age = now - last;

    console.log(
      'autoCleanStaleUsers: user =',
      uname,
      'age ms =',
      age,
      'resetWindowMs =',
      resetWindowMs
    );

    if (age > resetWindowMs) {
      console.log(
        'autoCleanStaleUsers: resetting user due to age exceeding window:',
        uname
      );

      await clearUserHistory(context, uname);

      const reset: UserConduct = {
        score: 0,
        scamFlags: 0,
        harassmentFlags: 0,
        valueFlags: 0,
        lastUpdated: new Date().toISOString(),
        lastAlertScore: 0,
      };
      await kvStore.put(key, reset);
      cleaned.push(uname);
    } else {
      skipped.push(uname);
    }
  }

  const lines: string[] = [];
  lines.push('**CommentGuardian auto-clean summary**', '');

  lines.push(`• Tracked users: ${users.length}`);
  lines.push(`• Reset users: ${cleaned.length}`);
  lines.push(`• Unchanged users: ${skipped.length}`, '');

  if (cleaned.length > 0) {
    lines.push('Reset users:', '');
    cleaned.forEach((u) => lines.push(`- u/${u}`));
  } else {
    lines.push('No users needed resetting based on score_reset_days.');
  }

  await reddit.modMail.createModInboxConversation({
    subredditId,
    subject: '[CommentGuardian] Auto-clean completed',
    bodyMarkdown: lines.join('\n'),
  });

  console.log('autoCleanStaleUsers: completed, cleaned =', cleaned.length);
}

// ---------- Mod-only check for commands ----------

async function isCommandUserAllowed(
  event: CommentCreate,
  context: Devvit.Context
): Promise<boolean> {
  const subredditName = event.subreddit?.name;
  const username = (event as any).author?.name as string | undefined;

  if (!subredditName || !username) {
    console.log(
      'isCommandUserAllowed: missing subredditName or username',
      'subredditName =',
      subredditName,
      'username =',
      username
    );
    return false;
  }

  console.log(
    'isCommandUserAllowed: checking',
    'subredditName =',
    subredditName,
    'username =',
    username
  );

  let isMod = false;
  try {
    const mods = await context.reddit
      .getModerators({ subredditName, username })
      .all();
    isMod = mods.length > 0;
    console.log('isCommandUserAllowed: isMod =', isMod);
  } catch (error) {
    console.error('isCommandUserAllowed: error checking moderators:', error);
  }

  return isMod;
}

// ---------- Mod commands ----------
//
//  !cg-top                → top 20 offenders (all-time)
//  !cg-user username      → detailed report + links
//  !cg-over N             → all users with score ≥ N
//  !cg-reset username     → reset one user (score + history)
//  !cg-clean              → run auto-clean now based on score_reset_days
//  !cg-deduct username N  → subtract N points from a user (not below 0)
//  !cg-add username N     → add N points to a user (manual adjustment)

async function commandTopOffenders(
  context: Devvit.Context,
  subredditId: string
): Promise<void> {
  const { reddit, kvStore } = context;
  console.log('commandTopOffenders: kvStore exists =', !!kvStore);
  if (!kvStore) {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] KV not available',
      bodyMarkdown:
        'KV is not available for this app. Please check Devvit.configure and permissions.',
    });
    return;
  }

  let users =
    ((await kvStore.get<string[]>(CONDUCT_USERS_KEY)) as string[] | undefined) ??
    [];
  console.log('commandTopOffenders: raw users =', users);

  users = users.filter((u) => u && u !== '[unknown]');
  console.log('commandTopOffenders: filtered users =', users);

  if (users.length === 0) {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] Top offenders – no tracked users',
      bodyMarkdown:
        'CommentGuardian does not have any tracked users yet (no flagged comments with valid authors).',
    });
    return;
  }

  const records: { username: string; conduct: UserConduct }[] = [];

  for (const uname of users) {
    const conduct = await getUserConduct(context, uname);
    if (conduct.score > 0) {
      records.push({ username: uname, conduct });
    }
  }

  if (records.length === 0) {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] Top offenders – none with positive score',
      bodyMarkdown:
        'No users currently have a positive CommentGuardian score.',
    });
    return;
  }

  records.sort((a, b) => b.conduct.score - a.conduct.score);
  const top = records.slice(0, 20);

  const lines: string[] = [];
  lines.push('Top CommentGuardian offenders (all-time):', '');

  top.forEach((r, idx) => {
    const c = r.conduct;
    lines.push(
      `${idx + 1}. u/${r.username} — score: ${c.score}, scam: ${c.scamFlags}, harassment: ${c.harassmentFlags}, policing: ${c.valueFlags}`
    );
  });

  await reddit.modMail.createModInboxConversation({
    subredditId,
    subject: '[CommentGuardian] Top offenders (all-time)',
    bodyMarkdown: lines.join('\n'),
  });
}

async function commandOverThreshold(
  context: Devvit.Context,
  subredditId: string,
  threshold: number
): Promise<void> {
  const { reddit, kvStore } = context;
  console.log('commandOverThreshold: threshold =', threshold);
  if (!kvStore) {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] KV not available',
      bodyMarkdown:
        'KV is not available for this app. Please check Devvit.configure and permissions.',
    });
    return;
  }

  let users =
    ((await kvStore.get<string[]>(CONDUCT_USERS_KEY)) as string[] | undefined) ??
    [];
  users = users.filter((u) => u && u !== '[unknown]');
  console.log('commandOverThreshold: users =', users);

  if (users.length === 0) {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: `[CommentGuardian] Users with score ≥ ${threshold}`,
      bodyMarkdown: 'No tracked users.',
    });
    return;
  }

  const matched: { username: string; conduct: UserConduct }[] = [];

  for (const uname of users) {
    const conduct = await getUserConduct(context, uname);
    if (conduct.score >= threshold) {
      matched.push({ username: uname, conduct });
    }
  }

  if (matched.length === 0) {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: `[CommentGuardian] Users with score ≥ ${threshold}`,
      bodyMarkdown: `No users currently have a score ≥ ${threshold}.`,
    });
    return;
  }

  matched.sort((a, b) => b.conduct.score - a.conduct.score);

  const lines: string[] = [];
  lines.push(
    `Users with CommentGuardian score ≥ ${threshold}:`,
    ''
  );

  matched.forEach((r, idx) => {
    const c = r.conduct;
    lines.push(
      `${idx + 1}. u/${r.username} — score: ${c.score}, scam: ${c.scamFlags}, harassment: ${c.harassmentFlags}, policing: ${c.valueFlags}`
    );
  });

  await reddit.modMail.createModInboxConversation({
    subredditId,
    subject: `[CommentGuardian] Users with score ≥ ${threshold}`,
    bodyMarkdown: lines.join('\n'),
  });
}

async function commandUserReport(
  context: Devvit.Context,
  subredditId: string,
  username: string
): Promise<void> {
  const { reddit } = context;

  const uname = username.replace(/^u\//i, '');
  console.log('commandUserReport: generating report for', uname);

  const conduct = await getUserConduct(context, uname);
  const events = await getUserEvents(context, uname);

  const lines: string[] = [];
  lines.push(
    `**CommentGuardian user report: u/${uname}**`,
    '',
    `• Score: ${conduct.score}`,
    `• Scam flags: ${conduct.scamFlags}`,
    `• Harassment flags: ${conduct.harassmentFlags}`,
    `• Policing flags: ${conduct.valueFlags}`,
    `• Last updated: ${conduct.lastUpdated}`,
    ''
  );

  if (events.length > 0) {
    lines.push('Recent flagged comments (most recent last):', '');
    const lastEvents = events.slice(-10);
    lastEvents.forEach((ev) => {
      const base = `- [${ev.createdAt}] delta: ${ev.delta}, flags: ${ev.flags.join(
        ', '
      )} — ${ev.permalink ? `[view comment](${ev.permalink})` : '(manual)'}`;
      lines.push(base);

      if (ev.postTitle) {
        lines.push(`  • Post: *${ev.postTitle}*`);
      }
      if (ev.commentSnippet) {
        lines.push(`  • Snippet: "${ev.commentSnippet}"`);
      }
    });
  } else {
    lines.push(
      '_No stored flagged comment history for this user (or it has been reset)._' 
    );
  }

  await reddit.modMail.createModInboxConversation({
    subredditId,
    subject: `[CommentGuardian] User report for u/${uname}`,
    bodyMarkdown: lines.join('\n'),
  });
}

async function commandResetUser(
  context: Devvit.Context,
  subredditId: string,
  username: string
): Promise<void> {
  const { reddit, kvStore } = context;
  const uname = username.replace(/^u\//i, '');
  console.log('commandResetUser: resetting user', uname);

  if (!kvStore) {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] KV not available',
      bodyMarkdown:
        'KV is not available for this app. Please check Devvit.configure and permissions.',
    });
    return;
  }

  await clearUserHistory(context, uname);

  const key = conductKeyForUser(uname);
  const empty: UserConduct = {
    score: 0,
    scamFlags: 0,
    harassmentFlags: 0,
    valueFlags: 0,
    lastUpdated: new Date().toISOString(),
    lastAlertScore: 0,
  };
  await kvStore.put(key, empty);

  await reddit.modMail.createModInboxConversation({
    subredditId,
    subject: `[CommentGuardian] User reset: u/${uname}`,
    bodyMarkdown: `User u/${uname} has been reset (score and history cleared).`,
  });
}

// Generic score adjustment helper (used by !cg-deduct and !cg-add)
async function commandAdjustScore(
  context: Devvit.Context,
  subredditId: string,
  username: string,
  delta: number
): Promise<void> {
  const { reddit, kvStore } = context;
  const uname = username.replace(/^u\//i, '');
  console.log('commandAdjustScore: adjusting score for', uname, 'delta =', delta);

  if (!kvStore) {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] Adjust score – KV not available',
      bodyMarkdown:
        'KV is not available for this app. Please check Devvit.configure and permissions.',
    });
    return;
  }

  const conduct = await getUserConduct(context, uname);
  const oldScore = conduct.score;

  const newScore = Math.max(0, oldScore + delta);
  conduct.score = newScore;
  conduct.lastUpdated = new Date().toISOString();

  await kvStore.put(conductKeyForUser(uname), conduct);

  const eventsKey = conductEventsKeyForUser(uname);
  const existingEvents =
    ((await kvStore.get<ConductEvent[]>(eventsKey)) as ConductEvent[] |
      undefined) ?? [];

  const manualEvent: ConductEvent = {
    commentId: 'manual-adjust',
    permalink: '',
    flags: [],
    delta,
    createdAt: new Date().toISOString(),
    commentSnippet: `Manual score adjustment by mods: ${
      delta > 0 ? '+' : ''
    }${delta} points`,
    postTitle: 'Manual adjustment',
  };

  const updatedEvents = [...existingEvents, manualEvent];
  const MAX_EVENTS = 20;
  const trimmedEvents =
    updatedEvents.length > MAX_EVENTS
      ? updatedEvents.slice(updatedEvents.length - MAX_EVENTS)
      : updatedEvents;

  await kvStore.put(eventsKey, trimmedEvents);

  const lines: string[] = [];
  lines.push(
    `Score for u/${uname} adjusted by ${delta > 0 ? '+' : ''}${delta} points.`,
    '',
    `• Old score: ${oldScore}`,
    `• New score: ${newScore}`
  );

  await reddit.modMail.createModInboxConversation({
    subredditId,
    subject: `[CommentGuardian] Score adjusted for u/${uname}`,
    bodyMarkdown: lines.join('\n'),
  });
}

// ---------- Command handler ----------

async function handleModCommand(
  event: CommentCreate,
  context: Devvit.Context
): Promise<void> {
  const comment = event.comment;
  const subreddit = event.subreddit;
  if (!comment || !subreddit) {
    console.log('handleModCommand: missing comment or subreddit, returning');
    return;
  }

  const rawBody = comment.body ?? '';
  const body = rawBody.trim();
  const parts = body.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  console.log(
    'handleModCommand:',
    'sub =',
    subreddit.name,
    'rawBody =',
    rawBody,
    'cmd =',
    cmd,
    'args =',
    args
  );

  const { reddit, settings } = context;

  const allowed = await isCommandUserAllowed(event, context);
  if (!allowed) {
    const eventAuthor: any = (event as any).author;
    console.log(
      'handleModCommand: non-mod tried to use command, ignoring',
      eventAuthor?.name
    );
    return;
  }

  try {
    if (cmd === '!cg-top') {
      await commandTopOffenders(context, subreddit.id);
    } else if (cmd === '!cg-user') {
      if (args.length === 0) {
        await reddit.modMail.createModInboxConversation({
          subredditId: subreddit.id,
          subject: '[CommentGuardian] User report – missing username',
          bodyMarkdown: 'Usage: `!cg-user username`',
        });
      } else {
        await commandUserReport(context, subreddit.id, args[0]);
      }
    } else if (cmd === '!cg-over') {
      if (args.length === 0) {
        await reddit.modMail.createModInboxConversation({
          subredditId: subreddit.id,
          subject: '[CommentGuardian] Threshold report – missing number',
          bodyMarkdown: 'Usage: `!cg-over 5`',
        });
      } else {
        const threshold = parseInt(args[0], 10);
        if (isNaN(threshold)) {
          await reddit.modMail.createModInboxConversation({
            subredditId: subreddit.id,
            subject: '[CommentGuardian] Threshold report – invalid number',
            bodyMarkdown:
              'Usage: `!cg-over 5` (score must be a number).',
          });
        } else {
          await commandOverThreshold(context, subreddit.id, threshold);
        }
      }
    } else if (cmd === '!cg-reset') {
      if (args.length === 0) {
        await reddit.modMail.createModInboxConversation({
          subredditId: subreddit.id,
          subject: '[CommentGuardian] Reset user – missing username',
          bodyMarkdown: 'Usage: `!cg-reset username`',
        });
      } else {
        await commandResetUser(context, subreddit.id, args[0]);
      }
    } else if (cmd === '!cg-clean') {
      await autoCleanStaleUsers(context, subreddit.id);
    } else if (cmd === '!cg-deduct') {
      if (args.length < 2) {
        await reddit.modMail.createModInboxConversation({
          subredditId: subreddit.id,
          subject: '[CommentGuardian] Deduct score – missing arguments',
          bodyMarkdown:
            'Usage: `!cg-deduct username points` (e.g. `!cg-deduct u/example 5`).',
        });
      } else {
        const targetUser = args[0];
        const amount = parseInt(args[1], 10);

        if (isNaN(amount) || amount <= 0) {
          await reddit.modMail.createModInboxConversation({
            subredditId: subreddit.id,
            subject: '[CommentGuardian] Deduct score – invalid amount',
            bodyMarkdown:
              'Points must be a positive integer. Example: `!cg-deduct u/example 5`.',
          });
        } else {
          await commandAdjustScore(
            context,
            subreddit.id,
            targetUser,
            -amount
          );
        }
      }
    } else if (cmd === '!cg-add') {
      if (args.length < 2) {
        await reddit.modMail.createModInboxConversation({
          subredditId: subreddit.id,
          subject: '[CommentGuardian] Add score – missing arguments',
          bodyMarkdown:
            'Usage: `!cg-add username points` (e.g. `!cg-add u/example 3`).',
        });
      } else {
        const targetUser = args[0];
        const amount = parseInt(args[1], 10);

        if (isNaN(amount) || amount <= 0) {
          await reddit.modMail.createModInboxConversation({
            subredditId: subreddit.id,
            subject: '[CommentGuardian] Add score – invalid amount',
            bodyMarkdown:
              'Points must be a positive integer. Example: `!cg-add u/example 3`.',
          });
        } else {
          await commandAdjustScore(
            context,
            subreddit.id,
            targetUser,
            amount
          );
        }
      }
    } else {
      console.log('handleModCommand: unknown command, doing nothing');
    }
  } catch (err) {
    console.error('handleModCommand: error handling mod command', err);
  }

  // Optionally auto-remove command comment
  try {
    const deleteCommandsSetting = (await settings.get(
      'delete_command_comments'
    )) as boolean | undefined;
    const shouldDelete = deleteCommandsSetting !== false;

    if (shouldDelete) {
      console.log(
        'handleModCommand: attempting to auto-remove command comment via API wrapper',
        comment.id
      );

      const apiComment = await reddit.getCommentById(comment.id);

      if (typeof (apiComment as any).remove === 'function') {
        await (apiComment as any).remove();
        console.log(
          'handleModCommand: successfully removed command comment',
          comment.id
        );
      } else {
        console.log(
          'handleModCommand: apiComment.remove is not a function, cannot delete command comment'
        );
      }
    } else {
      console.log(
        'handleModCommand: delete_command_comments = false, leaving command comment'
      );
    }
  } catch (err) {
    console.error(
      'handleModCommand: error while trying to remove command comment',
      err
    );
  }
}

// ---------- Main Trigger ----------

Devvit.addTrigger({
  event: 'CommentCreate',
  async onEvent(event: CommentCreate, context) {
    const comment = event.comment;
    const subreddit = event.subreddit;
    const post = event.post;

    if (!comment || !subreddit) {
      console.log('CommentCreate: missing comment or subreddit, returning');
      return;
    }

    const rawBody = comment.body ?? '';
    const body = rawBody.trim();
    const bodyLower = body.toLowerCase();

    const { reddit, settings } = context;

    console.log(
      'CommentCreate: START',
      'sub =',
      subreddit.name,
      'rawBody =',
      rawBody
    )

    // 🔁 Loop prevention: never process the bot's own comments or its auto-reply marker
    const skipBotComments = true;
    const botUsernameRaw = (await settings.get('bot_username')) as string | undefined;
    const botUsername = (botUsernameRaw ?? '').trim().toLowerCase();
    const eventAuthorName = event.author?.name;
    const eventAuthorLower = (eventAuthorName ?? '').toLowerCase();

    if (skipBotComments) {
      if (botUsername && eventAuthorLower === botUsername) {
        console.log('CommentCreate: skipping bot-authored comment to prevent loops', eventAuthorName);
        return;
      }
      if (bodyLower.includes('<!-- commentguardian:auto-reply -->')) {
        console.log('CommentCreate: skipping comment with auto-reply marker to prevent loops');
        return;
      }
    }
;

    // 0) Commands
    if (bodyLower.startsWith('!cg-')) {
      console.log('CommentCreate: detected command, routing to handleModCommand');
      await handleModCommand(event, context);
      console.log('CommentCreate: END (command path)');
      return;
    }

    // 1) Flair filter (optional)
    const monitoredFlairsRaw = (await settings.get(
      'monitored_post_flairs'
    )) as string | undefined;
    console.log('CommentCreate: monitored_post_flairs =', monitoredFlairsRaw);

    if (monitoredFlairsRaw && monitoredFlairsRaw.trim().length > 0) {
      const allowedFlairs = monitoredFlairsRaw
        .split(/[\n\r,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const postFlairText =
        post?.linkFlair?.text?.toLowerCase().trim() ?? '';

      console.log(
        'CommentCreate: flair filter active',
        'allowedFlairs =',
        allowedFlairs,
        'postFlairText =',
        postFlairText
      );

      if (!postFlairText || !allowedFlairs.includes(postFlairText)) {
        console.log(
          'CommentCreate: post flair not in allowed list, skipping this comment'
        );
        console.log('CommentCreate: END (flair filtered)');
        return;
      }
    } else {
      console.log('CommentCreate: no flair filter, monitoring all posts');
    }

    // 2) Classify
    const flags = await classifyComment(comment.body, context);
    console.log('CommentCreate: classification flags =', flags);

    if (flags.length === 0) {
      console.log('CommentCreate: no flags detected, nothing else to do');
      console.log('CommentCreate: END (no flags)');
      return;
    }

    const flagList = flags.join(', ');

    // 3) Resolve username
    const username = await resolveUsername(event, comment);
    console.log('CommentCreate: Username resolution result =', username);

    // Trust context (Stage 5.2)
    const trust = await getTrustContext(context, event, comment, username);

    const nowIso = new Date().toISOString();

    // Threshold config
    const thresholdBase = await getAlertThreshold(context);
    console.log('CommentCreate: threshold from settings =', thresholdBase);

    let threshold: number | null = thresholdBase;
    if (thresholdBase != null && trust.isTrusted) {
      const mult = await getTrustedThresholdMultiplier(context);
      threshold = Math.ceil(thresholdBase * mult);
      console.log(
        'CommentCreate: trusted user, applying threshold multiplier',
        'base=',
        thresholdBase,
        'mult=',
        mult,
        'effective=',
        threshold
      );
    }


    let thresholdAlertNeeded = false;
    let usernameForAlert: string | undefined;

    if (!username) {
      console.log(
        'CommentCreate: no username available, skipping scoring but will still report'
      );
    } else {
      try {
        console.log('CommentCreate: entering scoring logic for', username);
        const oldConduct = await getUserConduct(context, username);
        const conduct: UserConduct = { ...oldConduct };

        const oldScore = oldConduct.score ?? 0;

        const scamWeight = await getScoreWeight(context, 'score_scam', 3);
        const harassmentWeight = await getScoreWeight(
          context,
          'score_harassment',
          4
        );
        const policingWeight = await getScoreWeight(
          context,
          'score_policing',
          1
        );

        let delta = 0;
        if (flags.includes('SCAM_ACCUSATION')) {
          conduct.scamFlags += 1;
          delta += scamWeight;
        }
        if (flags.includes('HARASSMENT')) {
          conduct.harassmentFlags += 1;
          delta += harassmentWeight;
        }
        if (flags.includes('VALUE_POLICING')) {
          conduct.valueFlags += 1;
          delta += policingWeight;
        }

        conduct.score = (conduct.score ?? 0) + delta;

        console.log(
          'CommentCreate: updating conduct for',
          username,
          'oldConduct =',
          oldConduct,
          'delta =',
          delta,
          'newConduct =',
          conduct
        );

        // Threshold-crossing check
        if (threshold != null) {
          const lastAlertScore = conduct.lastAlertScore ?? 0;
          console.log(
            'CommentCreate: threshold check for',
            username,
            'oldScore =',
            oldScore,
            'newScore =',
            conduct.score,
            'lastAlertScore =',
            lastAlertScore,
            'threshold =',
            threshold
          );

          if (
            oldScore < threshold &&
            conduct.score >= threshold &&
            lastAlertScore < threshold
          ) {
            console.log(
              'CommentCreate: user crossed threshold, will send alert for',
              username
            );
            conduct.lastAlertScore = threshold;
            thresholdAlertNeeded = true;
            usernameForAlert = username;
          }
        }

        await saveUserConduct(context, username, conduct);
        await addUserToIndex(context, username);

        const permalink = `https://reddit.com${comment.permalink}`;
        const commentSnippet =
          comment.body.length > 200
            ? comment.body.slice(0, 200) + '…'
            : comment.body;
        const postTitle = post?.title ?? '';

        const ev: ConductEvent = {
          commentId: comment.id,
          permalink,
          flags,
          delta,
          createdAt: nowIso,
          commentSnippet,
          postTitle,
        };
        await addConductEvent(context, username, ev);
      } catch (err) {
        console.error('CommentCreate: error during scoring / KV operations', err);
      }
    }

    const usernameForDisplay = username ?? '[unknown]';

    const preview =
      comment.body.length > 400
        ? comment.body.slice(0, 400) + '…'
        : comment.body;

    const modmailSetting = (await settings.get(
      'notify_via_modmail'
    )) as boolean | undefined;
    const reportSetting = (await settings.get(
      'report_to_modqueue'
    )) as boolean | undefined;

    const sendModmail = modmailSetting === true;
    const reportToModqueue = reportSetting !== false;

    console.log(
      'CommentCreate: actions config',
      'reportToModqueue =',
      reportToModqueue,
      'sendModmail =',
      sendModmail
    );

    if (reportToModqueue) {
      try {
        await reddit.report(comment, {
          reason: `[CommentGuardian] ${flagList}`,
        });
        console.log('CommentCreate: reported comment to modqueue with', flagList);
      } catch (err) {
        console.error('CommentCreate: error reporting comment to modqueue', err);
      }
    }

    if (sendModmail) {
      const permalink = `https://reddit.com${comment.permalink}`;

      const subject = `[CommentGuardian] ${flagList} from u/${usernameForDisplay}`;
      const bodyMarkdown =
        `Detected flags: **${flagList}**\n\n` +
        `Subreddit: r/${subreddit.name}\n` +
        `Author: u/${usernameForDisplay}\n\n` +
        `[View comment](${permalink})\n\n` +
        `---\n\n` +
        `Preview:\n\n> ${preview.replace(/\n/g, '\n> ')}`;

      console.log('CommentCreate: sending per-comment modmail with subject =', subject);

      try {
        await reddit.modMail.createModInboxConversation({
          subject,
          bodyMarkdown,
          subredditId: subreddit.id,
        });
        console.log('CommentCreate: per-comment modmail sent successfully');
      } catch (err) {
        console.error('CommentCreate: error creating per-comment modmail', err);
      }
    }

    // Threshold-crossing alert (Stage 2 #1)
    if (thresholdAlertNeeded && usernameForAlert) {
      console.log(
        'CommentCreate: sending threshold alert modmail for',
        usernameForAlert,
        'threshold =',
        threshold
      );
      const conduct = await getUserConduct(context, usernameForAlert);
      const events = await getUserEvents(context, usernameForAlert);

      const lines: string[] = [];
      lines.push(
        `u/${usernameForAlert} has crossed the CommentGuardian threshold score of ${threshold}.`,
        '',
        `• Current score: ${conduct.score}`,
        `• Scam flags: ${conduct.scamFlags}`,
        `• Harassment flags: ${conduct.harassmentFlags}`,
        `• Policing flags: ${conduct.valueFlags}`,
        `• Last updated: ${conduct.lastUpdated}`,
        ''
      );

      if (events.length > 0) {
        lines.push('Recent flagged comments:', '');
        const lastEvents = events.slice(-5);
        lastEvents.forEach((ev) => {
          const base = `- [${ev.createdAt}] delta: ${ev.delta}, flags: ${ev.flags.join(
            ', '
          )} — ${ev.permalink ? `[view](${ev.permalink})` : '(manual)'}`;
          lines.push(base);
          if (ev.postTitle) lines.push(`  • Post: *${ev.postTitle}*`);
          if (ev.commentSnippet) lines.push(`  • Snippet: "${ev.commentSnippet}"`);
        });
      }

      try {
        await reddit.modMail.createModInboxConversation({
          subredditId: subreddit.id,
          subject: `[CommentGuardian] Threshold reached for u/${usernameForAlert}`,
          bodyMarkdown: lines.join('\n'),
        });
        console.log(
          'CommentCreate: threshold alert modmail sent for',
          usernameForAlert
        );
      } catch (err) {
        console.error(
          'CommentCreate: error creating threshold alert modmail',
          err
        );
      }
    }

    // ================
    // STAGE 3 – Auto reply logic
    // ================

    if (username) {
      const autoReplyEnabled = (await settings.get(
        'auto_reply_enabled'
      )) as boolean | undefined;

      if (autoReplyEnabled) {
        console.log(
          'CommentCreate: Stage 3 auto-reply enabled, evaluating for user',
          username
        );

        // Global cooldown (protects against RATELIMIT bursts)
        const cooldownUntil = await getAutoReplyCooldownUntilMs(context);
        if (cooldownUntil > Date.now()) {
          console.log(
            'CommentCreate: Stage 3 auto-reply skipped due to global cooldown. cooldownUntilMs =',
            cooldownUntil
          );
          console.log('CommentCreate: END (normal path)');
          return;
        }

        // ---- Stage 3 HARD GUARD: never auto-reply to replies (prevents loops) ----
        const parentId = (comment as any)?.parentId ?? (event as any)?.comment?.parentId;
        if (parentId && String(parentId).startsWith('t1_')) {
          console.log(
            'Stage3: skipping auto-reply because comment is a reply (parentId=',
            parentId,
            ')'
          );
          console.log('CommentCreate: END (normal path)');
          return;
        }

        const behaviorWindowMs = await getBehaviorWindowMs(context);
        const allEvents = await getUserEvents(context, username);
        const now = Date.now();

        let recentEvents = allEvents;
        if (behaviorWindowMs != null) {
          recentEvents = allEvents.filter((ev) => {
            const t = new Date(ev.createdAt).getTime();
            return now - t <= behaviorWindowMs;
          });
        }

        // We just added this comment as the last event; treat "prior" as everything except the newest.
        const priorRecentCount = Math.max(0, recentEvents.length - 1);
        const isFirstOffense = priorRecentCount === 0;

        const onFirst =
          ((await settings.get(
            'auto_reply_on_first_offense'
          )) as boolean | undefined) === true;
        const onRepeat =
          ((await settings.get(
            'auto_reply_on_repeat_offense'
          )) as boolean | undefined) !== false;

        const onFirstEffective = trust.isTrusted ? false : onFirst;
        if (trust.isTrusted && onFirst) {
          console.log(
            'CommentCreate: Stage 5.2 trusted user override: disabling onFirst auto-replies (repeat only).'
          );
        }


        console.log(
          'CommentCreate: Stage 3 offense state',
          'isFirstOffense =',
          isFirstOffense,
          'priorRecentCount =',
          priorRecentCount,
          'onFirst =',
          onFirstEffective,
          'onRepeat =',
          onRepeat
        );

        let shouldReply = false;
        if (isFirstOffense && onFirstEffective) {
          shouldReply = true;
        } else if (!isFirstOffense && onRepeat) {
          shouldReply = true;
        }


        // ---- Stage 4.3 severity tiers: only auto-reply for hard flags unless explicitly enabled ----
        const includeSoft =
          ((await settings.get('auto_reply_include_soft_flags')) as boolean | undefined) === true;

        const hasHardFlag = flags.includes('SCAM_ACCUSATION') || flags.includes('HARASSMENT');
        const hasSoftOnly = !hasHardFlag && flags.includes('VALUE_POLICING');

        if (hasSoftOnly && !includeSoft) {
          console.log(
            'CommentCreate: Stage 3 auto-reply skipped (soft flags only and includeSoft=false). flags=',
            flags
          );
          shouldReply = false;
        }

        if (!shouldReply) {
          console.log(
            'CommentCreate: Stage 3 auto-reply not triggered by first/repeat settings'
          );
        } else {
          // Once-per-thread logic
          const oncePerThread =
            ((await settings.get(
              'auto_reply_once_per_thread'
            )) as boolean | undefined) !== false;

          let skipDueToThread = false;
          const kv = context.kvStore;

          if (oncePerThread && kv) {
            const postId = comment.postId;
            const key = autoReplyKey(username, postId);
            const marker = await kv.get<string>(key);
            console.log(
              'CommentCreate: Stage 3 auto-reply thread key =',
              key,
              'marker =',
              marker
            );

            if (marker) {
              skipDueToThread = true;
            } else {
              await kv.put(key, new Date().toISOString());
            }
          }

          if (skipDueToThread) {
            console.log(
              'CommentCreate: Stage 3 auto-reply skipped: already replied in this thread for user',
              username
            );
          } else {
            const rawTemplate = (await settings.get(
              'auto_reply_text'
            )) as string | undefined;

            const templateSource =
              rawTemplate && rawTemplate.trim().length > 0
                ? rawTemplate
                : DEFAULT_AUTO_REPLY_TEXT;

            console.log('Stage3: templateSource =', templateSource);

            const replyBody = buildAutoReplyBody(
              templateSource,
              username,
              subreddit.name
            );

            console.log(
              'Stage3: final replyBody length =',
              replyBody.length,
              'preview =',
              replyBody.slice(0, 120)
            );

            if (!replyBody || replyBody.trim().length === 0) {
              console.log(
                'Stage3: replyBody is empty after formatting – skipping auto-reply to avoid NO_TEXT error'
              );
            } else {
              try {
                await submitAutoReplyWithRetry(
                  context,
                  comment.id,
                  replyBody,
                  username
                );
              } catch (err) {
                console.error('Stage3: error posting auto-reply', err);
              }
            }
          }
        }
      } else {
        console.log(
          'CommentCreate: Stage 3 auto-reply disabled in settings, skipping reply'
        );
      }
    } else {
      console.log(
        'CommentCreate: Stage 3 auto-reply skipped because username is missing'
      );
    }

    console.log('CommentCreate: END (normal path)');
  },
});

export default Devvit;
