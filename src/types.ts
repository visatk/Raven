export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    from?: { id: number; username?: string; first_name?: string };
  };
  callback_query?: {
    id: string;
    data: string;
    message?: {
      message_id: number;
      chat: { id: number };
    };
    from: { id: number; username?: string; first_name?: string };
  };
}
