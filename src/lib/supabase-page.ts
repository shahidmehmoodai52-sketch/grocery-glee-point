/**
 * Fetch all rows from a Supabase query builder, paging past the 1000-row cap.
 */
export async function fetchAll<T>(
  build: any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  // Safety cap (200,000 rows max) to prevent UI blocking.
  for (let i = 0; i < 200; i++) {
    const to = from + pageSize - 1;
    
    // Execute the builder with range parameters.
    // We cast to any to handle cases where the builder might be wrapped in closures.
    const response = await (build as any)(from, to);
    
    const { data, error } = response || {};
    if (error) throw error;
    
    const rows = (data ?? []) as T[];
    all.push(...rows);
    
    // Exit if we've retrieved all available records.
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
