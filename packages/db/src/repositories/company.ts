import type { PrismaClient } from '@prisma/client';
export class PrismaCompanyRepository {
  constructor(private db: PrismaClient) {}
  async findByDomain(tenantId:string, domain:string){ return this.db.company.findUnique({where:{tenantId_domain:{tenantId,domain}}}); }
  async create(data:{tenantId:string,name:string,domain?:string|null,country?:string|null,city?:string|null,phone?:string|null,address?:string|null}){return this.db.company.create({data});}
  async addSource(data:{tenantId:string;companyId:string;source:string;externalId?:string;rawJson?:unknown}){return this.db.sourceRecord.create({data:{...data,rawJson:data.rawJson as object}})}
}
