import { describe, expect, it } from 'vitest';
import { leadListPagination, leadListWhere } from './lead-query';

describe('lead query tenant isolation and pagination', () => {
  it('always includes tenantId in the where clause', () => {
    const where = leadListWhere('tenant-a', {
      search: 'dental',
      country: 'Singapore',
      queue: 'QUALIFIED',
    });
    expect(where.tenantId).toBe('tenant-a');
    expect(where.queue).toBe('QUALIFIED');
  });

  it('does not leak another tenant id into filters', () => {
    const where = leadListWhere('tenant-a', { search: 'tenant-b' });
    expect(where.tenantId).toBe('tenant-a');
  });

  it('clamps page size', () => {
    expect(leadListPagination({ pageSize: 1000 }).pageSize).toBe(100);
    expect(leadListPagination({ pageSize: 0 }).pageSize).toBe(25);
    expect(leadListPagination({ pageSize: 10 }).pageSize).toBe(10);
    expect(leadListPagination({ page: 2, pageSize: 25 }).skip).toBe(25);
  });
});
