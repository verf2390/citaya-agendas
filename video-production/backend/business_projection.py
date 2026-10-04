"""Allow-listed, pure business metadata projection. No database access."""
from studio import Actor
from production import fail

def public_business_projection(actor:Actor,record:dict):
    if record.get('tenant_id')!=actor.tenant_id:fail('NOT_FOUND','Business not found in this tenant.')
    result={k:record[k] for k in ['business_name','category','booking_url','website'] if isinstance(record.get(k),str)}
    if record.get('public_contact_approved') is True:
        result['public_contact']={k:v for k,v in record.get('public_contact',{}).items() if k in ['whatsapp','socialHandle','businessEmail'] and isinstance(v,str)}
    # Asset IDs must still resolve through the tenant/project asset boundary before rendering.
    if record.get('logo_asset_approved') is True and isinstance(record.get('logo_asset_id'),str):result['logo_asset_id']=record['logo_asset_id']
    result['services']=[]
    for service in record.get('services',[]):
        if service.get('enabled') is True and service.get('public') is True:
            item={'name':service.get('name','')}
            if service.get('price_public') is True:item['public_price']=service.get('price')
            result['services'].append(item)
    result['professionals']=[{'public_name':p['public_name']} for p in record.get('professionals',[]) if p.get('public_name_approved') is True and isinstance(p.get('public_name'),str)]
    return result
