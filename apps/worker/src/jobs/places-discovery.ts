import {task} from '@trigger.dev/sdk/v3';
import {prisma,PrismaCompanyRepository,PrismaLeadRepository,PrismaJobRunRepository} from '@moncha/db';
import {discoverCompanies} from '@moncha/domain';
import {GooglePlacesDiscoverySource} from '@moncha/integrations';
export const placesDiscovery=task({id:'places-discovery',run:async(payload:{jobId:string;tenantId:string;country:string;city:string;keyword:string})=>{const jobs=new PrismaJobRunRepository(prisma);await jobs.update(payload.jobId,{status:'running',startedAt:new Date()});try{const result=await discoverCompanies({source:new GooglePlacesDiscoverySource(process.env.GOOGLE_PLACES_API_KEY||''),companies:new PrismaCompanyRepository(prisma),leads:new PrismaLeadRepository(prisma)},payload);await jobs.update(payload.jobId,{status:'done',finishedAt:new Date()});return result}catch(e){await jobs.update(payload.jobId,{status:'failed',error:e instanceof Error?e.message:String(e),finishedAt:new Date()});throw e;}}});
