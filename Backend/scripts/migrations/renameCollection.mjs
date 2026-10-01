/**
 * Rename a collection, waiting out an index build the app may be running on
 * it (the server refuses a rename meanwhile). Used by the --drop-old steps.
 */
export async function renameWhenIdle(collection, name, { tries = 10, waitMs = 1000 } = {}) {
    for (let i = 1; ; i += 1) {
        try {
            return await collection.rename(name);
        } catch (err) {
            const building = /index build/i.test(String(err?.message || ''));
            if (!building || i >= tries) throw err;
            await new Promise((r) => setTimeout(r, waitMs));
        }
    }
}
