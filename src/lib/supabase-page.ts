// Fetch all rows from a Supabase query builder, paging past the 1000-row cap.
// Usage: await fetchAll((from, to) => supabase.from("products").select("*").order("name").range(from, to));
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Safety cap so a runaway loop never blocks the UI.
  for (let i = 0; i < 200; i++) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
