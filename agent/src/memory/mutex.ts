export function createMutex() {
  const locks = new Map<string, Promise<void>>();

  async function withTopicLock<T>(
    topicId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (typeof fn !== "function") {
      throw new TypeError("fn must be a function");
    }

    while (locks.has(topicId)) {
      await locks.get(topicId);
    }

    const result = Promise.resolve(fn())
      .then((value) => {
        locks.delete(topicId);
        return value;
      })
      .catch((err) => {
        locks.delete(topicId);
        throw err;
      });

    const done = result.then(() => undefined, () => undefined);
    locks.set(topicId, done);

    return result;
  }

  return withTopicLock;
}

export const withTopicLock = createMutex();