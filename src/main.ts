import { Devvit, CommentCreate, SettingScope } from '@devvit/public-api';

type FlagType = 'SCAM_ACCUSATION' | 'HARASSMENT' | 'VALUE_POLICING';

/**
 * Settings – visible in the Devvit UI for this app
 */
Devvit.addSettings([
  {
    type: 'string',
    name: 'scam_phrases',
    label: 'Scam accusation phrases (comma or newline separated)',
    scope: SettingScope.Installation,
    defaultValue:
      'scammer,this is a scam,such a scam,you are scamming,youre scamming',
  },
  {
    type: 'string',
    name: 'harassment_phrases',
    label: 'Harassment / insult phrases (comma or newline separated)',
    scope: SettingScope.Installation,
    defaultValue:
      'are you stupid,you are stupid,youre stupid,you are dumb,youre dumb,you must be blind,touch grass',
  },
  {
    type: 'string',
    name: 'value_policing_phrases',
    label: 'Aggressive value policing phrases (comma or newline separated)',
    scope: SettingScope.Installation,
    defaultValue:
      'ripoff,rip-off,trash offer,clown trade,terrible value,insane offer,this is ridiculous,greedy',
  },
  {
    type: 'boolean',
    name: 'notify_via_modmail',
    label: 'Send Modmail alerts for flagged comments',
    scope: SettingScope.Installation,
    defaultValue: false, // off by default to avoid mail spam
  },
  {
    type: 'boolean',
    name: 'report_to_modqueue',
    label: 'Create a report in modqueue for flagged comments',
    scope: SettingScope.Installation,
    defaultValue: true, // ON by default
  },
  {
    type: 'string',
    name: 'monitored_post_flairs',
    label:
      'Only monitor comments on posts with these POST FLAIR texts (comma or newline separated). Leave blank to monitor all posts.',
    scope: SettingScope.Installation,
    defaultValue: '',
  },
]);

Devvit.configure({
  redditAPI: true,
  modMail: true,
});

/**
 * Helper: load comma/newline separated phrases from settings
 */
async function loadPhraseList(
  context: Devvit.Context,
  key: string,
  fallback: string[]
): Promise<string[]> {
  const raw = (await context.settings.get(key)) as string | undefined;
  if (!raw) return fallback;

  return raw
    .split(/[\n\r,]+/) // split on comma or newline, NOT spaces (so multi-word phrases work)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0);
}

/**
 * Stage 1 classifier using config values
 */
async function classifyComment(
  body: string,
  context: Devvit.Context
): Promise<FlagType[]> {
  const text = body.toLowerCase();

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

  if (scamWords.some((w) => text.includes(w))) {
    flags.push('SCAM_ACCUSATION');
  }
  if (harassmentWords.some((w) => text.includes(w))) {
    flags.push('HARASSMENT');
  }
  if (policingWords.some((w) => text.includes(w))) {
    flags.push('VALUE_POLICING');
  }

  return flags;
}

/**
 * Trigger: runs on every new comment
 * Stage 1 = reporting (modqueue + optional modmail)
 */
Devvit.addTrigger({
  event: 'CommentCreate',
  async onEvent(event: CommentCreate, context) {
    const comment = event.comment;
    const subreddit = event.subreddit;
    const post = event.post; // needed for post flair
    if (!comment || !subreddit) return;

    const { reddit, settings } = context;

    // 🔹 1) OPTIONAL: filter by POST FLAIR
    const monitoredFlairsRaw = (await settings.get(
      'monitored_post_flairs'
    )) as string | undefined;

    if (monitoredFlairsRaw && monitoredFlairsRaw.trim().length > 0) {
      const allowedFlairs = monitoredFlairsRaw
        .split(/[\n\r,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const postFlairText =
        post?.linkFlair?.text?.toLowerCase().trim() ?? '';

      // If the post has no flair, or flair not in allowed list → ignore this comment
      if (!postFlairText || !allowedFlairs.includes(postFlairText)) {
        return;
      }
    }
    // If monitored_post_flairs is blank, we monitor all posts.

    // 🔹 2) Skip mods/admins (optional)
    if (comment.author?.isAdmin || comment.author?.isMod) return;

    // 🔹 3) Classify comment
    const flags = await classifyComment(comment.body, context);
    if (flags.length === 0) return;

    const username = comment.authorName ?? '[unknown]';
    const flagList = flags.join(', ');

    // Shared preview text
    const preview =
      comment.body.length > 400
        ? comment.body.slice(0, 400) + '…'
        : comment.body;

    // 🔹 4) Read settings
    const modmailSetting = (await settings.get(
      'notify_via_modmail'
    )) as boolean | undefined;
    const reportSetting = (await settings.get(
      'report_to_modqueue'
    )) as boolean | undefined;

    const sendModmail = modmailSetting === true; // only if explicitly ON
    const reportToModqueue = reportSetting !== false; // default ON

    // 🔹 5) Option 1: create a report → shows up in modqueue
    if (reportToModqueue) {
      try {
        await reddit.report(comment, {
          reason: `[CommentGuardian] ${flagList}`,
        });
      } catch (err) {
        console.error('CommentGuardian: error reporting comment', err);
      }
    }

    // 🔹 6) Option 2: send a modmail alert
    if (sendModmail) {
      const permalink = `https://reddit.com${comment.permalink}`;

      const subject = `[CommentGuardian] ${flagList} from u/${username}`;
      const bodyMarkdown =
        `Detected flags: **${flagList}**\n\n` +
        `Subreddit: r/${subreddit.name}\n` +
        `Author: u/${username}\n\n` +
        `[View comment](${permalink})\n\n` +
        `---\n\n` +
        `Preview:\n\n> ${preview.replace(/\n/g, '\n> ')}`;

      try {
        await reddit.modMail.createModInboxConversation({
          subject,
          bodyMarkdown,
          subredditId: subreddit.id,
        });
      } catch (err) {
        console.error('CommentGuardian: error creating modmail', err);
      }
    }
  },
});

export default Devvit;
