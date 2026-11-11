export const matchesResultSearch = (query: string, ...values: string[]): boolean =>
  values.join(' ').toLowerCase().includes(query.trim().toLowerCase());
