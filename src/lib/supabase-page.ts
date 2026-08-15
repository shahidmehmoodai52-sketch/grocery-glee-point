/**
 * Fetch all rows from a Supabase query builder, paging past the 1000-row cap.
 * 
 * Usage: 
 * await fetchAll<Product>(
 *   (from, to) => supabase.from("products").select("*").range(from, to)
 * );
 */
export async function fetchAll<T>(
  build: (from: any, to: any) => any,
  pageSizeOrLegacyOrder?: any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  
  // Backward compatibility for calls passing pageSize as the second argument
  const actualPageSize = typeof pageSizeOrLegacyOrder === 'number' ? pageSizeOrLegacyOrder : pageSize;

  // Safety cap (200,000 rows max) to prevent UI blocking.
  for (let i = 0; i < 200; i++) {
    const to = from + actualPageSize - 1;
    
    // We execute the builder function and await its result
    // The cast to any handles the flexible signatures across the project
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
