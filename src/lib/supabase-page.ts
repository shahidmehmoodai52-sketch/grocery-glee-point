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

  // Safety cap (200,000 rows max) to prevent runaway loops.
  for (let i = 0; i < 200; i++) {
    const to = from + actualPageSize - 1;
    
    // We cast the builder call to any to allow flexible parameter counts (0, 1, or 2)
    // which prevents the TypeScript compiler from complaining at call sites
    // where fetchAll is used inside useQuery or other wrappers.
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
