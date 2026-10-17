/** The launch bearer belongs only in the fragment and is removed before any read. */
export function observationAddress(href:string){
 const url=new URL(href),fragment=new URLSearchParams(url.hash.slice(1)),token=fragment.get('observationToken');
 fragment.delete('observationToken');url.hash=fragment.toString();
 return{leaseId:url.searchParams.get('observe'),token,cleanHref:url.href};
}
