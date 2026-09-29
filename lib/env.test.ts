import { describe, expect, it } from 'vitest';
import { parseEnv, parseTrustedOrigins } from './env';

const valid = {
  MONGODB_URI: 'mongodb://localhost:27017',
  CMS_JWT_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies application and session defaults without seed credentials', () => {
    const env = parseEnv(valid);
    expect(env).toMatchObject({
      PORT: 3003,
      MONGODB_DB_NAME: 'cognerd_cms',
      CMS_SESSION_HOURS: 12,
      CMS_SESSION_REMEMBER_DAYS: 30,
      CMS_TRUSTED_ORIGINS: [],
    });
    expect(env.CMS_SEED_ADMIN_EMAIL).toBeUndefined();
  });

  it('coerces positive integer port and session durations', () => {
    const env = parseEnv({
      ...valid,
      PORT: '4000',
      CMS_SESSION_HOURS: '6',
      CMS_SESSION_REMEMBER_DAYS: '14',
    });
    expect(env.PORT).toBe(4000);
    expect(env.CMS_SESSION_HOURS).toBe(6);
    expect(env.CMS_SESSION_REMEMBER_DAYS).toBe(14);
  });

  it('names required and invalid values', () => {
    expect(() => parseEnv({ ...valid, MONGODB_URI: undefined })).toThrow(/MONGODB_URI/);
    expect(() => parseEnv({ ...valid, CMS_JWT_SECRET: 'short' })).toThrow(/CMS_JWT_SECRET/);
    expect(() => parseEnv({ ...valid, CMS_SESSION_HOURS: '0' })).toThrow(/CMS_SESSION_HOURS/);
  });

  it('normalises optional seed values and enforces the password policy', () => {
    const env = parseEnv({
      ...valid,
      CMS_SEED_ADMIN_EMAIL: ' Admin@Example.COM ',
      CMS_SEED_ADMIN_PASSWORD: 'correct-horse-battery',
      CMS_SEED_ADMIN_NAME: '  Administrator  ',
    });
    expect(env.CMS_SEED_ADMIN_EMAIL).toBe('admin@example.com');
    expect(env.CMS_SEED_ADMIN_NAME).toBe('Administrator');
    expect(() => parseEnv({ ...valid, CMS_SEED_ADMIN_EMAIL: 'nope' })).toThrow(
      /CMS_SEED_ADMIN_EMAIL/,
    );
    expect(() => parseEnv({ ...valid, CMS_SEED_ADMIN_PASSWORD: 'too-short' })).toThrow(
      /CMS_SEED_ADMIN_PASSWORD/,
    );
    expect(() => parseEnv({ ...valid, CMS_SEED_ADMIN_PASSWORD: '😀'.repeat(19) })).toThrow(
      /72 UTF-8 bytes/,
    );
  });

  it('normalises the public CMS URL to an HTTP origin', () => {
    expect(
      parseEnv({ ...valid, NEXT_PUBLIC_CMS_URL: 'https://cms.example.com/' }).NEXT_PUBLIC_CMS_URL,
    ).toBe('https://cms.example.com');
    expect(() => parseEnv({ ...valid, NEXT_PUBLIC_CMS_URL: 'ftp://cms.example.com' })).toThrow(
      /http or https/,
    );
  });

  it('normalises native S3 configuration and leaves empty optional values unset', () => {
    const env = parseEnv({
      ...valid,
      S3_REGION: ' ap-south-1 ',
      S3_BUCKET_NAME: ' cognerd-cms-media ',
      S3_PUBLIC_URL: 'https://media.example.com/',
      SOURCE_MONGODB_URI: ' ',
    });
    expect(env.S3_REGION).toBe('ap-south-1');
    expect(env.S3_BUCKET_NAME).toBe('cognerd-cms-media');
    expect(env.S3_PUBLIC_URL).toBe('https://media.example.com');
    expect(env.SOURCE_MONGODB_URI).toBeUndefined();
  });

  it('keeps the optional AI assistant off unless a key is set, and checks the model list', () => {
    const off = parseEnv({ ...valid, OPENROUTER_API_KEY: ' ', OPENROUTER_MODELS: '' });
    expect(off.OPENROUTER_API_KEY).toBeUndefined();
    expect(off.OPENROUTER_MODELS).toBeUndefined();

    const on = parseEnv({
      ...valid,
      OPENROUTER_API_KEY: ' sk-or-v1-local ',
      OPENROUTER_MODELS: ' google/gemma-4-31b-it:free , openrouter/free ',
    });
    expect(on.OPENROUTER_API_KEY).toBe('sk-or-v1-local');
    expect(on.OPENROUTER_MODELS).toEqual(['google/gemma-4-31b-it:free', 'openrouter/free']);
    expect(() => parseEnv({ ...valid, OPENROUTER_MODELS: 'gpt 4' })).toThrow(/OPENROUTER_MODELS/);
    expect(() => parseEnv({ ...valid, OPENROUTER_MODELS: 'a/1,b/2,c/3,d/4' })).toThrow(/at most 3/);
  });
});

describe('parseTrustedOrigins', () => {
  it('trims, converts URLs to host[:port], and deduplicates in order', () => {
    expect(
      parseTrustedOrigins(
        ' CMS.EXAMPLE.COM, https://proxy.example.com/,cms.example.com,localhost:3003 ',
      ),
    ).toEqual(['cms.example.com', 'proxy.example.com', 'localhost:3003']);
  });

  it('rejects paths, credentials, and non-http URL schemes', () => {
    expect(() => parseTrustedOrigins('https://example.com/path')).toThrow(/CMS_TRUSTED_ORIGINS/);
    expect(() => parseTrustedOrigins('https://user:pass@example.com')).toThrow(
      /CMS_TRUSTED_ORIGINS/,
    );
    expect(() => parseTrustedOrigins('ftp://example.com')).toThrow(/CMS_TRUSTED_ORIGINS/);
  });
});
