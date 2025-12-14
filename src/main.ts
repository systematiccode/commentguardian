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
  reason?: string; // optional (e.g., VOTE_SIGNAL)
}

interface VoteCheckJob {
  commentId: string;
  username: string; // lowercase
  postId: string;
  permalink: string;
  flags: FlagType[];
  createdAt: string; // ISO
  checkAt: number; // epoch ms
}

const CONDUCT_USERS_KEY = 'conduct_users';
const VOTE_JOBS_KEY = 'vote_jobs';


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
    label: 'Delayed signals (votes)',
    fields: [
      {
        type: 'boolean',
        name: 'vote_signal_enabled',
        label: 'Enable delayed vote signal scoring',
        scope: SettingScope.Installation,
        defaultValue: false,
        helpText:
          'If enabled, the bot will re-check the score of flagged comments after a delay and may add a small number of extra points if the community reaction is strongly negative. This is a weak signal (never auto-removes).',
      },
      {
        type: 'number',
        name: 'vote_signal_delay_minutes',
        label: 'Vote check delay (minutes)',
        scope: SettingScope.Installation,
        defaultValue: 60,
        helpText:
          'How long after a flagged comment to re-check its score.',
      },
      {
        type: 'number',
        name: 'vote_signal_score_threshold',
        label: 'Score threshold (<=)',
        scope: SettingScope.Installation,
        defaultValue: -5,
        helpText:
          'If the comment score is less than or equal to this value when checked, extra points will be applied.',
      },
      {
        type: 'number',
        name: 'vote_signal_points',
        label: 'Extra points to add',
        scope: SettingScope.Installation,
        defaultValue: 1,
        helpText:
          'Points added to the user score when the delayed score threshold is met.',
      },
      {
        type: 'number',
        name: 'vote_signal_max_jobs_per_run',
        label: 'Max vote jobs processed per run',
        scope: SettingScope.Installation,
        defaultValue: 3,
        helpText:
          'Safety limit: how many queued vote checks to process per new comment event.',
      },
    ],
  },

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

  // ---------- Behavior Guards (simple) ----------
  {
    type: 'group',
    label: 'Behavior Guards',
    fields: [
      {
        type: 'boolean',
        name: 'enable_value_once_per_post',
        label: 'Value policing: allow only 1 per user per post',
        scope: SettingScope.Installation,
        defaultValue: false,
        helpText:
          'If enabled, once a user has made one value-policing comment on a post, subsequent value-policing comments by that same user on that same post will be actioned.',
      },
      {
        type: 'select',
        name: 'value_once_action',
        label: 'Value policing follow-up action',
        scope: SettingScope.Installation,
        defaultValue: 'reply',
        options: [
          { label: 'Reply (bot comment)', value: 'reply' },
          { label: 'Remove (mod action)', value: 'remove' },
        ],
        helpText:
          'What to do when a user posts more than one value-policing comment on the same post.',
      },
      {
        type: 'string',
        name: 'value_once_reply_template',
        label: 'Value policing reply template',
        scope: SettingScope.Installation,
        defaultValue:
          'Hi u/{username} — please keep value feedback to **one comment per post**. If you have more to add, edit your original comment.',
        helpText:
          'Template used when action is Reply. Supports {username} and {subreddit}.',
      },

      {
        type: 'boolean',
        name: 'enable_dogpile_guard',
        label: 'Argument / dogpile guard (too many comments on same post)',
        scope: SettingScope.Installation,
        defaultValue: false,
        helpText:
          'If enabled, the app will track how many comments a user leaves on the same post within a time window. Once they exceed the max, subsequent comments can be replied-to or removed.',
      },
      {
        type: 'number',
        name: 'dogpile_max_comments',
        label: 'Max comments per user per post (within window)',
        scope: SettingScope.Installation,
        defaultValue: 6,
      },
      {
        type: 'number',
        name: 'dogpile_window_minutes',
        label: 'Dogpile window (minutes)',
        scope: SettingScope.Installation,
        defaultValue: 30,
      },
      {
        type: 'select',
        name: 'dogpile_action',
        label: 'Dogpile follow-up action',
        scope: SettingScope.Installation,
        defaultValue: 'reply',
        options: [
          { label: 'Reply (bot comment)', value: 'reply' },
          { label: 'Remove (mod action)', value: 'remove' },
        ],
      },
      {
        type: 'string',
        name: 'dogpile_reply_template',
        label: 'Dogpile reply template',
        scope: SettingScope.Installation,
        defaultValue:
          'Hi u/{username} — it looks like this thread is getting heated. Please avoid back-and-forth arguments. If needed, report and move on.',
        helpText:
          'Template used when action is Reply. Supports {username} and {subreddit}.',
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

// ---------- Settings helpers ----------
// Devvit `select` settings may come back as a string OR an object (e.g. { label, value }).
// Normalize to a lowercase string so comparisons like "remove" work reliably.
function normalizeSelectSetting(raw: any, fallback: string): string {
  try {
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw === 'string') return raw.trim().toLowerCase();
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw).trim().toLowerCase();
    if (typeof raw === 'object') {
      const anyRaw: any = raw;
      if (typeof anyRaw.value === 'string') return anyRaw.value.trim().toLowerCase();
      if (typeof anyRaw.selected === 'string') return anyRaw.selected.trim().toLowerCase();
      if (typeof anyRaw.name === 'string') return anyRaw.name.trim().toLowerCase();
    }
    return String(raw).trim().toLowerCase();
  } catch {
    return fallback;
  }
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
// ---------- Behavior Guard helpers (Stage 6.x) ----------

function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template ?? '';
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}

async function tryRemoveComment(context: Devvit.Context, commentId: string): Promise<boolean> {
  try {
    // Fetch API comment to ensure we have a model instance with moderation methods.
    const apiComment = await context.reddit.getCommentById(commentId);
    // remove() exists on API model comments.
    await apiComment.remove();
    return true;
  } catch (err) {
    console.error('Stage6: failed to remove comment', commentId, err);
    return false;
  }
}

/**
 * Ensures we only ever action "subsequent" comments:
 * - value-once uses a simple marker per user per post (first value-policing comment sets it)
 * - dogpile tracks a rolling count of timestamps per user per post
 */
function valueOnceKey(postId: string, username: string): string {
  return `valueOnce:${postId}:${username.toLowerCase()}`;
}
function dogpileKey(postId: string, username: string): string {
  return `dogpile:${postId}:${username.toLowerCase()}`;
}

async function getJsonKV<T>(context: Devvit.Context, key: string, fallback: T): Promise<T> {
  // IMPORTANT: Use the same persistent KV store as the rest of the app.
  // Some Devvit runtimes return either a string OR an object wrapper (e.g. { value: "..." }).
  const kvStore = (context as any).kvStore ?? (context as any).kv;
  if (!kvStore) return fallback;

  let raw: any;
  try {
    raw = await kvStore.get(key);
  } catch {
    return fallback;
  }
  if (raw === undefined || raw === null) return fallback;

  // Unwrap common shapes
  if (typeof raw === 'object') {
    if ('value' in raw) raw = (raw as any).value;
    else if ('data' in raw && typeof (raw as any).data === 'string') raw = (raw as any).data;
  }

  if (raw === undefined || raw === null) return fallback;

  // Devvit KV is usually string-based; we store JSON.
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return fallback;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return (raw as unknown) as T;
    }
  }

  // If already-parsed (rare), return as-is.
  return raw as T;
}
async function setJsonKV<T>(context: Devvit.Context, key: string, value: T): Promise<void> {
  const kvStore = (context as any).kvStore ?? (context as any).kv;
  if (!kvStore) return;
  // Store JSON so reads are stable across environments.
  try {
    await kvStore.put(key, JSON.stringify(value));
  } catch (e) {
    console.log('Stage6: setJsonKV failed for key=', key, 'err=', e);
  }
}


