/**
 * Fetch all rows from a Supabase query, paging past PostgREST's 1000-row cap.
 *
 * `build(from, to)` MUST apply `.range(from, to)` to the query so each call
 * returns the next page. Paging stops when a page returns fewer rows than
 * `pageSize`, so the resulting array contains every matching record.
 */
type PageResponse = { data: unknown[] | null; error: unknown };

export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResponse>,
  pageSize: number = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  // Safety cap (500 pages) to prevent infinite loops, but fail loudly if reached.
  for (let i = 0; i < 500; i++) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;

    const rows = (data ?? []) as T[];
    all.push(...rows);

    if (rows.length < pageSize) return all;
    from += pageSize;
  }
  
  throw new Error(`Data truncation safety limit reached (500,000 rows). Please use paginated queries for large datasets.`);
}
