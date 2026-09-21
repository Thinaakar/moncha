import { z } from 'zod';

export const leadStatusSchema = z.enum(['discovered', 'review', 'rejected']);
export const liveDiscoverySourceSchema = z.enum(['google_places', 'yelp', 'foursquare', 'search', 'all']);

export const discoverPlacesSchema = z.object({
  source: liveDiscoverySourceSchema,
  country: z.string().trim().min(1),
  city: z.string().trim().min(1),
  keyword: z.string().trim().min(1),
});

export const csvRecordSchema = z.object({
  name: z.string().trim().min(1),
  domain: z.string().trim().optional(),
  website: z.string().trim().optional(),
  country: z.string().trim().optional(),
  city: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

export const discoverCsvSchema = z.object({
  source: z.literal('csv'),
  csv: z.string().min(1).optional(),
  records: z.array(csvRecordSchema).optional(),
});

export const sourceImportSchema = z
  .union([discoverPlacesSchema, discoverCsvSchema])
  .superRefine((value, ctx) => {
    if (value.source === 'csv' && !value.csv && !(value.records && value.records.length > 0)) {
      ctx.addIssue({ code: 'custom', message: 'CSV import requires csv text or records', path: ['csv'] });
    }
  });

export const discoverSchema = discoverPlacesSchema;

export const manualLeadSchema = z.object({
  name: z.string().trim().min(1),
  domain: z.string().trim().optional(),
  country: z.string().trim().optional(),
  city: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

export const websiteCheckSchema = z.object({}).passthrough();

export const leadListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
  status: leadStatusSchema.optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
});

export type DiscoverInput = z.infer<typeof discoverPlacesSchema>;
export type SourceImportInput = z.infer<typeof sourceImportSchema>;
export type ManualLeadInput = z.infer<typeof manualLeadSchema>;
export type LeadListQueryInput = z.infer<typeof leadListQuerySchema>;
export type LoginInput = z.infer<typeof loginSchema>;
