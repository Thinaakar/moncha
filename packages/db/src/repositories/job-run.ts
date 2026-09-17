import type { PrismaClient, JobStatus, JobType } from '@prisma/client';
export class PrismaJobRunRepository {
 constructor(private db:PrismaClient){}
 async create(tenantId:string,type:JobType,inputJson:unknown){return this.db.jobRun.create({data:{tenantId,type,inputJson:inputJson as object}})}
 async update(id:string,data:{status?:JobStatus;error?:string;startedAt?:Date;finishedAt?:Date}){return this.db.jobRun.update({where:{id},data})}
 async get(tenantId:string,id:string){return this.db.jobRun.findFirst({where:{tenantId,id}})}
 async list(tenantId:string){return this.db.jobRun.findMany({where:{tenantId},orderBy:{createdAt:'desc'}})}
}