// ---------- Classifier (Stage 1) ----------

async function classifyComment(
  body: string,
  context: Devvit.Context
): Promise<FlagType[]> {
  const text = body.toLowerCase();
  console.log('classifyComment: body =', body);

  const scamWords = await loadPhraseList(context, 'scam_phrases', [
    'scammer',
    'this is a scam',
    'such a scam',
    'you are scamming',
    'youre scamming',
  ]);
  const harassmentWords = await loadPhraseList(
    context,
    'harassment_phrases',
    [
      'are you stupid',
      'you are stupid',
      'youre stupid',
      'you are dumb',
      'youre dumb',
      'you must be blind',
      'touch grass',
    ]
  );
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

  const scamEnabled =
    ((await context.settings.get('enable_scam_flags')) as boolean | undefined) !==
    false;
  const harassmentEnabled =
    ((await context.settings.get(
      'enable_harassment_flags'
    )) as boolean | undefined) !== false;
  const policingEnabled =
    ((await context.settings.get(
      'enable_policing_flags'
    )) as boolean | undefined) !== false;

  const scamHit = scamEnabled && scamWords.some((w) => text.includes(w));
  const harassHit =
    harassmentEnabled && harassmentWords.some((w) => text.includes(w));
  const policingHit =
    policingEnabled && policingWords.some((w) => text.includes(w));

  console.log('classifyComment: scamWords =', scamWords, 'hit =', scamHit);
  console.log(
    'classifyComment: harassmentWords =',
    harassmentWords,
    'hit =',
    harassHit
  );
  console.log(
    'classifyComment: policingWords =',
    policingWords,
    'hit =',
    policingHit
  );

  if (scamHit) flags.push('SCAM_ACCUSATION');
  if (harassHit) flags.push('HARASSMENT');
  if (policingHit) flags.push('VALUE_POLICING');

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

// ---------- Stage 5.4: delayed vote signal (KV job queue) ----------

async function getVoteSignalConfig(context: Devvit.Context): Promise<{
  enabled: boolean;
  delayMs: number;
  scoreThreshold: number;
  points: number;
  maxJobsPerRun: number;
}> {
  const enabled = (await context.settings.get('vote_signal_enabled')) as
    | boolean
    | undefined;

  const delayMinutesRaw = (await context.settings.get(
    'vote_signal_delay_minutes'
  )) as number | undefined;

  const scoreThresholdRaw = (await context.settings.get(
    'vote_signal_score_threshold'
  )) as number | undefined;

  const pointsRaw = (await context.settings.get('vote_signal_points')) as
    | number
    | undefined;

  const maxJobsRaw = (await context.settings.get(
    'vote_signal_max_jobs_per_run'
  )) as number | undefined;

  const delayMinutes =
    typeof delayMinutesRaw === 'number' && isFinite(delayMinutesRaw)
      ? Math.max(0, delayMinutesRaw)
      : 60;

  const scoreThreshold =
    typeof scoreThresholdRaw === 'number' && isFinite(scoreThresholdRaw)
      ? scoreThresholdRaw
      : -5;

  const points =
    typeof pointsRaw === 'number' && isFinite(pointsRaw)
      ? Math.max(0, Math.floor(pointsRaw))
      : 1;

  const maxJobsPerRun =
    typeof maxJobsRaw === 'number' && isFinite(maxJobsRaw)
      ? Math.max(0, Math.floor(maxJobsRaw))
      : 3;

  return {
    enabled: enabled === true,
    delayMs: delayMinutes * 60_000,
    scoreThreshold,
    points,
    maxJobsPerRun,
  };
}

async function enqueueVoteCheckJob(
  context: Devvit.Context,
  job: VoteCheckJob
): Promise<void> {
  const kv = context.kvStore;
  if (!kv) return;

  const existing = (await kv.get<VoteCheckJob[]>(VOTE_JOBS_KEY)) ?? [];

  // de-dupe by commentId
  if (existing.some((j) => j.commentId === job.commentId)) {
    console.log('Stage5.4: vote job already queued for', job.commentId);
    return;
  }

  const updated = [...existing, job];

  // tiny safety cap so the list can’t grow forever if something goes wrong
  const capped = updated.length > 500 ? updated.slice(updated.length - 500) : updated;

  await kv.put(VOTE_JOBS_KEY, capped);
  console.log(
    'Stage5.4: queued vote check job',
    'commentId=',
    job.commentId,
    'user=',
    job.username,
    'checkAt=',
    new Date(job.checkAt).toISOString()
  );
}

async function fetchCommentScoreBestEffort(
  context: Devvit.Context,
  commentId: string
): Promise<number | null> {
  const { reddit } = context;

  // API shape varies across SDK versions; try a couple of safe calls.
  try {
    // @ts-expect-error: SDK may expose this helper
    const c1 = await reddit.getCommentById(commentId);
    const score = (c1 as any)?.score;
    if (typeof score === 'number') return score;
  } catch (e) {
    // ignore
  }

  try {
    // @ts-expect-error: SDK may expose this helper with object arg
    const c2 = await reddit.getCommentById({ id: commentId });
    const score = (c2 as any)?.score;
    if (typeof score === 'number') return score;
  } catch (e) {
    // ignore
  }

  // If we can't fetch, return null (don't crash the pipeline).
  return null;
}

async function processDueVoteJobs(
  context: Devvit.Context
): Promise<void> {
  const kv = context.kvStore;
  if (!kv) return;

  const cfg = await getVoteSignalConfig(context);
  if (!cfg.enabled) return;

  const jobs = (await kv.get<VoteCheckJob[]>(VOTE_JOBS_KEY)) ?? [];
  if (jobs.length === 0) return;

  const now = Date.now();
  const due = jobs.filter((j) => j.checkAt <= now);
  if (due.length === 0) return;

  const toRun = due.slice(0, cfg.maxJobsPerRun);

  console.log(
    'Stage5.4: processing vote jobs',
    'due=',
    due.length,
    'running=',
    toRun.length,
    'total=',
    jobs.length
  );

  const remaining = jobs.filter((j) => !toRun.some((r) => r.commentId === j.commentId));

  for (const job of toRun) {
    try {
      const score = await fetchCommentScoreBestEffort(context, job.commentId);
      console.log('Stage5.4: fetched score', 'commentId=', job.commentId, 'score=', score);

      if (score === null) {
        console.log('Stage5.4: could not fetch comment score; dropping job', job.commentId);
        continue;
      }

      if (score <= cfg.scoreThreshold) {
        console.log(
          'Stage5.4: score threshold met',
          'commentId=',
          job.commentId,
          'score=',
          score,
          'threshold=',
          cfg.scoreThreshold,
          'points=',
          cfg.points
        );

        const conduct = await getUserConduct(context, job.username);
        const oldScore = conduct.score;

        conduct.score = Math.max(0, conduct.score + cfg.points);

        // we also track it in the event log as a separate reason
        await saveUserConduct(context, job.username, conduct);
        await addUserToIndex(context, job.username);

        const ev: ConductEvent = {
          commentId: job.commentId,
          permalink: job.permalink,
          flags: job.flags,
          delta: cfg.points,
          createdAt: new Date().toISOString(),
          reason: 'VOTE_SIGNAL',
        };
        await addConductEvent(context, job.username, ev);

        console.log(
          'Stage5.4: applied vote signal points',
          'user=',
          job.username,
          'oldScore=',
          oldScore,
          'newScore=',
          conduct.score
        );
      } else {
        console.log('Stage5.4: score threshold NOT met', 'commentId=', job.commentId);
      }
    } catch (err) {
      console.error('Stage5.4: error processing vote job', job.commentId, err);
    }
  }

  // Save remaining jobs
  await kv.put(VOTE_JOBS_KEY, remaining);
  console.log('Stage5.4: remaining vote jobs after processing =', remaining.length);
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

    // Stage5.4: process delayed vote-signal jobs (best-effort)
    try {
      await processDueVoteJobs(context);
    } catch (err) {
      console.error('Stage5.4: processDueVoteJobs error', err);
    }

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

    const nowIso = new Date().toISOString();

    // Threshold config
    const threshold = await getAlertThreshold(context);
    console.log('CommentCreate: threshold from settings =', threshold);

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
        // Stage5.4: enqueue delayed vote-score check (weak signal)
        try {
          const cfg = await getVoteSignalConfig(context);
          if (cfg.enabled && cfg.delayMs > 0 && username) {
            const commentId = comment.id ?? event.comment?.id ?? '';
            const postId = comment.postId ?? event.post?.id ?? '';
            const permalink = `https://reddit.com${comment.permalink}`;
            if (commentId && postId) {
              const job: VoteCheckJob = {
                commentId,
                username: username.toLowerCase(),
                postId,
                permalink,
                flags,
                createdAt: nowIso,
                checkAt: Date.now() + cfg.delayMs,
              };
              await enqueueVoteCheckJob(context, job);
            } else {
              console.log(
                'Stage5.4: skipping enqueue (missing ids)',
                'commentId=',
                commentId,
                'postId=',
                postId
              );
            }
          }
        } catch (err) {
          console.error('Stage5.4: failed to enqueue vote job', err);
        }

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
    // 
    // ---------- STAGE 6.x: Simple behavior guards (optional) ----------
    // These are intentionally minimal: a single toggle + action (reply/remove).

    const enableValueOnce = (await settings.get('enable_value_once_per_post')) as boolean | undefined;
    const enableDogpile = (await settings.get('enable_dogpile_guard')) as boolean | undefined;

    const postIdForGuards = comment.postId ?? post?.id;
    const usernameForGuards = username; // resolved earlier (string)

    if ((enableValueOnce || enableDogpile) && postIdForGuards && usernameForGuards) {
      // Shared mini-cooldown to reduce accidental RATELIMIT bursts for guard actions.
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();

      // 6.1 Value policing: only one per user per post
      if (enableValueOnce === true && flags.includes('VALUE_POLICING')) {
        const key = valueOnceKey(postIdForGuards, usernameForGuards);
        const existing = await getJsonKV<string | null>(context, key, null);

        console.log('Stage6.1: value-once check', 'key=', key, 'existing=', !!existing);

        if (!existing) {
          // First value-policing comment in this post for this user: mark and continue.
          await setJsonKV(context, key, nowIso);
          console.log('Stage6.1: marked first value-policing comment for user/post');
        } else {
          // Subsequent value-policing comment: action.
          const actionRaw = await settings.get('value_once_action');
          const actionNorm = normalizeSelectSetting(actionRaw, 'reply');
          const action = actionNorm === 'remove' ? 'remove' : 'reply';
          console.log('Stage6.1: triggered; actionRaw=', actionRaw, 'normalized=', actionNorm, 'final=', action);

          if (action === 'remove') {
            const removed = await tryRemoveComment(context, comment.id);
            console.log('Stage6.1: remove result=', removed);
          } else {
            const tpl =
              ((await settings.get('value_once_reply_template')) as string | undefined) ??
              'Hi u/{username} — please keep value feedback to **one comment per post**.';
            const replyBody = renderTemplate(tpl, {
              username: usernameForGuards,
              subreddit: subreddit.name,
            }).trim();

            console.log('Stage6.1: replying len=', replyBody.length);

            if (replyBody.length > 0) {
              await submitAutoReplyWithRetry(context, comment.id, replyBody, usernameForGuards);
            } else {
              console.log('Stage6.1: reply skipped (empty after trim)');
            }
          }

          // Stop further actions (prevents stacking Stage3 reply etc.)
          return;
        }
      }

      // 6.2 Dogpile / argument: too many comments on same post within a window
      if (enableDogpile === true) {
        const maxRaw = (await settings.get('dogpile_max_comments')) as number | undefined;
        const windowRaw = (await settings.get('dogpile_window_minutes')) as number | undefined;

        const maxComments = typeof maxRaw === 'number' && maxRaw > 0 ? maxRaw : 6;
        const windowMinutes = typeof windowRaw === 'number' && windowRaw > 0 ? windowRaw : 30;
        const windowMs = windowMinutes * 60 * 1000;

        const key = dogpileKey(postIdForGuards, usernameForGuards);
        const stamps = await getJsonKV<number[]>(context, key, []);

        const pruned = stamps.filter((ts) => nowMs - ts <= windowMs);
        pruned.push(nowMs);

        await setJsonKV(context, key, pruned);

        console.log(
          'Stage6.2: dogpile count',
          'key=',
          key,
          'count=',
          pruned.length,
          'max=',
          maxComments,
          'windowMin=',
          windowMinutes
        );

        if (pruned.length > maxComments) {
          const actionRaw = await settings.get('dogpile_action');
          const action = normalizeSelectSetting(actionRaw, 'reply');
          console.log('Stage6.2: triggered; action=', action);

          if (action === 'remove') {
            const removed = await tryRemoveComment(context, comment.id);
            console.log('Stage6.2: remove result=', removed);
          } else {
            const tpl =
              ((await settings.get('dogpile_reply_template')) as string | undefined) ??
              'Hi u/{username} — please avoid back-and-forth arguments.';
            const replyBody = renderTemplate(tpl, {
              username: usernameForGuards,
              subreddit: subreddit.name,
            }).trim();

            console.log('Stage6.2: replying len=', replyBody.length);

            if (replyBody.length > 0) {
              await submitAutoReplyWithRetry(context, comment.id, replyBody, usernameForGuards);
            } else {
              console.log('Stage6.2: reply skipped (empty after trim)');
            }
          }

          return;
        }
      }
    } else if (enableValueOnce || enableDogpile) {
      console.log(
        'Stage6: skipped (missing postId/username)',
        'postId=',
        postIdForGuards,
        'username=',
        usernameForGuards
      );
    }

	    // ==========================
	    // STAGE 3 – Auto reply logic
	    // ==========================

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

        console.log(
          'CommentCreate: Stage 3 offense state',
          'isFirstOffense =',
          isFirstOffense,
          'priorRecentCount =',
          priorRecentCount,
          'onFirst =',
          onFirst,
          'onRepeat =',
          onRepeat
        );

        let shouldReply = false;
        if (isFirstOffense && onFirst) {
          shouldReply = true;
        } else if (!isFirstOffense && onRepeat) {
          shouldReply = true;
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
