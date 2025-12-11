import { Devvit, CommentCreate, SettingScope } from '@devvit/public-api';

type FlagType = 'SCAM_ACCUSATION' | 'HARASSMENT' | 'VALUE_POLICING';

interface UserConduct {
  score: number;
  scamFlags: number;
  harassmentFlags: number;
  valueFlags: number;
  lastUpdated: string; // ISO
}

const CONDUCT_USERS_KEY = 'conduct_users';

// ---------- Settings ----------

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
    defaultValue: false,
  },
  {
    type: 'boolean',
    name: 'report_to_modqueue',
    label: 'Create a report in modqueue for flagged comments',
    scope: SettingScope.Installation,
    defaultValue: true,
  },
  {
    type: 'string',
    name: 'monitored_post_flairs',
    label:
      'Only monitor comments on posts with these POST FLAIR texts (comma or newline separated). Leave blank to monitor all posts.',
    scope: SettingScope.Installation,
    defaultValue: '',
  },
  {
    type: 'string',
    name: 'dev_override_username',
    label:
      'DEV ONLY: Override username (for dev subs). Leave blank in production.',
    scope: SettingScope.Installation,
    defaultValue: '',
  },
]);

Devvit.configure({
  redditAPI: true,
  modMail: true,
  kvStore: true,
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

/**
 * Resolve a username using:
 *  0) dev_override_username (for dev subs / testing)
 *  1) event.author?.name
 *  2) comment.getAuthorName()
 *  3) comment.authorName
 */
async function resolveUsername(
  context: Devvit.Context,
  event: CommentCreate
): Promise<string | undefined> {
  const comment = event.comment;
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

  // 0) DEV override
  const devOverride = (await context.settings.get(
    'dev_override_username'
  )) as string | undefined;
  if (devOverride && devOverride.trim().length > 0) {
    const trimmed = devOverride.trim();
    console.log('resolveUsername: using dev_override_username =', trimmed);
    return trimmed;
  }

  // 1) event.author.name (what your log shows)
  if (eventAuthor?.name) {
    console.log('resolveUsername: using event.author.name =', eventAuthor.name);
    return eventAuthor.name;
  }

  // 2) API-backed method (may not exist in this environment)
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

  // 3) comment.authorName field (if Devvit ever fills it)
  if ((comment as any).authorName) {
    console.log(
      'resolveUsername: using comment.authorName =',
      (comment as any).authorName
    );
    return (comment as any).authorName;
  }

  console.log('resolveUsername: username missing (fallback failed)');
  return undefined;
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

  const scamHit = scamWords.some((w) => text.includes(w));
  const harassHit = harassmentWords.some((w) => text.includes(w));
  const policingHit = policingWords.some((w) => text.includes(w));

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

// ---------- KV helpers (Stage 2 – scoring) ----------

function conductKeyForUser(username: string): string {
  return `conduct:${username.toLowerCase()}`;
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

  if (stored) {
    return stored;
  }

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

// ---------- Mod commands (top offenders, user report) ----------

async function commandTopOffenders(
  context: Devvit.Context,
  subredditId: string
): Promise<void> {
  const { reddit, kvStore } = context;
  console.log('commandTopOffenders: kvStore exists =', !!kvStore);
  if (!kvStore) {
    console.log('commandTopOffenders: kvStore missing, sending KV error modmail');
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] KV not available',
      bodyMarkdown:
        'KV is not available for this app. Please check Devvit.configure and permissions.',
    });
    return;
  }

  console.log('commandTopOffenders: fetching index from kvStore');
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
    console.log('commandTopOffenders: sent "no tracked users" modmail');
    return;
  }

  const records: { username: string; conduct: UserConduct }[] = [];

  for (const uname of users) {
    console.log('commandTopOffenders: loading conduct for', uname);
    const conduct = await getUserConduct(context, uname);
    console.log('commandTopOffenders: conduct for', uname, '=', conduct);
    if (conduct.score > 0) {
      records.push({ username: uname, conduct });
    } else {
      console.log('commandTopOffenders:', uname, 'has non-positive score, skipping');
    }
  }

  console.log('commandTopOffenders: records with positive score =', records);

  if (records.length === 0) {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] Top offenders – none with positive score',
      bodyMarkdown:
        'No users currently have a positive CommentGuardian score.',
    });
    console.log('commandTopOffenders: sent "no positive scores" modmail');
    return;
  }

  records.sort((a, b) => b.conduct.score - a.conduct.score);
  const top = records.slice(0, 20);

  console.log('commandTopOffenders: top offenders =', top);

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
  console.log('commandTopOffenders: modmail sent with top offenders');
}

