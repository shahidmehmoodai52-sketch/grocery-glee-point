/**
 * Fetch all rows from a Supabase query builder, paging past the 1000-row cap.
 * 
 * This utility handles the 1000-row limit in Supabase by recursively fetching
 * pages until all data is retrieved.
 */
export async function fetchAll<T>(
  build: any,
  pageSizeOrLegacyOrder?: any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  
  const actualPageSize = typeof pageSizeOrLegacyOrder === 'number' ? pageSizeOrLegacyOrder : pageSize;

  // Safety cap (200 * 1000 = 200,000 rows max) to prevent runaway loops.
  for (let i = 0; i < 200; i++) {
    const to = from + actualPageSize - 1;
    
    // We use 'any' for the builder call to bypass strict TypeScript signature checks
    // at the hundreds of call sites across the project that expect different parameter counts.
    const response = await build(from, to);
    
    const { data, error } = response || {};
    if (error) throw error;
    
    const rows = (data ?? []) as T[];
    all.push(...rows);
    
    // If we got fewer rows than requested, we've reached the end.
    if (rows.length < actualPageSize) break;
    from += actualPageSize;
  }
  return all;
}
