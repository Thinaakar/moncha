export type DiscoveredCompany={name:string;domain?:string;country?:string;city?:string;phone?:string;address?:string;source:string;externalId?:string;raw?:unknown};
export interface DiscoverySource { discover(input:{country:string;city:string;keyword:string}):Promise<DiscoveredCompany[]>; }
export type WebsiteResult={reachable:boolean;finalUrl?:string;httpStatus?:number;title?:string};
export interface WebsiteChecker { check(url:string):Promise<WebsiteResult>; }
export interface CompanyRepo {findByDomain(tenantId:string,domain:string):Promise<any>;create(data:any):Promise<any>;addSource?(data:any):Promise<any>}
export interface LeadRepo {create(data:any):Promise<any>}
export interface JobRepo {create(tenantId:string,type:any,input:unknown):Promise<any>;update(id:string,data:any):Promise<any>}
