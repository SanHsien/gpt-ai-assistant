const sourceLimitError = (sourceType) => {
  const err = new Error(`maximum ${sourceType} sources reached`);
  err.code = 'SOURCE_LIMIT_REACHED';
  err.sourceType = sourceType;
  return err;
};

const createMemoryBotSourceRepository = () => {
  const sources = new Map();

  return {
    clear: () => sources.clear(),
    ensureBotSource: async ({
      sourceKey, sourceType, defaultActivated, maxSources,
    }) => {
      const key = `${sourceType}:${sourceKey}`;
      if (sources.has(key)) return sources.get(key);
      const count = [...sources.values()]
        .filter((source) => source.source_type === sourceType).length;
      if (count >= maxSources) throw sourceLimitError(sourceType);
      const source = {
        source_type: sourceType,
        is_activated: defaultActivated,
      };
      sources.set(key, source);
      return source;
    },
    setBotSourceActivation: async (sourceKey, isActivated) => {
      const entry = [...sources.entries()].find(([key]) => key.endsWith(`:${sourceKey}`));
      if (!entry) return null;
      const updated = { ...entry[1], is_activated: isActivated };
      sources.set(entry[0], updated);
      return updated;
    },
  };
};

export default createMemoryBotSourceRepository;
