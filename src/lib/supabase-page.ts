/**
 * Fetch all rows from a Supabase query builder, paging past the 1000-row cap.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => any,
  pageSizeOrLegacyOrder?: any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  
  const actualPageSize = typeof pageSizeOrLegacyOrder === 'number' ? pageSizeOrLegacyOrder : pageSize;

  // Safety cap (200,000 rows max) to prevent UI blocking.
  for (let i = 0; i < 200; i++) {
    const to = from + actualPageSize - 1;
    
    // Execute the builder with range parameters.
    const response = await build(from, to);
    
    const { data, error } = response || {};
    if (error) throw error;
    
    const rows = (data ?? []) as T[];
    all.push(...rows);
    
    // Exit if we've retrieved all available records.
    if (rows.length < actualPageSize) break;
    from += actualPageSize;
  }
  return all;
}
