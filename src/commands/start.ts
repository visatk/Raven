export interface Env {
  DB: D1Database;
}

// Define the expected Telegram Message structure
export interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  text?: string;
}

/**
 * Handles general bot commands and manages user registration in Cloudflare D1.
 * 
 * @param message The Telegram message object
 * @param env The Cloudflare worker environment variables/bindings
 * @returns Formatted Markdown string to send back to Telegram, or null if no command matched
 */
export async function handleGeneralCommands(
  message: TelegramMessage,
  env: Env
): Promise<string | null> {
  const text = message.text || '';
  const chatId = message.chat.id;
  const userId = message.from.id;
  const firstName = message.from.first_name || 'User';
  const username = message.from.username || 'none';

  // 1. Silent DB Registration / Update (Upsert)
  // We execute this asynchronously so it doesn't block the command response
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO users (user_id, username, first_name, role, created_at, last_interaction)
         VALUES (?, ?, ?, 'user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
         username = excluded.username,
         first_name = excluded.first_name,
         last_interaction = CURRENT_TIMESTAMP;`
      ).bind(userId, username, firstName).run();
    } catch (error) {
      console.error("D1 Database Error:", error);
      // In a production environment, you might log this to Axiom or Cloudflare Tail Workers
    }
  }

  // 2. Command Routing
  if (text.startsWith('/start')) {
    return `👋 **Welcome to RavenHQ, ${firstName}!**\n\n` +
           `Your profile has been successfully registered.\n` +
           `I am an advanced edge-deployed utility bot designed for high performance.\n\n` +
           `Type /help to discover my capabilities.`;
  }

  if (text.startsWith('/help')) {
    return `🛡️ **RavenHQ Command Center** 🛡️\n\n` +
           `🔹 **/start** - Initialize bot & sync profile\n` +
           `🔹 **/help** - Display this command menu\n` +
           `🔹 **/id** - Retrieve your secure Telegram identifiers\n` +
           `🔹 **/gen [BIN] [AMT]** - Generate algorithmic CCs\n` +
           `🔹 **/chk [CC]** - Validate card status\n` +
           `🔹 **/fake** - Generate localized identity data\n\n` +
           `_Infrastructure powered by Cloudflare Edge & D1 Serverless SQL._`;
  }

  if (text.startsWith('/id')) {
    return `🆔 **Identity**\n\n` +
           `👤 **User ID:** \`${userId}\`\n` +
           `💬 **Chat ID:** \`${chatId}\`\n` +
           `📛 **Username:** ${username !== 'none' ? `@${username}` : 'Not set'}\n` +
           `🏷️ **First Name:** ${firstName}\n\n` +
           `_Note: User ID acts as your primary key in the RavenHQ database._`;
  }

  // Return null if the text doesn't match these general commands, 
  // allowing the main bot router to pass it to other command handlers (like /gen or /chk)
  return null;
}
