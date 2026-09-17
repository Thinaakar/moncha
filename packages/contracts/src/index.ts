import {z} from 'zod';
export const discoverSchema=z.object({tenantId:z.string().min(1),country:z.string().min(1),city:z.string().min(1),keyword:z.string().min(1)});
export const manualLeadSchema=z.object({tenantId:z.string().min(1),name:z.string().min(1),domain:z.string().optional(),country:z.string().optional(),city:z.string().optional(),phone:z.string().optional(),address:z.string().optional()});
export const websiteCheckSchema=z.object({tenantId:z.string().min(1)});
export type DiscoverInput=z.infer<typeof discoverSchema>;
export type ManualLeadInput=z.infer<typeof manualLeadSchema>;
