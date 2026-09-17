export function normalizeCompanyName(value:string){return value.trim().replace(/\s+/g,' ')}
export function canonicalDomain(value?:string){if(!value)return undefined;try{const u=new URL(value.includes('://')?value:`https://${value}`);return u.hostname.toLowerCase().replace(/^www\./,'');}catch{return undefined}}
