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

  // Safety cap (200,000 rows max) to prevent runaway loops.
  for (let i = 0; i < 200; i++) {
    const to = from + actualPageSize - 1;
    
    // We call the builder as 'any' to avoid signature mismatch errors in components.
    // The range parameters (from, to) are passed but the component closure may not use them
    // if it was previously written for a non-paged fetchAll version.
    const response = await (build as any)(from, to);
    
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
