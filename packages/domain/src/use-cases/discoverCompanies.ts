import {canonicalDomain,normalizeCompanyName} from '../entities/company';
import type {DiscoverySource,CompanyRepo,LeadRepo} from '../ports';
export async function discoverCompanies(deps:{source:DiscoverySource;companies:CompanyRepo;leads:LeadRepo},input:{tenantId:string;country:string;city:string;keyword:string}){
 const found=await deps.source.discover(input);let created=0,duplicates=0;
 for(const item of found){const name=normalizeCompanyName(item.name);const domain=canonicalDomain(item.domain);if(!domain)continue;const existing=await deps.companies.findByDomain(input.tenantId,domain);if(existing){duplicates++;continue;}const company=await deps.companies.create({tenantId:input.tenantId,name,domain,country:item.country||input.country,city:item.city||input.city,phone:item.phone,address:item.address});if(deps.companies.addSource) await deps.companies.addSource({tenantId:input.tenantId,companyId:company.id,source:item.source,externalId:item.externalId,rawJson:item.raw});await deps.leads.create({tenantId:input.tenantId,companyId:company.id,status:'discovered'});created++;}
 return {found:found.length,created,duplicates};
}
