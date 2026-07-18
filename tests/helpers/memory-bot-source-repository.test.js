import { expect, test } from '@jest/globals';
import createMemoryBotSourceRepository from './memory-bot-source-repository.js';

test('memory repository preserves activation state without a runtime environment branch', async () => {
  const repository = createMemoryBotSourceRepository();
  await repository.ensureBotSource({
    sourceKey: 'U1', sourceType: 'user', defaultActivated: true, maxSources: 1,
  });

  await repository.setBotSourceActivation('U1', false);

  await expect(repository.ensureBotSource({
    sourceKey: 'U1', sourceType: 'user', defaultActivated: true, maxSources: 1,
  })).resolves.toEqual({ source_type: 'user', is_activated: false });
});

test('memory repository enforces the same per-type limit contract', async () => {
  const repository = createMemoryBotSourceRepository();
  await repository.ensureBotSource({
    sourceKey: 'U1', sourceType: 'user', defaultActivated: true, maxSources: 1,
  });

  await expect(repository.ensureBotSource({
    sourceKey: 'U2', sourceType: 'user', defaultActivated: true, maxSources: 1,
  })).rejects.toMatchObject({ code: 'SOURCE_LIMIT_REACHED', sourceType: 'user' });
});
