/**
 * Fetch all rows from a Supabase query builder, paging past the 1000-row cap.
 * 
 * Usage: 
 * await fetchAll<T>(
 *   (from, to) => supabase.from("table").select("*").range(from, to)
 * );
 */
export async function fetchAll<T>(
  build: (from: any, to: any) => any,
  pageSizeOrLegacyOrder?: any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  
  const actualPageSize = typeof pageSizeOrLegacyOrder === 'number' ? pageSizeOrLegacyOrder : pageSize;

  // Safety cap (200,000 rows max) to prevent runaway loops.
  for (let i = 0; i < 200; i++) {
    const to = from + actualPageSize - 1;
    
    // Execute the builder with range parameters.
    // We cast the builder to any to avoid TypeScript errors at call sites that 
    // are passed into TanStack useQuery and similar wrappers.
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
