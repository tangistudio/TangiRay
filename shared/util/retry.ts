export async function retry<T>(action: () => T | Promise<T>, attempts = 100, delay = 100): Promise<T> {
    for (let i = 0; i <= attempts; i++) {
        try {
            const result = await action();
            if (i > 0) {
                console.debug(`retry succeeded after ${i} attempts.`)
            }
            return result;
        } catch (e) {
            if (i < attempts) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            } else {
                throw new Error(`Action failed after ${attempts + 1} attempts.`, { cause: e });
            }
        }
    }
    throw new Error('Impossible to reach this point without either succeeding or exhausting all attempts.');
}
