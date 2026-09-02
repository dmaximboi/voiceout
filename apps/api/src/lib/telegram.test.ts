import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { configuredAuthProviders, parseBotStartPayload, telegramLoginFromUpdate, validateTelegramLogin } from './telegram.js';

function signed(authDate: number, token = '123:secret') {
  const payload: Record<string, string> = {
    id: '123456789',
    first_name: 'Ada',
    username: 'ada_test',
    auth_date: String(authDate),
  };
  const check = Object.entries(payload)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHash('sha256').update(token).digest();
  payload.hash = createHmac('sha256', secret).update(check).digest('hex');
  return payload;
}

test('validates a fresh Telegram signature', () => {
  assert.equal(validateTelegramLogin(signed(1_000), '123:secret', 1_500)?.id, '123456789');
});

test('rejects stale, future, tampered and extra fields', () => {
  assert.equal(validateTelegramLogin(signed(1_000), '123:secret', 1_601), null);
  assert.equal(validateTelegramLogin(signed(2_000), '123:secret', 1_999), null);
  assert.equal(validateTelegramLogin({ ...signed(1_000), first_name: 'Mallory' }, '123:secret', 1_500), null);
  assert.equal(validateTelegramLogin({ ...signed(1_000), admin: 'true' }, '123:secret', 1_500), null);
});

test('parses bot start login payloads and ignores bots', () => {
  assert.equal(parseBotStartPayload('/start voaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(parseBotStartPayload('/start@voiceoutxyzbot voaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(parseBotStartPayload('/start http://localhost:3000'), null);
  assert.equal(
    telegramLoginFromUpdate({
      update_id: 1,
      message: { text: '/start voaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', from: { id: 9, first_name: 'Ada', is_bot: false } },
    })?.profile.id,
    '9',
  );
  assert.equal(
    telegramLoginFromUpdate({
      update_id: 1,
      message: { text: '/start voaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', from: { id: 9, is_bot: true } },
    }),
    null,
  );
});

test('only exposes fully configured launch providers', () => {
  assert.deepEqual(
    configuredAuthProviders({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: '',
      TELEGRAM_BOT_TOKEN: '123:secret',
      TELEGRAM_BOT_USERNAME: '@voiceout_bot',
    }),
    {
      email: true,
      google: false,
      telegram: true,
      telegramUsername: 'voiceout_bot',
      telegramBotId: '123',
    },
  );
});
