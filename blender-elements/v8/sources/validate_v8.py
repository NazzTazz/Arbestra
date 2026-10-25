"""Normalize unlit-only GLB metadata and audit the exported bytes, not Blender counters.
Run with Python + Pillow. Rewrites only this V8 package's exported GLBs.
"""
from pathlib import Path
import json,struct,re,hashlib,math,io
from PIL import Image
OUT=Path(__file__).resolve().parents[1]

def read(path):
    b=path.read_bytes();assert b[:4]==b'glTF' and struct.unpack_from('<I',b,4)[0]==2
    assert struct.unpack_from('<I',b,8)[0]==len(b)
    n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);tail=b[20+n:]
    return g,tail

def normalize(path):
    g,tail=read(path)
    for m in g.get('materials',[]):
        assert 'KHR_materials_unlit' in m.get('extensions',{})
        p=m.get('pbrMetallicRoughness',{})
        # Unlit ignores these exporter-inserted defaults. Retain only base-color data.
        p.pop('metallicFactor',None);p.pop('roughnessFactor',None)
        if not p:m.pop('pbrMetallicRoughness',None)
    for a in ['nodes','meshes']:
        for n in g.get(a,[]):n['name']=re.sub(r'\.\d{3}$','',n.get('name',''))
    data=json.dumps(g,separators=(',',':'),ensure_ascii=False).encode();data+=b' '*((-len(data))%4)
    path.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(data)+len(tail))+struct.pack('<I4s',len(data),b'JSON')+data+tail)

