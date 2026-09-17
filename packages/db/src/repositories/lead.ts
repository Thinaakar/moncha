import type { PrismaClient } from '@prisma/client';
export class PrismaLeadRepository {
  constructor(private db: PrismaClient) {}
  async create(data:{tenantId:string,companyId:string,status:'discovered'|'review'|'rejected'}){return this.db.lead.create({data});}
  async list(tenantId:string, opts:{search?:string;status?:'discovered'|'review'|'rejected';country?:string;skip:number;take:number}){
    const where={tenantId,status:opts.status,company: {country:opts.country, ...(opts.search?{OR:[{name:{contains:opts.search,mode:'insensitive'}},{domain:{contains:opts.search,mode:'insensitive'}}]}:{})}};
    const [items,total]=await Promise.all([this.db.lead.findMany({where,include:{company:{include:{website:true,sourceRecords:true}}},skip:opts.skip,take:opts.take,orderBy:{createdAt:'desc'}}),this.db.lead.count({where})]);
    return {items,total};
  }
  async get(tenantId:string,id:string){return this.db.lead.findFirst({where:{id,tenantId},include:{company:{include:{website:true,sourceRecords:true}}}})}
}
