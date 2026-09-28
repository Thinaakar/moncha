-- Messaging-app links are contact channels, not assistants.
ALTER TYPE "ChannelType" ADD VALUE IF NOT EXISTS 'messenger';
ALTER TYPE "ChannelType" ADD VALUE IF NOT EXISTS 'telegram';
ALTER TYPE "ChannelType" ADD VALUE IF NOT EXISTS 'line';
ALTER TYPE "ChannelType" ADD VALUE IF NOT EXISTS 'viber';