def accessor(g,blob,idx):
    a=g['accessors'][idx];bv=g['bufferViews'][a['bufferView']]
    typ={5121:'B',5123:'H',5125:'I',5126:'f'}[a['componentType']]
    size={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    fmt='<'+typ*size;stride=bv.get('byteStride',struct.calcsize(fmt));off=bv.get('byteOffset',0)+a.get('byteOffset',0)
    vals=[struct.unpack_from(fmt,blob,off+i*stride) for i in range(a['count'])]
    assert all(all(math.isfinite(v) for v in row) for row in vals)
    return vals

def inspect(path):
    normalize(path);g,tail=read(path);blob=tail[8:];nodes=[];degenerate=0
    assert len(g.get('materials',[]))<=4
    assert not g.get('animations')
    for mat in g.get('materials',[]):
        assert not mat.get('doubleSided',False)
        assert not any(k in mat for k in ['normalTexture','occlusionTexture','emissiveTexture','emissiveFactor'])
        assert set(mat.get('pbrMetallicRoughness',{}))<= {'baseColorTexture','baseColorFactor'}
        assert set(mat.get('extensions',{}))=={'KHR_materials_unlit'}
    for n in g['nodes']:
        if 'mesh' not in n:continue
        assert re.search(r'_LOD[012]$',n['name']),n['name']
        assert n.get('translation',[0,0,0])==[0,0,0]
        assert n.get('rotation',[0,0,0,1])==[0,0,0,1]
        assert n.get('scale',[1,1,1])==[1,1,1]
        assert 'matrix' not in n
        count=0;bounds=[]
        for p in g['meshes'][n['mesh']]['primitives']:
            assert p.get('mode',4)==4
            pos=accessor(g,blob,p['attributes']['POSITION']);inds=[x[0] for x in accessor(g,blob,p['indices'])]
            assert len(inds)%3==0 and max(inds)<len(pos);count+=len(inds)//3
            assert 'COLOR_0' in p['attributes']
            for j in range(0,len(inds),3):
                a,b,c=[pos[k] for k in inds[j:j+3]];u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
                cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
                if sum(x*x for x in cross)<1e-20:degenerate+=1
            bounds.extend(pos)
        nodes.append({'name':n['name'],'triangles':count,'primitives':len(g['meshes'][n['mesh']]['primitives']),'bounds':{'min':[min(v[i] for v in bounds) for i in range(3)],'max':[max(v[i] for v in bounds) for i in range(3)]}})
    imgs=[]
    for im in g.get('images',[]):
        assert 'bufferView' in im
        bv=g['bufferViews'][im['bufferView']];start=bv.get('byteOffset',0)
        size=Image.open(io.BytesIO(blob[start:start+bv['byteLength']])).size
        assert all(x<=512 and x>0 and (x&(x-1))==0 for x in size)
        imgs.append({'name':im.get('name'),'size':list(size)})
    assert degenerate==0,(path,degenerate)
    return {'file':path.relative_to(OUT).as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'trianglesAllNodes':sum(x['triangles'] for x in nodes),'nodes':nodes,'materials':g.get('materials',[]),'embeddedImages':imgs,'identityTransforms':True,'degenerateTriangles':degenerate}

assets=[inspect(p) for p in sorted((OUT/'assets').glob('*.glb'))]
pieces={n['name']:n['triangles'] for a in assets if Path(a['file']).name=='garden-kit.glb' for n in a['nodes']}
for n,t in pieces.items():
    limit=None
    if n.startswith('CAROTTE'):limit=40
    elif n.startswith('BUTTE'):limit=150 if n.endswith('LOD0') else 40
    elif n.startswith('PLANCHE'):limit=40 if n.endswith('LOD0') else 2
    elif n.startswith('CORDE'):limit=48 if n.endswith('LOD0') else 8
    elif n.startswith('RANG'):limit=120
    elif n.startswith('MARQUEUR'):limit=200 if n.endswith('LOD0') else 24
    elif n.startswith('PARCELLE'):limit=2
    if limit:assert t<=limit,(n,t,limit)
assert [pieces[f'CAROTTE_STADE_{s:02}_LOD0'] for s in range(1,8)]==[4,8,12,16,20,22,24]
totals={}
for lod,cap in [(0,2500),(1,600),(2,2)]:
    a=next(a for a in assets if a['file']==f'assets/example-parcel_LOD{lod}.glb')
    b=next(a for a in assets if a['file']==f'assets/example-L_LOD{lod}.glb')
    assert a['trianglesAllNodes']<=cap
    totals[f'LOD{lod}']={'budgetPerParcel':cap,'isolatedMatureParcel':a['trianglesAllNodes'],'LThreeParcels':b['trianglesAllNodes'],'460IsolatedParcelsUpperBound':a['trianglesAllNodes']*460,'includesFence':lod<2,'includesMarker':lod<2}
    # Geometry must span the full 5x5 L, not three overlapping tiles at origin.
    mins=[min(n['bounds']['min'][i] for n in b['nodes']) for i in range(3)]
    maxs=[max(n['bounds']['max'][i] for n in b['nodes']) for i in range(3)]
    assert 4.99 <= maxs[0]-mins[0] <= 5.1
    assert 4.99 <= maxs[2]-mins[2] <= 5.1
recipe=json.loads((OUT/'reference'/'assembly.json').read_text())['placements']
for lod in [0,1]:
    for name,ntiles,nfence in [('parcel',1,8),('L',3,16)]:
        entries=recipe[f'{name}_LOD{lod}']
        assert sum(e['source']==f'CORDE_LOD{lod}' for e in entries)==nfence
        assert sum(e['source']==f'PIQUET_LOD{lod}' for e in entries)==nfence
        assert sum(e['source'].startswith('PLANCHE') for e in entries)==ntiles*4
        assert sum(e['source'].startswith('CAROTTE' if lod==0 else 'RANG') for e in entries)==ntiles*(48 if lod==0 else 3)
for stage in range(1,8):assert Image.open(OUT/'textures'/f'garden-stage-{stage:02}-256.png').size==(256,256)
manifest={'revision':'V8','date':'2026-10-25','status':'Exported geometry validated; no game integration or MX230 FPS measurement','cellSize':2.5,'sourceUp':'Z','gltfUp':'Y','conversion':'(x,y,z) Blender -> (x,z,-y) glTF','materials':['V8_terre','V8_vegetal','V8_bois','V8_corde'],'shader':'KHR_materials_unlit, base color only, vertex colors, all single-sided','atlas':{'size':[512,512],'slotSize':128,'contentSize':120,'gutter':4,'slotsTopLeftOrder':['stage01','stage02','stage03','stage04','stage05','stage06','stage07','soil'],'originalBakes':[256,256]},'totals':totals,'pieces':pieces,'assets':assets}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf-8')
(OUT/'reference'/'validation.json').write_text(json.dumps({'passed':True,'checked':['GLB header and lengths','triangle indices and finite positions','zero degenerate triangles','identity node transforms','LOD name suffixes','piece and assembly budgets','four materials maximum','single-sided and unlit base-color-only materials','embedded POT textures <=512','seven 256px bakes'],'totals':totals},indent=2),encoding='utf-8')
print(json.dumps(totals,indent=2))
