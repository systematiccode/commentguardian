# CommentGuardian (Devvit) — r/PokemonGoTrade Moderation Bot

CommentGuardian is a production-safety-first Devvit moderation bot focused on reducing scam accusations, value policing, and dogpiling in comments—without creating reply loops and while remaining rate-limit aware.

---

## What this bot does

### Comment classification
The bot classifies comments into:
- Scam accusations
- Value policing
- Harassment

Classification results drive scoring, enforcement, and escalation logic.

---

### Conduct scoring and history
- Tracks per-user conduct using KV storage
- Maintains flag counts and scores
- Supports time-based reset windows
- Designed to be resilient to retries and partial failures

---

### Auto-reply system
- Configurable for:
  - First offense only
  - Repeat offense only
  - Both
- Built-in safeguards:
  - Skips bot-authored comments
  - Only acts on top-level comments (no replies)
  - Per-user cooldowns
  - Retry and rate-limit handling

---

### Vote-based signals
- Vote jobs are scheduled and processed reliably
- Feature can be enabled or disabled via settings
- Safe to run alongside comment handlers

---

### Anti-dogpiling and value-policing controls

#### Value policing once per user per post
- Prevents repeated value-policing by the same user in a single post
- First instance allowed or replied to
- Second and subsequent instances trigger enforcement

#### Dogpiling detection
- Detects repeated flagged behavior by a user within a post
- Uses configurable time windows and thresholds
- Action is configurable (reply or remove)

---

### Trade-count flair gate
- Code includes a newer flair-gating integration
- Moderator exemptions are supported
- Policy thresholds and enforcement rules are still evolving

---

## Moderator commands (CG codes)

Moderator commands are issued via comments starting with `!cg-`.
Only subreddit moderators can use these commands.

### Available commands

- **!cg-top**  
  Shows the top offenders leaderboard.

- **!cg-user <username>**  
  Displays a detailed conduct summary for a specific user.

- **!cg-over <number>**  
  Lists all users with a score greater than or equal to the given number.

- **!cg-reset <username>**  
  Resets the specified user's conduct history and score.

- **!cg-clean**  
  Triggers the cleanup routine based on reset window logic.

- **!cg-add <username> <points>**  
  Adds points to a user's score.

- **!cg-deduct <username> <points>**  
  Deducts points from a user's score (will not go below zero).

### Optional command behavior
- The bot can be configured to automatically remove moderator command comments after execution to keep threads clean.

---

## Configuration overview (Devvit settings)

Common configurable areas include:
- Auto-reply enablement and offense mode
- Cooldowns and rate-limit behavior
- Vote-based signal enablement
- Stage 6 thresholds and windows
- Action routing (reply vs remove)
- Flair gate behavior and exemptions
- Auto-removal of moderator command comments

---

## Operational notes

- Designed to prevent bot loops
- Designed to prevent reply chains
- Safe under rate limits
- KV-backed state ensures consistency across restarts

---

## Intended usage

- Deploy via Devvit to the target subreddit
- Configure behavior through Devvit settings
- Monitor logs and modqueue
- Iterate only with small, additive changes

---

## Future enhancements

- Finalize trade-count flair gate rules
- Escalation tiers (warn → remove → stronger actions)
- Expanded moderator diagnostics
- Per-category action routing
- Add UI via menu
