/**
 * Fetch all rows from a Supabase query builder, paging past the 1000-row cap.
 */
export async function fetchAll<T>(
  build: any,
  pageSizeOrLegacyOrder?: any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  
  const actualPageSize = typeof pageSizeOrLegacyOrder === 'number' ? pageSizeOrLegacyOrder : pageSize;

  for (let i = 0; i < 200; i++) {
    const to = from + actualPageSize - 1;
    
    // Call the builder as any to avoid signature mismatch errors in calling code.
    const response = await (build as any)(from, to);
    const { data, error } = response || {};
    
    if (error) throw error;
    
    const rows = (data ?? []) as T[];
    all.push(...rows);
    
    if (rows.length < actualPageSize) break;
    from += actualPageSize;
  }
  return all;
}
