export function filterByAccountAndProject(items, accountId, projectId) {
  if (!items) return [];

  return items.filter(item => {
    if (accountId && item.accountId !== accountId) return false;
    if (projectId && item.projectId !== projectId) return false;
    return true;
  });
}

export function searchItems(items, query) {
  if (!query || query.trim() === '') return items;

  const lowerQuery = query.toLowerCase();

  return items.filter(item => {
    if (item.name && item.name.toLowerCase().includes(lowerQuery)) return true;
    if (item.id && item.id.toLowerCase().includes(lowerQuery)) return true;
    if (item.hostname && item.hostname.toLowerCase().includes(lowerQuery)) return true;
    if (item.email && item.email.toLowerCase().includes(lowerQuery)) return true;

    if (item.tags && Array.isArray(item.tags)) {
      return item.tags.some(tag =>
        tag.key.toLowerCase().includes(lowerQuery) ||
        tag.value.toLowerCase().includes(lowerQuery)
      );
    }

    if (item.ips && Array.isArray(item.ips)) {
      return item.ips.some(ip => ip.includes(query));
    }

    return false;
  });
}

export function sortItems(items, column, direction = 'asc') {
  const sorted = [...items].sort((a, b) => {
    let aVal = a[column];
    let bVal = b[column];

    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  return sorted;
}

export function paginateItems(items, page = 1, perPage = 20) {
  const start = (page - 1) * perPage;
  const end = start + perPage;

  return {
    items: items.slice(start, end),
    page,
    perPage,
    total: items.length,
    totalPages: Math.ceil(items.length / perPage),
  };
}
