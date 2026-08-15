/**
 * Fetch all rows from a Supabase query builder, paging past the 1000-row cap.
 * The build parameter is intentionally typed as any to maintain compatibility with 
 * various component call sites and Supabase's internal builder types.
 */
export async function fetchAll<T>(
  build: any,
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
    // We cast the builder to any to avoid TypeScript errors at call sites.
    const response = await (build as any)(from, to);
    
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
