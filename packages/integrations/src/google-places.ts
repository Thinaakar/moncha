import type {DiscoverySource,DiscoveredCompany} from '@moncha/domain';
export class GooglePlacesDiscoverySource implements DiscoverySource {
 constructor(private apiKey:string){if(!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is required')}
 async discover(input:{country:string;city:string;keyword:string}):Promise<DiscoveredCompany[]> {
  const q=encodeURIComponent(`${input.keyword} in ${input.city}, ${input.country}`);const res=await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&key=${this.apiKey}`);if(!res.ok)throw new Error(`Google Places HTTP ${res.status}`);const data=await res.json() as any;if(data.status!=='OK'&&data.status!=='ZERO_RESULTS')throw new Error(`Google Places ${data.status}`);return (data.results||[]).map((p:any)=>({name:p.name,address:p.formatted_address,source:'google_places',externalId:p.place_id,raw:p,country:input.country,city:input.city}));
 }
}
export * from './google-places';