async function commandUserReport(
  context: Devvit.Context,
  subredditId: string,
  args: string[]
): Promise<void> {
  const { reddit } = context;

  console.log('commandUserReport: args =', args);

  if (args.length === 0) {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: '[CommentGuardian] User report – missing username',
      bodyMarkdown: 'Usage: `!cg-user username`',
    });
    console.log('commandUserReport: missing username, sent usage modmail');
    return;
  }

  const username = args[0].replace(/^u\//i, '');
  console.log('commandUserReport: generating report for', username);

  const conduct = await getUserConduct(context, username);

  const lines: string[] = [];
  lines.push(
    `**CommentGuardian user report: u/${username}**`,
    '',
    `• Score: ${conduct.score}`,
    `• Scam flags: ${conduct.scamFlags}`,
    `• Harassment flags: ${conduct.harassmentFlags}`,
    `• Policing flags: ${conduct.valueFlags}`,
    `• Last updated: ${conduct.lastUpdated}`
  );

  await reddit.modMail.createModInboxConversation({
    subredditId,
    subject: `[CommentGuardian] User report for u/${username}`,
    bodyMarkdown: lines.join('\n'),
  });
  console.log('commandUserReport: modmail sent for user', username);
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

  try {
    if (cmd === '!cg-top') {
      console.log('handleModCommand: dispatching to commandTopOffenders');
      await commandTopOffenders(context, subreddit.id);
    } else if (cmd === '!cg-user') {
      console.log('handleModCommand: dispatching to commandUserReport');
      await commandUserReport(context, subreddit.id, args);
    } else {
      console.log('handleModCommand: unknown command, doing nothing');
    }
  } catch (err) {
    console.error('handleModCommand: error handling mod command', err);
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
    );

    // Commands
    if (bodyLower.startsWith('!cg-')) {
      console.log('CommentCreate: detected command, routing to handleModCommand');
      await handleModCommand(event, context);
      console.log('CommentCreate: END (command path)');
      return;
    }

    // Flair filter (optional)
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

    // Skip mods/admins (optional)
    const eventAuthor: any = (event as any).author;
    if (eventAuthor?.isAdmin || eventAuthor?.isMod) {
      console.log(
        'CommentCreate: skipping comment from mod/admin',
        'isAdmin =',
        eventAuthor?.isAdmin,
        'isMod =',
        eventAuthor?.isMod
      );
      console.log('CommentCreate: END (mod/admin)');
      return;
    }

    // Classify
    const flags = await classifyComment(comment.body, context);
    console.log('CommentCreate: classification flags =', flags);

    if (flags.length === 0) {
      console.log('CommentCreate: no flags detected, nothing else to do');
      console.log('CommentCreate: END (no flags)');
      return;
    }

    const flagList = flags.join(', ');

    // Resolve username
    const username = await resolveUsername(context, event);
    console.log('CommentCreate: Username resolution result =', username);

    if (!username) {
      console.log(
        'CommentCreate: no username available, skipping scoring but will still report'
      );
    } else {
      try {
        console.log('CommentCreate: entering scoring logic for', username);
        const oldConduct = await getUserConduct(context, username);
        const conduct: UserConduct = { ...oldConduct };

        let delta = 0;
        if (flags.includes('SCAM_ACCUSATION')) {
          conduct.scamFlags += 1;
          delta += 3;
        }
        if (flags.includes('HARASSMENT')) {
          conduct.harassmentFlags += 1;
          delta += 4;
        }
        if (flags.includes('VALUE_POLICING')) {
          conduct.valueFlags += 1;
          delta += 1;
        }

        conduct.score += delta;

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

        await saveUserConduct(context, username, conduct);
        await addUserToIndex(context, username);
      } catch (err) {
        console.error('CommentCreate: error during scoring / KV operations', err);
      }
    }

    const usernameForDisplay = username ?? '[unknown]';

    const preview =
      comment.body.length > 400
        ? comment.body.slice(0, 400) + '…'
        : comment.body;

    // Settings
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

    // Report to modqueue
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

    // Optional per-comment modmail
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

    console.log('CommentCreate: END (normal path)');
  },
});

export default Devvit;
